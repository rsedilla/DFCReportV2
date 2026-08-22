import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import { HierarchyService } from '../hierarchy/hierarchy.service';
import { NetworksService } from '../networks/networks.service';
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

/**
 * The body a Person endpoint returns, composed here rather than in the
 * controller.
 *
 * Section 22 requires a write endpoint to record **the response it returns**, and
 * the recording happens inside the transaction, in this service. If the
 * controller reshaped the record afterwards, the stored body and the sent body
 * would differ and every replay would answer something the original never sent —
 * which is exactly the defect that shape produced on the first edit endpoint
 * written here.
 *
 * So the composition lives beside the recording. A controller that wants a
 * different shape has to change this, where the consequence is visible.
 */
export function fullProfile(person: PersonRecord): Record<string, unknown> {
  return {
    id: person.id,
    member_id: person.member_id,
    first_name: person.first_name,
    middle_name: person.middle_name,
    last_name: person.last_name,
    full_name: composeName(person),
    // Section 3: age is derived, never persisted as authoritative data. It is not
    // returned at all — a client that needs it computes it from the birthday,
    // which is the one value that cannot go stale.
    birth_date: person.birth_date,
    sex: person.sex,
    civil_status: person.civil_status,
    mobile_number: person.mobile_number,
    scope: 'FULL',
  };
}

export function composeName(person: {
  first_name: string;
  middle_name: string | null;
  last_name: string;
}): string {
  return [person.first_name, person.middle_name, person.last_name]
    .filter((part): part is string => part !== null && part.trim() !== '')
    .join(' ');
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
    private readonly hierarchy: HierarchyService,
    private readonly networks: NetworksService,
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
  ): Promise<Record<string, unknown>> {
    const network = this.networks.networkForSex(input.sex);

    if (input.pastoralLeaderId !== null) {
      await this.assertLeaderIsAssignable(input.pastoralLeaderId, network);
    }

    // Section 3: never merges automatically, never blocks creation. A Tier 1
    // candidate the actor has not acknowledged is asked about, not refused.
    // Built explicitly rather than passing `input` through. `Subject` declares
    // `mobileNumberNormalized` and `CreatePersonInput` carries `mobileNumber`, so
    // a structural pass compiles, leaves the field undefined, and silently turns
    // off every mobile-number rule in section 3 -- which is how those rules came
    // to pass their own unit tests while never once firing on a real request.
    const subject: Subject = {
      firstName: input.firstName,
      middleName: input.middleName ?? null,
      lastName: input.lastName,
      birthDate: input.birthDate,
      sex: input.sex,
      mobileNumberNormalized: normalizeMobile(input.mobileNumber),
    };

    const unacknowledged = (await this.findDuplicates(subject)).filter(
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

      await this.networks.assignWithin(trx, {
        personId: person.id,
        network,
        actorId: actor.accountId,
        startedAt: encodedAt,
      });

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
        await this.hierarchy.openAssignmentWithin(trx, {
          personId: person.id,
          leaderId: input.pastoralLeaderId,
          startedAt: encodedAt,
        });
      }

      await trx
        .insertInto('audit_log')
        .values({
          actor_id: actor.accountId,
          action: 'person.created',
          target_type: 'person',
          target_id: person.id,
          // Section 21 wants the values, not merely that it happened. An entry
          // recording only the identifiers cannot answer what was created.
          after: {
            ...(person as unknown as Record<string, Json>),
            network,
            pastoral_leader_id: input.pastoralLeaderId,
            acknowledged_duplicate_ids: [...(input.acknowledgedDuplicateIds ?? [])],
          },
        })
        .execute();

      const response = fullProfile(person);

      // Last, and recording exactly what the endpoint returns.
      await this.idempotency.completeWithin(trx, {
        ...claim,
        status: 201,
        body: response as Json,
      });

      return response;
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
      // Consistent with the other read paths. A Person absorbed by a merge is not
      // a valid target of any later write; the survivor carries the identity
      // (section 3, Person Merge). Merge is Stage 3, so this filters nothing
      // today -- which is exactly when the inconsistency is cheap to remove.
      .where('merged_into_id', 'is', null)
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
    // Both sides normalized. Normalizing only the term meant `Nuñez` was searched
    // for as `nunez` against a raw stored `Nuñez` and never found -- and section 8
    // makes this search the mechanism section 3's duplicate prevention depends on,
    // so a miss here creates the duplicate.
    //
    // `%` and `_` are escaped: unescaped, `q=%%` pages out the whole directory.
    const pattern = `%${escapeLike(normalizeName(term)).replace(/\s+/g, '%')}%`;
    const normalizedFirst = sql<string>`lower(translate(first_name, ${ACCENTED}, ${UNACCENTED}))`;
    const normalizedLast = sql<string>`lower(translate(last_name, ${ACCENTED}, ${UNACCENTED}))`;

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
          eb(normalizedFirst, 'like', pattern),
          eb(normalizedLast, 'like', pattern),
          eb(
            sql<string>`lower(translate(first_name || ' ' || last_name, ${ACCENTED}, ${UNACCENTED}))`,
            'like',
            pattern,
          ),
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
   * The population is narrowed in SQL and scored in TypeScript, and **the
   * narrowing is the part that can silently defeat a rule**: a candidate the SQL
   * excludes is never scored, however well the tiers are written.
   *
   * So it is deliberately loose. A row qualifies on a shared birthday, a shared
   * normalized mobile number, or a surname whose *normalized* first letter
   * matches — normalized, because section 3 requires diacritics stripped for
   * comparison and `Ángeles` against `Angeles` would otherwise be excluded before
   * the matcher ever saw it.
   *
   * Two rules depend on more than the surname initial and are given their own
   * branch rather than left to it: a shared first name, which is what carries the
   * surname-change case section 3 names, and a birthday that is a digit
   * transposition away, which by construction is not an equal birthday.
   *
   * That is a small set in a church of this size (section 2, Scale) and keeps
   * every rule in one readable place.
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

    // Compared against the normalized stored value, not the raw one. `unaccent`
    // is an extension this schema does not install, so the normalization is done
    // with `translate` over the characters that actually occur in these names.
    const normalizedLastName = sql<string>`lower(translate(last_name, ${ACCENTED}, ${UNACCENTED}))`;
    const normalizedFirstName = sql<string>`lower(translate(first_name, ${ACCENTED}, ${UNACCENTED}))`;

    query = query.where((eb) =>
      eb.or([
        ...(subject.birthDate === null || subject.birthDate === undefined
          ? []
          : [eb('birth_date', '=', subject.birthDate)]),
        eb(normalizedLastName, 'like', `${normalizedFirstLetter(subject.lastName)}%`),
        // The surname-change case: a woman's last name may change on marriage, so
        // a shared first name has to be able to reach her earlier record on its
        // own (section 3).
        eb(normalizedFirstName, '=', comparisonForm(subject.firstName)),
        ...(mobile === null ? [] : [eb('mobile_number_normalized', '=', mobile)]),
        // A birthday one digit-transposition away is not an equal birthday, so it
        // needs its own reach. Same length, same digits, different order.
        ...(subject.birthDate === null || subject.birthDate === undefined
          ? []
          : [eb('birth_date', 'in', transpositionsOf(subject.birthDate))]),
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
  ): Promise<Record<string, unknown>> {
    return this.db.transaction().execute(async (trx) => {
      // Read inside the transaction. Outside it, a concurrent edit landing
      // between the read and the update makes this `before` a value that was
      // never immediately prior -- an audit entry that describes a change nobody
      // made (section 21).
      const before = await trx
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

      if (before === undefined) {
        throw new NotFoundError('No such person.');
      }

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

      const response = fullProfile(person);

      await this.idempotency.completeWithin(trx, {
        ...claim,
        status: 200,
        body: response as Json,
      });

      return response;
    });
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

    const leaderNetwork = await this.networks.currentNetwork(leaderId);
    if (leaderNetwork !== network) {
      throw new InvariantViolationError(
        'A pastoral assignment may not cross Networks. This person belongs to the other Network from that leader.',
        { pastoral_leader_id: leaderId, person_network: network, leader_network: leaderNetwork },
      );
    }
  }
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

/**
 * The accented characters that occur in the names this church records, and their
 * plain equivalents. Used by the narrowing so that the SQL strips diacritics the
 * same way `normalizeName` does — section 3 requires it for comparison, and a
 * narrowing that does not strip them excludes rows the matcher would have scored.
 */
const ACCENTED = 'áàâäãåéèêëíìîïóòôöõúùûüñçÁÀÂÄÃÅÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÛÜÑÇ';
const UNACCENTED = 'aaaaaaeeeeiiiiooooouuuuncAAAAAAEEEEIIIIOOOOOUUUUNC';

/**
 * `%` and `_` are LIKE wildcards; a search term is data, not a pattern.
 *
 * Unescaped, `q=%%` pages out the whole directory — and section 8 makes that
 * directory church-wide by design, so the wildcard is the difference between a
 * name search and a bulk export.
 *
 * A backslash is escaped too, and first, or escaping the wildcards would turn a
 * literal backslash in a name into an escape for whatever followed it.
 * PostgreSQL's LIKE takes backslash as its escape character by default.
 */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function normalizedFirstLetter(value: string): string {
  return (normalizeName(value)[0] ?? '').toLowerCase();
}

function comparisonForm(value: string): string {
  return normalizeName(value);
}

/**
 * Every birthday one adjacent-digit transposition away from this one.
 *
 * Section 3 lists "birthdays differing by a transposition of digits" as a Tier 2
 * signal. The scoring implements it; without this the narrowing would never fetch
 * such a row unless the surname happened to share an initial, which is not what
 * the rule says.
 */
export function transpositionsOf(date: string): string[] {
  const swaps = new Set<string>();

  for (let i = 0; i < date.length - 1; i += 1) {
    if (!/\d/.test(date[i]) || !/\d/.test(date[i + 1]) || date[i] === date[i + 1]) {
      continue;
    }

    const swapped = `${date.slice(0, i)}${date[i + 1]}${date[i]}${date.slice(i + 2)}`;

    // Most swaps produce something that is not a date: `1994-03-02` swapped in
    // the month is `1994-30-02`, and PostgreSQL refuses to compare against it —
    // the whole statement errors rather than the value simply not matching. A
    // mis-keyed birthday that is not a real date cannot be in the table anyway,
    // so these are dropped rather than escaped.
    if (isCalendarDate(swapped)) {
      swaps.add(swapped);
    }
  }

  // `in ()` is not valid SQL, so an empty set needs a value that matches nothing.
  return swaps.size === 0 ? ['0001-01-01'] : [...swaps];
}

/** Whether a string is a real `YYYY-MM-DD` day, not merely shaped like one. */
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const [year, month, day] = value.split('-').map(Number);
  const asDate = new Date(Date.UTC(year, month - 1, day));

  return (
    asDate.getUTCFullYear() === year &&
    asDate.getUTCMonth() === month - 1 &&
    asDate.getUTCDate() === day
  );
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
