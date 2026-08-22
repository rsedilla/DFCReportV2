import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import {
  DuplicateAcknowledgementRequiredError,
  InvariantViolationError,
  NotFoundError,
} from '../common/errors/api-error';
import { IdempotencyService } from '../common/idempotency/idempotency.service';
import { DATABASE, type Db } from '../database/database.module';

import {
  findCandidates,
  normalizeName,
  type Candidate,
  type Match,
  type Subject,
} from './duplicate-matching';

import type { CurrentClaim } from '../common/idempotency/current-idempotency.decorator';
import type { CivilStatus, Database, Json, NetworkName, Sex } from '../database/schema';
import type { Transaction } from 'kysely';

/**
 * The `people` module: Person, Member ID, lifecycle, duplicate matching, merge
 * (SKILL.md section 2, Modules). It is the only writer of `persons`.
 *
 * Lifecycle and merge are not here yet and that is deliberate rather than
 * unfinished: section 3 refuses to archive a Person who leads a Cell, and refuses
 * to merge one whose Cell relationships conflict — both need `cells`, which is
 * Stage 3. Building them now would mean writing the guard as a comment, which is
 * the failure this project keeps correcting. `docs/ROADMAP.md` puts neither in
 * Stage 2.
 */

export interface CreatePersonInput {
  firstName: string;
  middleName?: string | null;
  lastName: string;
  birthDate: string;
  sex: Sex;
  civilStatus: CivilStatus;
  mobileNumber?: string | null;
  /**
   * Null only for the import path (section 2, Initial data load). Section 5
   * permits a Person "encoded but not yet assigned", and section 9 requires the
   * leader at VIP registration — so the API requires it and the service does not.
   */
  pastoralLeaderId: string | null;
  /** Tier 1 candidates the actor has seen and passed over (section 3). */
  acknowledgedDuplicateIds?: readonly string[];
}

/** The keyset a search page resumes from. Opaque to clients (section 22). */
export interface SearchCursor {
  lastName: string;
  firstName: string;
  id: string;
}

export interface PersonRecord {
  id: string;
  member_id: string;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  birth_date: string;
  sex: Sex;
  civil_status: CivilStatus;
  mobile_number: string | null;
}

@Injectable()
export class PeopleService {
  constructor(
    @Inject(DATABASE) private readonly db: Db,
    private readonly idempotency: IdempotencyService,
  ) {}

  /**
   * Creates a Person, and everything the specification says comes with one.
   *
   * All of it in one transaction: the Person, their Network (assigned from sex,
   * section 4), their `CURRENT` lifecycle row, their pastoral assignment where one
   * was given, the audit entry section 21 requires, and — **last** — the
   * idempotency completion (section 22, and CLAUDE.md, Write endpoints).
   *
   * The completion is last because it takes the key's row lock, and a concurrent
   * retry waits on that lock rather than being answered `REQUEST_IN_FLIGHT`.
   */
  async create(
    input: CreatePersonInput,
    actor: { accountId: string; personId: string },
    claim: CurrentClaim,
  ): Promise<PersonRecord> {
    const network = networkFor(input.sex);

    if (input.pastoralLeaderId !== null) {
      await this.assertLeaderIsAssignable(input.pastoralLeaderId, network);
    }

    // Section 3: never merges automatically, never blocks creation. A Tier 1
    // candidate the actor has not acknowledged is asked about, not refused.
    const unacknowledged = (await this.findDuplicates(input)).filter(
      (match) =>
        match.tier === 1 && !(input.acknowledgedDuplicateIds ?? []).includes(match.candidate.id),
    );

    if (unacknowledged.length > 0) {
      throw new DuplicateAcknowledgementRequiredError(unacknowledged.map(describeCandidate));
    }

    return this.db.transaction().execute(async (trx) => {
      const person = await trx
        .insertInto('persons')
        .values({
          first_name: input.firstName.trim(),
          middle_name: input.middleName?.trim() || null,
          last_name: input.lastName.trim(),
          birth_date: input.birthDate,
          sex: input.sex,
          civil_status: input.civilStatus,
          mobile_number: input.mobileNumber?.trim() || null,
          mobile_number_normalized: normalizeMobile(input.mobileNumber),
        })
        .returning([
          'id',
          'member_id',
          'first_name',
          'middle_name',
          'last_name',
          'birth_date',
          'sex',
          'civil_status',
          'mobile_number',
        ])
        .executeTakeFirstOrThrow();

      // Section 4: the initial Network takes effect when the Person is encoded.
      // Nothing is backdated and no legacy history is invented.
      const encodedAt = new Date();

      await trx
        .insertInto('network_assignments')
        .values({
          person_id: person.id,
          network,
          actor_id: actor.accountId,
          started_at: encodedAt,
        })
        .execute();

      await trx
        .insertInto('person_lifecycle')
        .values({
          person_id: person.id,
          state: 'CURRENT',
          actor_id: actor.accountId,
          started_at: encodedAt,
        })
        .execute();

      if (input.pastoralLeaderId !== null) {
        await trx
          .insertInto('pastoral_assignments')
          .values({
            person_id: person.id,
            leader_id: input.pastoralLeaderId,
            started_at: encodedAt,
          })
          .execute();
      }

      await trx
        .insertInto('audit_log')
        .values({
          actor_id: actor.accountId,
          action: 'person.created',
          target_type: 'person',
          target_id: person.id,
          after: {
            member_id: person.member_id,
            network,
            pastoral_leader_id: input.pastoralLeaderId,
            acknowledged_duplicate_ids: [...(input.acknowledgedDuplicateIds ?? [])],
          },
        })
        .execute();

      // Last, and recording exactly what the endpoint returns.
      await this.idempotency.completeWithin(trx, {
        ...claim,
        status: 201,
        body: person,
      });

      return person;
    });
  }

  /**
   * A Person by id, or null.
   *
   * Field-level redaction is the caller's job, not this one: section 8 decides
   * what a viewer may see from their pastoral scope, and the service does not know
   * who is asking.
   */
  async findById(personId: string): Promise<PersonRecord | null> {
    const row = await this.db
      .selectFrom('persons')
      .select([
        'id',
        'member_id',
        'first_name',
        'middle_name',
        'last_name',
        'birth_date',
        'sex',
        'civil_status',
        'mobile_number',
      ])
      .where('id', '=', personId)
      .executeTakeFirst();

    return row ?? null;
  }

  /**
   * Church-wide search by name (section 8), cursor-paginated (section 22).
   *
   * Keyset rather than offset, because rows inserted while a client is paging
   * shift every subsequent offset and the directory grows during a Sunday service
   * — which duplicates and skips records, and is worse for mobile sync. The key
   * is `(last_name, first_name, id)`, and `id` is there to make it total: two
   * people legitimately share a name, and a key that is not unique loses rows at
   * the page boundary.
   */
  async searchByName(
    term: string,
    limit: number,
    cursor: SearchCursor | null = null,
  ): Promise<{ rows: PersonRecord[]; nextCursor: SearchCursor | null }> {
    const pattern = `%${normalizeName(term).replace(/\s+/g, '%')}%`;

    let query = this.db
      .selectFrom('persons')
      .select([
        'id',
        'member_id',
        'first_name',
        'middle_name',
        'last_name',
        'birth_date',
        'sex',
        'civil_status',
        'mobile_number',
      ])
      // A merged-away Person is not a search result: the survivor carries the
      // identity (section 3, Person Merge).
      .where('merged_into_id', 'is', null)
      .where((eb) =>
        eb.or([
          eb(eb.fn('lower', ['first_name']), 'like', pattern),
          eb(eb.fn('lower', ['last_name']), 'like', pattern),
          eb(sql<string>`lower(first_name || ' ' || last_name)`, 'like', pattern),
        ]),
      )
      .orderBy('last_name')
      .orderBy('first_name')
      .orderBy('id')
      // One more than asked for, which is how the last page is recognised without
      // a count -- section 22 does not return totals.
      .limit(limit + 1);

    if (cursor !== null) {
      query = query.where((eb) =>
        eb.or([
          eb('last_name', '>', cursor.lastName),
          eb.and([eb('last_name', '=', cursor.lastName), eb('first_name', '>', cursor.firstName)]),
          eb.and([
            eb('last_name', '=', cursor.lastName),
            eb('first_name', '=', cursor.firstName),
            eb('id', '>', cursor.id),
          ]),
        ]),
      );
    }

    const found = await query.execute();
    const rows = found.slice(0, limit);
    const last = rows[rows.length - 1];

    return {
      rows,
      nextCursor:
        found.length > limit && last !== undefined
          ? { lastName: last.last_name, firstName: last.first_name, id: last.id }
          : null,
    };
  }

  /**
   * Candidates that may already be the person described (section 3).
   *
   * The population is narrowed in SQL and scored in TypeScript. Narrowing on
   * birthday, last name or mobile number would miss the surname-change case
   * section 3 names, so the fetch is deliberately wider than the scoring: any row
   * sharing a birthday, a normalized mobile number, or the first letter of either
   * name. That is a small set in a church of this size (section 2, Scale) and
   * keeps every rule in one readable place.
   */
  async findDuplicates(subject: Subject): Promise<Match[]> {
    const mobile = subject.mobileNumberNormalized ?? normalizeMobile(null);

    let query = this.db
      .selectFrom('persons')
      .select([
        'id',
        'member_id',
        'first_name',
        'middle_name',
        'last_name',
        'birth_date',
        'sex',
        'mobile_number_normalized',
      ])
      // A Person absorbed by a merge is never a candidate: the survivor is the
      // only valid target of any later write (section 3, Person Merge).
      .where('merged_into_id', 'is', null);

    query = query.where((eb) =>
      eb.or([
        eb('birth_date', '=', subject.birthDate ?? '0001-01-01'),
        eb(eb.fn('lower', ['last_name']), 'like', `${firstLetter(subject.lastName)}%`),
        ...(mobile === null ? [] : [eb('mobile_number_normalized', '=', mobile)]),
      ]),
    );

    const population = await query.execute();

    return findCandidates(
      subject,
      population.map((row): Candidate => ({
        id: row.id,
        memberId: row.member_id,
        firstName: row.first_name,
        middleName: row.middle_name,
        lastName: row.last_name,
        birthDate: row.birth_date,
        sex: row.sex,
        mobileNumberNormalized: row.mobile_number_normalized,
      })),
    );
  }

  /**
   * Corrections to a person's own descriptive fields, and nothing else.
   *
   * Section 7 is explicit about the boundary: `people.edit_basic` covers first,
   * middle and last name, birthday, civil status and mobile number. **Not sex** —
   * that determines Network, which determines which pastoral edges are legal, so
   * it has its own capability and its own audited path (section 4).
   */
  async editBasic(
    personId: string,
    changes: {
      firstName?: string;
      middleName?: string | null;
      lastName?: string;
      birthDate?: string;
      civilStatus?: CivilStatus;
      mobileNumber?: string | null;
    },
    actor: { accountId: string },
    claim: CurrentClaim,
  ): Promise<PersonRecord> {
    const before = await this.findById(personId);
    if (!before) {
      throw new NotFoundError('No such person.');
    }

    return this.db.transaction().execute(async (trx) => {
      const person = await trx
        .updateTable('persons')
        .set({
          ...(changes.firstName === undefined ? {} : { first_name: changes.firstName.trim() }),
          ...(changes.middleName === undefined
            ? {}
            : { middle_name: changes.middleName?.trim() || null }),
          ...(changes.lastName === undefined ? {} : { last_name: changes.lastName.trim() }),
          ...(changes.birthDate === undefined ? {} : { birth_date: changes.birthDate }),
          ...(changes.civilStatus === undefined ? {} : { civil_status: changes.civilStatus }),
          ...(changes.mobileNumber === undefined
            ? {}
            : {
                mobile_number: changes.mobileNumber?.trim() || null,
                mobile_number_normalized: normalizeMobile(changes.mobileNumber),
              }),
        })
        .where('id', '=', personId)
        .returning([
          'id',
          'member_id',
          'first_name',
          'middle_name',
          'last_name',
          'birth_date',
          'sex',
          'civil_status',
          'mobile_number',
        ])
        .executeTakeFirstOrThrow();

      await trx
        .insertInto('audit_log')
        .values({
          actor_id: actor.accountId,
          action: 'person.updated',
          target_type: 'person',
          target_id: personId,
          before: before as unknown as Json,
          after: person as unknown as Json,
        })
        .execute();

      await this.idempotency.completeWithin(trx, {
        ...claim,
        status: 200,
        body: person,
      });

      return person;
    });
  }

  /** The person's Network as it stands, for the identity fields section 8 permits. */
  async currentNetworkOf(personId: string): Promise<NetworkName | null> {
    const row = await this.db
      .selectFrom('network_assignments')
      .select('network')
      .where('person_id', '=', personId)
      .where('ended_at', 'is', null)
      .executeTakeFirst();

    return row?.network ?? null;
  }

  /** The name of the person's current direct leader, which section 8 permits church-wide. */
  async directLeaderNameOf(personId: string): Promise<string | null> {
    const row = await this.db
      .selectFrom('pastoral_assignments as pa')
      .innerJoin('persons as leader', 'leader.id', 'pa.leader_id')
      .select(['leader.first_name', 'leader.last_name'])
      .where('pa.person_id', '=', personId)
      .where('pa.ended_at', 'is', null)
      .executeTakeFirst();

    return row ? `${row.first_name} ${row.last_name}` : null;
  }

  /**
   * Refuses a leader the new edge could not legally point at.
   *
   * The database enforces the same-Network rule and would reject this at commit
   * (section 5), but a constraint violation surfacing as a 500 tells an encoder
   * nothing. This turns the two reachable cases into the answers section 22
   * defines for them.
   */
  private async assertLeaderIsAssignable(leaderId: string, network: NetworkName): Promise<void> {
    const leader = await this.db
      .selectFrom('persons')
      .select(['id', 'merged_into_id'])
      .where('id', '=', leaderId)
      .executeTakeFirst();

    if (!leader) {
      throw new NotFoundError('No such pastoral leader.');
    }

    if (leader.merged_into_id !== null) {
      throw new InvariantViolationError(
        'That leader was absorbed by a merge. Use the surviving Person instead.',
        { pastoral_leader_id: leaderId },
      );
    }

    const leaderNetwork = await this.currentNetworkOf(leaderId);
    if (leaderNetwork !== network) {
      throw new InvariantViolationError(
        'A pastoral assignment may not cross Networks. This person belongs to the other Network from that leader.',
        { pastoral_leader_id: leaderId, person_network: network, leader_network: leaderNetwork },
      );
    }
  }
}

/**
 * Network follows from sex under the homogeneous-network rule, and is assigned
 * rather than proposed (SKILL.md section 4). The mapping is total, so a
 * confirmation step would ask the encoder to approve a tautology.
 */
export function networkFor(sex: Sex): NetworkName {
  return sex === 'MALE' ? 'MENS' : 'WOMENS';
}

/**
 * A dialling form beside the value as entered (section 3).
 *
 * Validation is deliberately loose: family abroad, visitors and landlines all
 * produce numbers that do not match a local mobile pattern, and rejecting them
 * loses real contact detail for no benefit.
 */
export function normalizeMobile(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const digits = value.replace(/[^\d+]/g, '');
  return digits === '' ? null : digits;
}

function firstLetter(value: string): string {
  return (value.trim()[0] ?? '').toLowerCase();
}

function describeCandidate(match: Match): Record<string, unknown> {
  return {
    id: match.candidate.id,
    member_id: match.candidate.memberId,
    full_name: [match.candidate.firstName, match.candidate.middleName, match.candidate.lastName]
      .filter((part) => part !== null && part !== '')
      .join(' '),
    sex: match.candidate.sex,
    tier: match.tier,
    reasons: match.reasons,
  };
}

/** Kept for the import path, which writes through this service (section 2). */
export type PeopleTransaction = Transaction<Database>;
