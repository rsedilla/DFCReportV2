import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import { AuditService } from '../audit/audit.service';
import {
  AuthorizationService,
  type Actor,
  type EffectiveGrant,
} from '../auth/authorization/authorization.service';
import { Capability } from '../auth/authorization/capabilities';
import { ScopeType } from '../auth/authorization/scopes';
import { HierarchyService } from '../hierarchy/hierarchy.service';
import { NetworksService } from '../networks/networks.service';
import {
  ApiError,
  DuplicateAcknowledgementRequiredError,
  InvariantViolationError,
  NotFoundError,
  ResourceBusyError,
  ScopeDeniedError,
  ValidationFailedError,
} from '../common/errors/api-error';
import { IdempotencyService } from '../common/idempotency/idempotency.service';
import { canonicalId, sameId } from '../common/identifiers';
import { manilaDayAfter, manilaDayOf, startOfManilaDay } from '../common/time/manila';
import { DATABASE, type Db } from '../database/database.module';
import { lockPersonsWithin } from '../database/person-lock';

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
    private readonly audit: AuditService,
    private readonly hierarchy: HierarchyService,
    private readonly networks: NetworksService,
    private readonly idempotency: IdempotencyService,
    private readonly authorization: AuthorizationService,
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
    /**
     * Whether the actor may see why a candidate matched. Section 8 forbids
     * disclosing an out-of-scope person's birthday or mobile number, and a reason
     * naming the field that matched asserts one — so the caller supplies the same
     * scope test the read endpoint uses.
     */
    canSeeReasons: (personId: string) => Promise<boolean>,
  ): Promise<Record<string, unknown>> {
    const network = this.networks.networkForSex(input.sex);

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

    // Canonical, because these are client-supplied identifiers matched against
    // ids that came out of the database. Compared raw, a client echoing the
    // candidate ids back in uppercase never satisfies the gate — and section 3's
    // refusal is then permanent, which is the block section 3 says must never
    // happen and is worse than the duplicate it guards against.
    const acknowledged = new Set(
      (input.acknowledgedDuplicateIds ?? []).map((candidateId) => canonicalId(candidateId)),
    );
    const matches = await this.findDuplicates(subject);

    // **The gate applies only to candidates the actor may see.**
    //
    // Every Tier 1 rule rests on a birthday or a mobile number, so an
    // out-of-scope Tier 1 candidate is one section 8 does not permit surfacing
    // (`visibleCandidates`). Refusing on one anyway would answer "acknowledge
    // this" with nothing to acknowledge, and the encoder could never create that
    // Person at all -- a permanent block, which is worse than the duplicate it
    // was guarding against and is what section 3 means by never blocking
    // creation.
    //
    // So an invisible duplicate does not gate. The cost is stated in section 3:
    // a cross-branch duplicate resting on a protected field is not caught for a
    // leader outside that branch, and is caught by the leader who holds them.
    let gated = false;
    for (const match of matches) {
      if (match.tier !== 1 || acknowledged.has(canonicalId(match.candidate.id))) {
        continue;
      }

      if (await canSeeReasons(match.candidate.id)) {
        gated = true;
        break;
      }
    }

    // **In-scope candidates only, and the status code is why.**
    //
    // Two reasons, and the second is the one that is easy to miss. An
    // out-of-scope Tier 1 candidate cannot be shown in full, so refusing on one
    // would answer "acknowledge this" with nothing to acknowledge and leave that
    // Person impossible to create.
    //
    // And 409-against-201 is itself a channel. Every Tier 1 rule reads a birthday
    // or a mobile number, so gating on an out-of-scope candidate would make the
    // status vary with a value section 8 protects — the same oracle as the
    // candidate list, one field further out. The status now varies only with what
    // the actor is already allowed to know.
    if (gated) {
      throw new DuplicateAcknowledgementRequiredError(
        await this.visibleDuplicatesFor(
          subject,
          canSeeReasons,
          (match) => match.tier === 1 && !acknowledged.has(canonicalId(match.candidate.id)),
        ),
      );
    }

    return this.db.transaction().execute(async (trx) => {
      if (input.pastoralLeaderId !== null) {
        // **Lock first, then check.** The leader's Network decides whether the edge
        // opened below is legal, and a correction to *their* Network can commit
        // between a check and this write. Validating beforehand — which this path
        // used to do, outside the transaction — left the answer stale: the deferred
        // trigger still refuses the write at COMMIT, but as a raw constraint
        // violation rendered `INTERNAL_ERROR`, which is the 500-instead-of-an-answer
        // failure this module exists to avoid. Two of the three checks in there
        // have no trigger behind them at all.
        await lockPersonsWithin(trx, [input.pastoralLeaderId]);

        // Section 4 gives a new Person's Network its effect on the date they are
        // encoded, so there is no earlier instant for this edge to be checked at.
        await this.assertLeaderIsAssignable(trx, input.pastoralLeaderId, network, new Date());
      }

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

      await this.audit.writeWithin(trx, {
        actorId: actor.accountId,
        action: 'person.created',
        targetType: 'person',
        targetId: person.id,
        // Section 21 wants the values, not merely that it happened. An entry
        // recording only the identifiers cannot answer what was created.
        after: {
          ...(person as unknown as Record<string, Json>),
          network,
          pastoral_leader_id: input.pastoralLeaderId,
          acknowledged_duplicate_ids: [...(input.acknowledgedDuplicateIds ?? [])],
        },
      });

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
    const normalized = normalizeName(term);

    // `normalizeName` drops suffix tokens and collapses separators, so a term
    // that looked like two characters can arrive here empty: `Jr`, `II`, `--`,
    // two spaces. An empty term builds the pattern `%%`, which matches every row
    // -- the directory dump `escapeLike` was added to prevent, reached by a
    // shorter route. Section 8 makes this search church-wide for identity
    // resolution, not for bulk export.
    if (normalized === '') {
      return { rows: [], nextCursor: null };
    }

    const pattern = `%${escapeLike(normalized).replace(/\s+/g, '%')}%`;
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
  /**
   * The candidates a viewer may be shown, membership and fields both redacted.
   *
   * Runs the matcher twice: once on the subject as given, and once on a subject
   * stripped of everything section 8 protects. The second run decides which
   * out-of-scope candidates may appear at all — see `visibleCandidates`.
   *
   * Here rather than at the call sites so that the pre-flight lookup and the
   * creation refusal cannot answer differently, and so that a third surface
   * cannot be added that runs the matcher once and leaks.
   */
  async visibleDuplicatesFor(
    subject: Subject,
    inScope: (personId: string) => Promise<boolean>,
    /**
     * Which matches to describe. The lookup describes all of them; the creation
     * refusal describes only the ones it is refusing on, because section 3's
     * refusal asks the actor to acknowledge *those* — a payload also carrying
     * every Tier 2 near-miss is asking them to acknowledge something the refusal
     * is not about.
     *
     * The redaction is the same either way, which is the point of the filter
     * living here rather than at the call site.
     */
    only: (match: Match) => boolean = () => true,
  ): Promise<Record<string, unknown>[]> {
    const [matches, publishable] = await Promise.all([
      this.findDuplicates(subject),
      this.findDuplicates({
        firstName: subject.firstName,
        middleName: subject.middleName,
        lastName: subject.lastName,
        sex: subject.sex,
        birthDate: null,
        mobileNumberNormalized: null,
      }),
    ]);

    return visibleCandidates(
      matches.filter(only),
      new Set(publishable.map((match) => match.candidate.id)),
      inScope,
    );
  }

  async findDuplicates(subject: Subject): Promise<Match[]> {
    // The same guard the search path got, for the same reason and one function
    // away. `normalizeName` drops suffix tokens, so `last_name=Jr` normalizes to
    // empty and the surname-initial branch below becomes LIKE '%' -- which
    // selects the whole directory into memory to be scored, on every request.
    if (normalizeName(subject.lastName) === '' && normalizeName(subject.firstName) === '') {
      return [];
    }

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
        // Omitted entirely rather than degenerating to LIKE '%' when the surname
        // normalizes away.
        ...(normalizedFirstLetter(subject.lastName) === ''
          ? []
          : [
              eb(
                normalizedLastName,
                'like',
                `${escapeLike(normalizedFirstLetter(subject.lastName))}%`,
              ),
            ]),
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

      await this.audit.writeWithin(trx, {
        actorId: actor.accountId,
        action: 'person.updated',
        targetType: 'person',
        targetId: personId,
        before,
        after: person,
      });

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
   * Corrects a person's recorded sex, and everything section 4 makes that mean.
   *
   * Sex determines Network, so this is never a field edit: it is a Network change,
   * carried out with the pastoral reassignment it forces, in one transaction, at
   * **one identical instant** written to all four rows. Section 4 is explicit that
   * the schema permits the operation at that instant and at no other — an edge
   * closed a microsecond later is open at the effective date, is compared with the
   * corrected Network on one end and the old one on the other, and is rejected. An
   * implementer meeting that as a constraint violation is tempted to move the
   * timestamps apart, which does not fix the write.
   *
   * The order below is not arbitrary. `changeWithin` carries section 4's two
   * preconditions — the refusal while the person leads anyone, and the backdate
   * floor — and it runs before the destination leader is validated so that those
   * refusals reach the administrator first. Reporting "that leader is in the wrong
   * Network" to somebody whose real problem is twelve disciples is unhelpful.
   *
   * The completion is last, because it takes the key's row lock and a concurrent
   * retry waits on that lock rather than being answered `REQUEST_IN_FLIGHT`
   * (section 22, and CLAUDE.md, Write endpoints).
   */
  async correctSex(
    personId: string,
    input: {
      sex: Sex;
      reason: string;
      pastoralLeaderId?: string;
      /** A `YYYY-MM-DD` Asia/Manila date. Its presence makes this a backdated correction. */
      effectiveDate?: string;
    },
    actor: Actor,
    claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    await this.assertCorrectSexIsHeldChurchWide(actor);

    // Section 5 invariant 4, which the Whole Church check above does **not** cover:
    // that one asks how far a grant reaches, this one asks who the actor is
    // relative to the target. Without it a non-Admin holding an explicit
    // Whole Church grant of `people.correct_sex` could correct their own record,
    // name any leader in the other Network, and detach themselves from their own
    // upline — the escalation section 7 gives as the reason this capability is
    // Admin-only, reached without ever holding `people.manage_pastoral_assignment`.
    //
    // Applied whether or not this particular correction forces a reassignment. The
    // capability moves a person between Networks either way, and a rule that
    // switched itself off depending on whether the target currently holds an edge
    // would be a rule nobody could reason about.
    const roles = await this.authorization.rolesFor(actor.accountId);

    const recordedAt = new Date();
    const backdated = input.effectiveDate !== undefined;
    let effectiveAt = recordedAt;

    if (input.effectiveDate !== undefined) {
      // A second capability, checked here rather than by the guard. Section 7's
      // guard evaluates one capability against one target; section 5 makes
      // backdating a separate grant, and both being Admin-only in the catalog is
      // not the same as one implying the other — an explicit grant of
      // `people.correct_sex` carries no power to date it in the past.
      await this.authorization.authorize(actor, Capability.RecordsBackdateEffectiveDate, {
        kind: 'person',
        personId,
      });

      effectiveAt = startOfManilaDay(input.effectiveDate);

      if (effectiveAt.getTime() > recordedAt.getTime()) {
        // Section 5 knows two cases: recording as of now, and Admin setting a date
        // **in the past**. A future date is neither, so nothing authorizes it, and
        // the fail-closed answer is to refuse rather than to invent forward-dating.
        throw new ValidationFailedError(
          'An effective date is a correction to the past. It cannot be in the future.',
          { field: 'effective_date', value: input.effectiveDate },
        );
      }
    }

    return this.db.transaction().execute(async (trx) => {
      // Both persons whose Networks decide the new edge's legality, in one call so
      // the ordering is decided by the helper rather than by the order that reads
      // best here. `changeWithin` and `reassignWithin` each take a subset again,
      // which is free: a session is always granted a lock it already holds.
      await lockPersonsWithin(
        trx,
        input.pastoralLeaderId === undefined ? [personId] : [personId, input.pastoralLeaderId],
      );

      // Section 5 invariant 4, inside the transaction and after the lock, for the
      // reason the reassignment path gives: the walk it makes is over the tree, and
      // a decision taken before the lock is taken against a tree the winner of it
      // may have changed. The roles it compares are read on the pool beforehand,
      // because those are a fact about the actor's account.
      await this.hierarchy.assertMayReparent(trx, { personId: actor.personId, roles }, personId);

      // Read inside the transaction, as the basic edit does: outside it, a
      // concurrent write landing between the read and the update makes this
      // `before` a value that was never immediately prior — an audit entry
      // describing a change nobody made (section 21).
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
          'merged_into_id',
        ])
        .where('id', '=', personId)
        .executeTakeFirst();

      if (before === undefined) {
        throw new NotFoundError('No such person.');
      }

      if (before.merged_into_id !== null) {
        throw new InvariantViolationError(
          'That person was absorbed by a merge. Correct the surviving Person instead.',
          { person_id: personId, merged_into_id: before.merged_into_id },
        );
      }

      if (before.sex === input.sex) {
        // Section 4: the sex-to-Network mapping is total, so this is the only way
        // for a correction to change nothing. Refused rather than accepted
        // silently — the operation demands a reason and writes an audit trail, and
        // an audited correction that corrected nothing misleads whoever reads it.
        // A client that lost a real response retries with the same
        // `Idempotency-Key`, which is what that header is for.
        throw new ValidationFailedError('That person is already recorded as that sex.', {
          field: 'sex',
          value: input.sex,
        });
      }

      const toNetwork = this.networks.networkForSex(input.sex);
      const assignment = await this.hierarchy.openAssignmentOf(trx, personId);

      // An open row with a null `leader_id` is a Network root (section 5), which
      // has nothing above it to point elsewhere. What this asks is whether an
      // **edge** is open; whether the person is a *root* is a different question,
      // asked by `changeWithin`, and section 5 settled on 2026-08-23 that both are
      // answerable from the row.
      const requiresReassignment = assignment !== null && assignment.leaderId !== null;

      // A root holds an open row with no leader, so it satisfies neither branch
      // below honestly: the "no open pastoral assignment" refusal would state
      // something false about the record, and it would fire before `changeWithin`
      // could refuse the root for the reason section 4 gives. Left to fall through,
      // so the answer comes from the rule that applies.
      const isRoot = assignment !== null && assignment.leaderId === null;

      if (requiresReassignment && input.pastoralLeaderId === undefined) {
        throw new ValidationFailedError(
          'This person has a pastoral leader in their current Network, so the correction must name the leader they move to in the new one.',
          { field: 'pastoral_leader_id' },
        );
      }

      if (!requiresReassignment && !isRoot && input.pastoralLeaderId !== undefined) {
        // Refused rather than ignored. A client naming a leader expects a
        // reassignment, and silently dropping it would leave them believing one
        // happened.
        throw new ValidationFailedError(
          'This person has no open pastoral assignment, so there is no reassignment to perform and no leader to name.',
          { field: 'pastoral_leader_id' },
        );
      }

      if (input.pastoralLeaderId !== undefined && sameId(input.pastoralLeaderId, personId)) {
        // Section 5 invariant 2. With no open downline edge — which section 4 has
        // already required — this person's subtree is themselves alone, so a
        // one-node cycle is the only one reachable here. The `no_self` check
        // constraint would refuse it; this makes the refusal an answer.
        throw new InvariantViolationError('A person cannot be their own pastoral leader.', {
          field: 'pastoral_leader_id',
        });
      }

      if (requiresReassignment) {
        const lifecycle = await trx
          .selectFrom('person_lifecycle')
          .select('state')
          .where('person_id', '=', personId)
          .where('ended_at', 'is', null)
          .executeTakeFirst();

        if (lifecycle?.state === 'ARCHIVED') {
          // Section 5 forbids reassigning an archived Person, and the atomic pair
          // is a reassignment. Where they hold no open edge the correction is not
          // refused at all, which is why this sits inside the branch: a data
          // correction on an archived record is legitimate; re-parenting one is not.
          throw new InvariantViolationError(
            'That person is archived and still holds a pastoral assignment. Restore them first, then correct their sex.',
            { person_id: personId },
          );
        }
      }

      const { from } = await this.networks.changeWithin(trx, {
        personId,
        toNetwork,
        effectiveAt,
        backdated,
        actorId: actor.accountId,
        reason: input.reason,
      });

      let previousLeaderId: string | null = null;

      if (requiresReassignment && input.pastoralLeaderId !== undefined) {
        // Validated against the **new** Network and as of the effective instant,
        // which is what the constraint trigger compares. Section 4: the person
        // being corrected moves to a leader in their new Network, while a disciple
        // would move within their own unchanged one — two different rules, and this
        // is the first of them.
        await this.assertLeaderIsAssignable(trx, input.pastoralLeaderId, toNetwork, effectiveAt);

        ({ previousLeaderId } = await this.hierarchy.reassignWithin(trx, {
          personId,
          leaderId: input.pastoralLeaderId,
          effectiveAt,
        }));
      }

      const person = await trx
        .updateTable('persons')
        .set({ sex: input.sex })
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

      // **One entry per action performed** (section 21), not one per request. Each
      // of these is separately named on section 21's list, and each is found by a
      // different search: a reader looking for pastoral transfers must find that
      // entry whether it arose from a reassignment or from a correction (section 5).
      await this.audit.writeWithin(trx, {
        actorId: actor.accountId,
        action: 'sex.corrected',
        targetType: 'person',
        targetId: personId,
        before: { sex: before.sex },
        after: { sex: person.sex },
        reason: input.reason,
      });

      await this.audit.writeWithin(trx, {
        actorId: actor.accountId,
        action: 'network.changed',
        targetType: 'person',
        targetId: personId,
        before: { network: from },
        after: { network: toNetwork, effective_at: effectiveAt.toISOString() },
        reason: input.reason,
      });

      if (requiresReassignment && input.pastoralLeaderId !== undefined) {
        await this.audit.writeWithin(trx, {
          actorId: actor.accountId,
          action: 'pastoral_assignment.transferred',
          targetType: 'person',
          targetId: personId,
          // Section 5 requires previous leader, new leader and timestamp.
          before: { leader_id: previousLeaderId },
          after: { leader_id: input.pastoralLeaderId, effective_at: effectiveAt.toISOString() },
          reason: input.reason,
        });
      }

      if (backdated) {
        await this.audit.writeWithin(trx, {
          actorId: actor.accountId,
          action: 'effective_date.backdated',
          targetType: 'person',
          targetId: personId,
          // Section 5: "audit logged with both the recorded date and the effective
          // date". Both, because the gap between them is the whole point of the
          // entry — it is what a later reader needs to explain a figure that moved.
          after: {
            operation: 'sex.corrected',
            recorded_at: recordedAt.toISOString(),
            effective_at: effectiveAt.toISOString(),
            effective_date: manilaDayOf(effectiveAt),
          },
          reason: input.reason,
        });
      }

      const response = {
        ...fullProfile(person),
        network: toNetwork,
        pastoral_leader_id: requiresReassignment ? (input.pastoralLeaderId ?? null) : null,
        // Both renderings, additively. `effective_at` is the instant the four rows
        // carry, rendered in UTC because that is unambiguous; `effective_date` is
        // the Asia/Manila day an administrator submitted and thinks in (section 20).
        effective_at: effectiveAt.toISOString(),
        effective_date: manilaDayOf(effectiveAt),
      };

      // Last, and recording exactly what the endpoint returns (section 22).
      await this.idempotency.completeWithin(trx, {
        ...claim,
        status: 200,
        body: response,
      });

      return response;
    });
  }

  /**
   * Reassigns a person to a different pastoral leader (SKILL.md section 5).
   *
   * **Only the reassigned person's own row changes.** Their subtree moves with
   * them because it resolves through the tree, and rewriting a descendant's row to
   * reflect a leader's move destroys assignment history — a partial rewrite
   * silently detaches a branch, so the descendants disappear from the moved
   * leader's totals while appearing under nobody.
   *
   * The five invariants divide by what they are about, which is why they are not
   * all in one place. Invariant 4 is about the actor's position and lives in
   * `hierarchy`, where the second caller of it already is. Invariant 1 is about the
   * actor's scope over two objects the guard does not evaluate. Invariants 2 and 5
   * are about the resulting record and are checked here against the transaction
   * that will write it, with the database as the backstop for both.
   *
   * **Every decision that depends on the tree is taken inside the transaction,
   * after the lock**, because the lock is precisely when two reassignments of one
   * person overlap: a decision taken beforehand is made against a tree the winner
   * has since changed. That includes the guard's own conclusion about the person,
   * which a concurrent move can invalidate between the guard and the write.
   *
   * What is read *before* it is what cannot change under a tree write — the
   * actor's roles and grants, which are facts about their account. Reading those
   * inside would ask a bounded pool for a second connection while holding one,
   * which section 24 names as a liveness hazard.
   *
   * This rests on READ COMMITTED, which is the default and is not set anywhere: a
   * statement after the lock takes a fresh snapshot and therefore sees the winner's
   * commit. Under REPEATABLE READ the snapshot would be taken by the first
   * statement of the transaction — the key hashing inside `lockPersonsWithin`,
   * before the lock is held — and every read after it would be stale again.
   */
  async reassignPastoralLeader(
    personId: string,
    input: { leaderId: string; reason?: string; effectiveDate?: string },
    actor: Actor,
    claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    // Read here, on the pool, and deliberately: these are facts about the actor's
    // account rather than about the tree, so nothing a concurrent reassignment does
    // can change them — and reading them inside the transaction would be the
    // pooled-read-while-holding-one that section 24 forbids.
    const [roles, grants] = await Promise.all([
      this.authorization.rolesFor(actor.accountId),
      this.authorization.grantsFor(actor.accountId),
    ]);
    const backdated = input.effectiveDate !== undefined;

    if (backdated) {
      // The second capability, which the guard does not check (section 5). Asked
      // before the transaction because it is a fact about the actor's grants and
      // nothing in the tree can change the answer.
      await this.authorization.authorize(actor, Capability.RecordsBackdateEffectiveDate, {
        kind: 'person',
        personId,
      });

      if (input.reason === undefined) {
        // Section 5: backdating "always requires a reason". Not required otherwise.
        throw new ValidationFailedError('Backdating an effective date requires a reason.', {
          field: 'reason',
        });
      }
    }

    return this.db.transaction().execute(async (trx) => {
      // Both persons whose Networks decide the edge's legality, in one call so the
      // ordering is the helper's rather than the order that reads best here.
      // Locking the **person** as well as the leader is what makes concurrent
      // reassignments of one person serialize rather than collide on the partial
      // unique index (section 5, Database enforcement).
      await lockPersonsWithin(trx, [personId, input.leaderId]);

      // **Re-made here, after the lock, against this transaction.** The guard
      // reached this same conclusion before the request queued; a concurrent move
      // can have carried the person out of the actor's subtree since. Both walks
      // read the tree, which is why the predicates take an executor — the choice
      // was never "pool or transaction", it was "stale or transaction-capable".
      //
      // The lock covers the person and the destination leader, not the actor's
      // upline, so these narrow the window rather than closing it. Closing it
      // entirely would mean locking every row a scope decision reads, which is the
      // whole tree above the actor.
      await this.hierarchy.assertMayReparent(trx, { personId: actor.personId, roles }, personId);

      if (!(await this.isWithinManageScope(trx, actor, grants, personId))) {
        throw new ScopeDeniedError(
          'You hold people.manage_pastoral_assignment, but not over this person.',
          { capability: Capability.PeopleManagePastoralAssignment },
        );
      }

      const recordedAt = new Date();
      // Read after the lock, deliberately. Stamped before it, a request that waited
      // carries an instant earlier than the winner's `started_at` and is refused as
      // too early — a refusal caused purely by contention, and one section 22 would
      // store against the idempotency key and replay for the whole retention.
      const effectiveAt =
        input.effectiveDate === undefined ? recordedAt : startOfManilaDay(input.effectiveDate);

      if (effectiveAt.getTime() > recordedAt.getTime()) {
        throw new ValidationFailedError(
          'An effective date is a correction to the past. It cannot be in the future.',
          { field: 'effective_date', value: input.effectiveDate },
        );
      }

      const person = await trx
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
          'merged_into_id',
        ])
        .where('id', '=', personId)
        .executeTakeFirst();

      if (person === undefined) {
        throw new NotFoundError('No such person.');
      }

      if (person.merged_into_id !== null) {
        throw new InvariantViolationError(
          'That person was absorbed by a merge. Reassign the surviving Person instead.',
          { person_id: personId, merged_into_id: person.merged_into_id },
        );
      }

      const current = await this.hierarchy.openAssignmentOf(trx, personId);

      // Invariant 1, against the state this transaction will actually write over.
      await this.assertBothEndpointsInScope(
        trx,
        actor,
        grants,
        current?.leaderId ?? null,
        input.leaderId,
      );

      if (current !== null && current.leaderId === null) {
        // Section 5, Network roots: a root cannot be reassigned by anyone, Admin
        // included, because there is no valid leader above them. Changing who holds
        // a root position is a Network-level decision, not a pastoral one.
        throw new InvariantViolationError(
          'That person is a Network root and has no leader above them. Changing who holds a root position is a Network-level decision, not a reassignment.',
          { person_id: personId },
        );
      }

      const lifecycle = await trx
        .selectFrom('person_lifecycle')
        .select('state')
        .where('person_id', '=', personId)
        .where('ended_at', 'is', null)
        .executeTakeFirst();

      if (lifecycle?.state === 'ARCHIVED') {
        // Section 5, Lifecycle state. Restore them first, which is an explicit and
        // separately audited decision — keeping the two apart is what stops an
        // archived record re-entering a leader's current totals through a side door.
        throw new InvariantViolationError(
          'That person is archived. Restore them to current first, then reassign them.',
          { person_id: personId },
        );
      }

      if (sameId(input.leaderId, personId)) {
        throw new InvariantViolationError('A person cannot be their own pastoral leader.', {
          field: 'leader_id',
        });
      }

      if (
        current !== null &&
        current.leaderId !== null &&
        sameId(current.leaderId, input.leaderId)
      ) {
        // Section 4 refuses the exact analogue for a sex correction, on reasoning
        // that applies unchanged: this operation is audited, and a transfer whose
        // before and after name the same leader misleads whoever reads the log.
        // It would also put a boundary in the assignment history where nothing
        // happened, so "how long has this person been under this leader" answers
        // wrongly ever after. A client that lost the response retries with the
        // same `Idempotency-Key`, which is what that header is for.
        throw new ValidationFailedError('That person is already under that leader.', {
          field: 'leader_id',
          value: input.leaderId,
        });
      }

      // Invariant 2. Rejected before writing, and the recursive queries carry their
      // own cycle detection as the backstop for a cycle arriving by any other route.
      const subtree = await this.hierarchy.subtreeOf(trx, personId);
      if (subtree.some((descendantId) => sameId(descendantId, input.leaderId))) {
        throw new InvariantViolationError(
          'That leader is below this person in the tree, so the assignment would create a cycle.',
          { person_id: personId, leader_id: input.leaderId },
        );
      }

      // Invariant 5, **as of the effective date**, which is the instant the
      // constraint trigger compares. Validating against today would let this answer
      // that a backdated edge is legal and then fail on it at commit.
      const personNetwork = await this.networks.networkAsOf(trx, personId, effectiveAt);
      if (personNetwork === null) {
        throw new InvariantViolationError(
          'That person had no Network on record at that date, so no assignment can be recorded then.',
          { person_id: personId },
        );
      }

      await this.assertLeaderIsAssignable(trx, input.leaderId, personNetwork, effectiveAt);

      // **The same method as the Network correction, and deliberately not the same
      // term.** Term (a) is the current assignment's `started_at`: at that instant
      // the close is zero-length and therefore inert, so the leader this person
      // actually had for the whole period disappears from every as-of query, and
      // below it the row cannot be closed at all.
      //
      // Term (b) here ranges over closed rows where **this person is the
      // subordinate**, and bounds the case term (a) leaves unbounded — a person
      // with no open assignment, for whom an effective date inside an
      // already-closed period would leave two rows valid at one instant and give
      // "who led them on date D" two answers. Section 4's version reaches the other
      // direction as well, because the trigger *it* guards selects edges both ways;
      // this one does not fire that trigger, and borrowing the wider term refused
      // legitimate corrections for every leader who had ever had a disciple moved.
      const floor = await this.hierarchy.backdateFloorFor(trx, personId, 'as-subordinate');

      if (floor !== null && effectiveAt.getTime() <= floor.getTime()) {
        throw this.reassignmentTooEarly(personId, floor, backdated);
      }

      const { previousLeaderId } = await this.hierarchy.reassignWithin(trx, {
        personId,
        leaderId: input.leaderId,
        effectiveAt,
      });

      await this.audit.writeWithin(trx, {
        actorId: actor.accountId,
        action: 'pastoral_assignment.transferred',
        targetType: 'person',
        targetId: personId,
        // Section 5: actor, target, previous leader, new leader, and timestamp.
        before: { leader_id: previousLeaderId },
        after: { leader_id: input.leaderId, effective_at: effectiveAt.toISOString() },
        reason: input.reason ?? null,
      });

      if (backdated) {
        await this.audit.writeWithin(trx, {
          actorId: actor.accountId,
          action: 'effective_date.backdated',
          targetType: 'person',
          targetId: personId,
          after: {
            operation: 'pastoral_assignment.transferred',
            recorded_at: recordedAt.toISOString(),
            effective_at: effectiveAt.toISOString(),
            effective_date: manilaDayOf(effectiveAt),
          },
          reason: input.reason ?? null,
        });
      }

      const response = {
        ...fullProfile(person),
        pastoral_leader_id: input.leaderId,
        previous_pastoral_leader_id: previousLeaderId,
        effective_at: effectiveAt.toISOString(),
        effective_date: manilaDayOf(effectiveAt),
      };

      await this.idempotency.completeWithin(trx, {
        ...claim,
        status: 200,
        body: response,
      });

      return response;
    });
  }

  /**
   * SKILL.md section 5 invariant 1: a reassignment has a source and a destination
   * and the actor must be authorized for **both**.
   *
   * Validating only the destination lets an actor pull people in from a branch
   * they do not oversee; validating only the source lets them push people out of
   * their scope and lose them. The guard evaluates the person being reassigned and
   * neither of these, which is why both are here.
   *
   * A null source is a Person with no current assignment. There is no second
   * endpoint to authorize, and section 5 permits an unassigned Person.
   */
  async assertBothEndpointsInScope(
    executor: Db,
    actor: Actor,
    grants: readonly EffectiveGrant[],
    sourceLeaderId: string | null,
    destinationLeaderId: string,
  ): Promise<void> {
    const endpoints: { label: string; personId: string }[] = [
      { label: 'leader_id', personId: destinationLeaderId },
      ...(sourceLeaderId === null ? [] : [{ label: 'current_leader', personId: sourceLeaderId }]),
    ];

    for (const endpoint of endpoints) {
      const covered = await this.isWithinManageScope(executor, actor, grants, endpoint.personId);

      if (!covered) {
        throw new ScopeDeniedError(
          'A reassignment must stay within your authorized scope at both ends: the leader the person is moving from, and the leader they are moving to.',
          { capability: Capability.PeopleManagePastoralAssignment, field: endpoint.label },
        );
      }
    }
  }

  /** Whether the actor holds `people.manage_pastoral_assignment` over this person. */
  private async isWithinManageScope(
    executor: Db,
    actor: Actor,
    grants: readonly EffectiveGrant[],
    personId: string,
  ): Promise<boolean> {
    return this.authorization.coversWith(
      executor,
      actor,
      grants,
      Capability.PeopleManagePastoralAssignment,
      { kind: 'person', personId },
    );
  }

  /**
   * The refusal for an effective date at or before the current assignment's start.
   *
   * Names a date only where a date can legally be submitted, for the reason
   * `networks.floorBreach` gives: an effective date is a day resolved to its start
   * in Asia/Manila, so where the bound falls on the current day the day after it is
   * tomorrow, which no reassignment may take.
   */
  private reassignmentTooEarly(personId: string, floor: Date, backdated: boolean): ApiError {
    if (!backdated) {
      // Reached only where a record for this person carries the very instant this
      // reassignment is taking — the clock is read after the lock, so a request
      // that merely waited is not refused here. `RESOURCE_BUSY` rather than a 409:
      // contention reaches no decision, and section 22 stores a 4xx against the
      // idempotency key while releasing a 5xx, so a 409 here would replay this
      // transient failure for the whole retention and the advice to retry would be
      // advice to do the one thing that cannot work.
      return new ResourceBusyError({ person_id: personId });
    }

    const earliest = manilaDayAfter(floor);

    if (startOfManilaDay(earliest).getTime() > Date.now()) {
      return new InvariantViolationError(
        'This reassignment cannot be backdated: the records it would have to reach past were written today. Submit it without an effective date, and it will take effect now.',
        { person_id: personId },
      );
    }

    return new InvariantViolationError(
      'That effective date is too early: it would erase or overlap a period already recorded for this person. Use the earliest date given here or later.',
      { person_id: personId, earliest_effective_date: earliest },
    );
  }

  /**
   * Whether the actor may see this person's full profile (SKILL.md section 8).
   *
   * Asked of the authorization service rather than reimplemented, so that a Senior
   * Pastor's Whole Church scope and an Admin-issued wider grant reach the same
   * answer here as they do in the guard.
   *
   * Here rather than in the controller because it reads the tree and the Network,
   * and a caller inside a transaction must be able to hand it that transaction —
   * a pooled read taken while holding one needs a second connection from a bounded
   * pool (section 24). The controller has no connection to give, which is the
   * shape of the argument for it living beside the data access.
   */
  async isWithinViewScope(executor: Db, actor: Actor, personId: string): Promise<boolean> {
    return this.authorization.covers(executor, actor, Capability.PeopleViewSubtree, {
      kind: 'person',
      personId,
    });
  }

  /**
   * The five fields section 8 permits for a person outside the viewer's pastoral
   * scope — Member ID, full name, sex, current Network and the name of their
   * current direct leader — plus two that are not about them.
   *
   * `id` is the handle the duplicate-acknowledgement flow needs to name a candidate
   * back to the server, and `scope` tells a client it is looking at a withheld
   * profile rather than an empty one. Section 8's list is about a person's
   * *details*, and neither of these is one; they are named here rather than left
   * for a reader to notice the count does not match.
   *
   * Written as a list of what is *included* rather than as a list of what is
   * removed. A redaction that deletes named fields lets the next field added to
   * the profile through by default, which is the wrong direction for a rule about
   * what the church may see.
   */
  async minimalIdentity(person: PersonRecord): Promise<Record<string, unknown>> {
    const [network, leader] = await Promise.all([
      this.networks.currentNetwork(this.db, person.id),
      this.hierarchy.directLeaderNameOf(person.id),
    ]);

    return {
      id: person.id,
      member_id: person.member_id,
      full_name: composeName(person),
      sex: person.sex,
      network,
      direct_leader_name: leader,
      // Named, so a client can tell a withheld profile from an empty one and say
      // so, rather than rendering a person who looks like they have no details.
      scope: 'IDENTITY_ONLY',
    };
  }

  /**
   * Refuses `people.correct_sex` held at anything narrower than Whole Church.
   *
   * Section 7 gives this capability one scope, and the guard alone cannot hold
   * that: the guard asks whether a grant covers the *target*, so a grant issued at
   * `OWN_SUBTREE` would pass for everyone inside that subtree. Held there it is
   * exactly the escalation the capability is Admin-only to close — moving a person
   * between Networks, and re-parenting them on the way, without ever holding
   * `people.manage_pastoral_assignment`.
   *
   * `SCOPE_DENIED` rather than `CAPABILITY_DENIED`: the actor does hold the
   * capability, and what fails is its reach (section 22).
   */
  private async assertCorrectSexIsHeldChurchWide(actor: Actor): Promise<void> {
    const churchWide = (await this.authorization.grantsFor(actor.accountId)).some(
      (grant) =>
        grant.capability === Capability.PeopleCorrectSex &&
        grant.scope.type === ScopeType.WholeChurch,
    );

    if (!churchWide) {
      throw new ScopeDeniedError(
        'Correcting a person’s sex is a Whole Church operation. A narrower grant of it covers nothing.',
        { capability: Capability.PeopleCorrectSex },
      );
    }
  }

  /**
   * Refuses a leader the new edge could not legally point at.
   *
   * The database enforces the same-Network rule and would reject this at commit
   * (section 5), but a constraint violation surfacing as a 500 tells an encoder
   * nothing. This turns the two reachable cases into the answers section 22
   * defines for them.
   */
  private async assertLeaderIsAssignable(
    /**
     * Whose view of `persons` and `person_lifecycle` to trust. Both callers now
     * validate inside their own transaction and after taking the person lock —
     * creation used to validate outside it, which left the answer stale by the time
     * the edge was written.
     */
    executor: Db,
    leaderId: string,
    network: NetworkName,
    /**
     * The instant the resulting edge takes effect. The constraint trigger compares
     * `network_as_of(leader, started_at)`, so a backdated correction has to be
     * checked against the leader's Network *then* rather than now, or the answer
     * here disagrees with the answer at commit.
     */
    at: Date,
  ): Promise<void> {
    const leader = await executor
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

    // An archived Person acquiring a new disciple would leave a live pastoral
    // edge under someone who is not a current Person -- the same corruption
    // section 3 refuses when archiving a Person who leads a Cell. Restore them
    // first, which is an explicit and separately audited decision.
    const lifecycle = await executor
      .selectFrom('person_lifecycle')
      .select('state')
      .where('person_id', '=', leaderId)
      .where('ended_at', 'is', null)
      .executeTakeFirst();

    if (lifecycle?.state === 'ARCHIVED') {
      throw new InvariantViolationError(
        'That leader is archived. Restore them first, or choose another leader.',
        { pastoral_leader_id: leaderId },
      );
    }

    // Through `executor`, like every other read here. A pooled read taken while
    // the caller holds a transaction needs a second connection from a bounded pool
    // and starves once enough requests do it at once.
    const leaderNetwork = await this.networks.networkAsOf(executor, leaderId, at);
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
  const digits = [...date.matchAll(/\d/g)].map((match) => match.index);

  // **Any two digit positions, not only adjacent ones.** The scorer accepts any
  // two-position swap, and the commonest date mis-key of all is month against day
  // -- 1994-03-02 for 1994-02-03, which a US-format habit produces and which is
  // not an adjacent swap. Generating only adjacent pairs meant the narrowing
  // could not fetch the row the rule exists to catch, so the rule fired only when
  // the surname initial happened to match.
  for (let a = 0; a < digits.length; a += 1) {
    for (let b = a + 1; b < digits.length; b += 1) {
      const i = digits[a];
      const j = digits[b];

      if (date[i] === date[j]) {
        continue;
      }

      const chars = [...date];
      chars[i] = date[j];
      chars[j] = date[i];
      const swapped = chars.join('');

      // Most swaps produce something that is not a date: `1994-03-02` swapped in
      // the month is `1994-30-02`, and PostgreSQL refuses to compare against it —
      // the whole statement errors rather than the value simply not matching. A
      // mis-keyed birthday that is not a real date cannot be in the table anyway,
      // so these are dropped rather than escaped.
      if (isCalendarDate(swapped)) {
        swaps.add(swapped);
      }
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

/**
 * The candidates a caller may be shown, membership included.
 *
 * **Two separate redactions, and the first is the one that took three attempts.**
 *
 * *Which candidates appear.* A candidate outside the viewer's pastoral scope is
 * surfaced only if they would **still** have matched a subject carrying nothing
 * section 8 protects — no birthday, no mobile number. `publishableIds` is that
 * second run of the matcher, and membership out of scope is therefore a function
 * of the names and sex alone.
 *
 * This is why **membership is itself the disclosure**: with a first name that
 * matches nothing, "this person is in the result" is exactly "their birthday
 * equals the value I submitted", answered 200 either way and writing nothing.
 * Redacting fields on a returned candidate cannot close that, which is what the
 * first two attempts did.
 *
 * It is a second run rather than a flag on the rule that fired, and that
 * distinction cost a CI round. A candidate matching on *both* the names and the
 * birthday is classified by the stronger rule, which reads a protected field — so
 * a flag hid people whose presence the names alone already explain, which is
 * backwards. What matters is not which rule won, but whether a publishable rule
 * would have matched at all.
 *
 * *What each candidate carries.* In scope, the tier and the reasons. Out of
 * scope, neither — the reasons name the field that matched, and the tier is
 * derived from which rule fired, so with an equal name Tier 1 means the birthday
 * matched and Tier 2 means it did not.
 *
 * The cost is real and is accepted (`SKILL.md` section 3): a cross-branch
 * duplicate whose surname changed on marriage is no longer surfaced to a leader
 * outside that branch, because that rule reads a birthday.
 *
 * One function, used by every surface that returns candidates, so the pre-flight
 * lookup and the creation refusal cannot answer differently.
 */
export async function visibleCandidates(
  matches: readonly Match[],
  publishableIds: ReadonlySet<string>,
  inScope: (personId: string) => Promise<boolean>,
): Promise<Record<string, unknown>[]> {
  const visible: Record<string, unknown>[] = [];

  for (const match of matches) {
    const withinScope = await inScope(match.candidate.id);

    if (!withinScope && !publishableIds.has(match.candidate.id)) {
      continue;
    }

    visible.push(describeCandidate(match, withinScope));
  }

  return visible;
}

/**
 * A candidate as the caller may see it.
 *
 * `inScope` is required rather than defaulting to true. A default that discloses
 * means a call site which forgets it leaks and still compiles — the wrong
 * direction for a rule about what the church may see, and the same argument this
 * project made for `completeWithin` taking a transaction rather than the pool.
 *
 * It is false for a candidate outside the viewer's pastoral scope, and
 * then **neither the tier nor the reasons travel**.
 *
 * Withholding only the reasons was not enough, and the reason it was not is worth
 * stating. The tier is derived from which rule matched: with the same first and
 * last name, Tier 1 means the birthday was equal and Tier 2 means it was not. So
 * a tier returned church-wide is a yes/no birthday oracle over a name section 8
 * already makes visible — enumerable, answered 200 every time, writing nothing.
 * The wording was hidden and the information kept.
 *
 * What an out-of-scope candidate carries instead is that they are a possible
 * match. That is what section 3 needs the encoder to know: somebody may already
 * be recorded, ask the leader who holds them. It is not what a caller can binary
 * search on.
 */
export function describeCandidate(match: Match, inScope: boolean): Record<string, unknown> {
  const identity = {
    id: match.candidate.id,
    member_id: match.candidate.memberId,
    full_name: [match.candidate.firstName, match.candidate.middleName, match.candidate.lastName]
      .filter((part) => part !== null && part !== '')
      .join(' '),
    sex: match.candidate.sex,
  };

  return inScope
    ? { ...identity, tier: match.tier, reasons: match.reasons }
    : { ...identity, possible_match: true };
}

/** Kept for the import path, which writes through this service (section 2). */
export type PeopleTransaction = Transaction<Database>;
