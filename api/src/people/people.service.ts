import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import { HierarchyService } from '../hierarchy/hierarchy.service';
import { NetworksService } from '../networks/networks.service';
import { DuplicateAcknowledgementRequiredError, NotFoundError } from '../common/errors/api-error';
import { IdempotencyService } from '../common/idempotency/idempotency.service';
import { canonicalId } from '../common/identifiers';
import { AlreadyBootstrappedError } from '../common/errors/already-bootstrapped';
import { DATABASE, type Db } from '../database/database.module';
import { lockPersonsWithin } from '../database/person-lock';

import { type Subject } from './duplicate-matching';
import { assertLeaderIsAssignable } from './leader-assignability';
import { PeopleDuplicatesService } from './people.duplicates.service';
import { fullProfile, normalizeMobile, type CreatePersonInput } from './people.shared';

import type { CurrentClaim } from '../common/idempotency/current-idempotency.decorator';
import type { CivilStatus, Database, Json, NetworkName, Sex } from '../database/schema';
import type { Transaction } from 'kysely';

/**
 * Person, Member ID, and the basic edit (SKILL.md section 2, Modules).
 *
 * **The module is the only writer of `persons`; this class is not.** The sex
 * correction writes it too, which is what section 2's rule is actually about — it
 * gives a table to a module, not to a class. Said precisely because this change
 * exists to make ownership legible, and the sentence it replaced ("It is the only
 * writer of `persons`") sat directly above a paragraph contrasting this class with
 * the rest of the module, which is the reading that makes it false.
 *
 * The module's other work has its own services, because a single file assembling
 * every write path's invariants by hand is how one of them quietly ends up
 * missing a step: reads and search in `PeopleReadService`, matching and its
 * section 8 redaction in `PeopleDuplicatesService`, and the two operations that
 * carry a section number of their own in `PeopleSexCorrectionService` and
 * `PeopleReassignmentService`.
 *
 * Lifecycle and merge are not here yet and that is deliberate rather than
 * unfinished: section 3 refuses to archive a Person who leads a Cell, and refuses
 * to merge one whose Cell relationships conflict — both need `cells`, which is
 * Stage 3. Building them now would mean writing the guard as a comment, which is
 * the failure this project keeps correcting. `docs/ROADMAP.md` puts neither in
 * Stage 2.
 */
@Injectable()
export class PeopleService {
  constructor(
    @Inject(DATABASE) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly hierarchy: HierarchyService,
    private readonly networks: NetworksService,
    private readonly idempotency: IdempotencyService,
    private readonly duplicates: PeopleDuplicatesService,
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
    const matches = await this.duplicates.findDuplicates(subject);

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
        await this.duplicates.visibleDuplicatesFor(
          subject,
          canSeeReasons,
          (match) => match.tier === 1 && !acknowledged.has(canonicalId(match.candidateId)),
        ),
      );
    }

    return this.db.transaction().execute(async (trx) => {
      if (input.placement.kind === 'UNDER') {
        const pastoralLeaderId = input.placement.pastoralLeaderId;
        // **Lock first, then check.** The leader's Network decides whether the edge
        // opened below is legal, and a correction to *their* Network can commit
        // between a check and this write. Validating beforehand — which this path
        // used to do, outside the transaction — left the answer stale: the deferred
        // trigger still refuses the write at COMMIT, but as a raw constraint
        // violation rendered `INTERNAL_ERROR`, which is the 500-instead-of-an-answer
        // failure this module exists to avoid. Two of the three checks in there
        // have no trigger behind them at all.
        await lockPersonsWithin(trx, [pastoralLeaderId]);

        // Section 4 gives a new Person's Network its effect on the date they are
        // encoded, so there is no earlier instant for this edge to be checked at.
        await assertLeaderIsAssignable(trx, pastoralLeaderId, network, new Date(), this.networks);
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

      // Section 5: every Person created here gets an assignment row, and which
      // kind is the caller's stated intent rather than a nullable identifier.
      // A root's row carries a null leader and the Network's root seat; that is
      // what makes them a root rather than merely unassigned.
      await this.hierarchy.openAssignmentWithin(
        trx,
        input.placement.kind === 'ROOT'
          ? { personId: person.id, root: true, rootNetwork: network, startedAt: encodedAt }
          : {
              personId: person.id,
              leaderId: input.placement.pastoralLeaderId,
              startedAt: encodedAt,
            },
      );

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
          pastoral_leader_id:
            input.placement.kind === 'ROOT' ? null : input.placement.pastoralLeaderId,
          // Section 21 wants the values. A root is not "no leader" — it is a
          // Network-level position, and an entry recording only a null would not
          // say which of the two states was created.
          network_root: input.placement.kind === 'ROOT',
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
   * Creates the Person behind the first Admin account, as a system action.
   *
   * **Here because `people` owns `persons` and `person_lifecycle`** (section 2,
   * Modules). The bootstrap wrote both tables directly for one commit, justified
   * against section 2's *imports* rule — which is a different sentence from "a
   * module owns its tables", and the ownership rule's one exemption is a read joined onto a query rooted in a table the reading module owns, which a write is not. The
   * precedent runs the other way: the 2026-08-24 ruling restructured the module
   * graph rather than let `auth` keep three reads of `persons`.
   *
   * **It is not `create` with the checks removed.** It cannot reuse that path,
   * which requires an actor and an idempotency claim that do not exist before the
   * first account — so what is shared is the table, and the differences are
   * deliberate and few:
   *
   * - **No actor.** Sections 3 and 4 permit a null `actor_id` for a system action,
   *   which section 6 names as this and nothing else.
   * - **No duplicate matching.** Section 3's Tier 1 gate needs a person present to
   *   acknowledge a candidate, and nobody is. There is also nothing to match
   *   against: the caller refuses unless no account exists, and every supported
   *   path that creates a Person requires one — `POST /people` is authenticated,
   *   and the tree import is given an Admin account. So no accounts means no
   *   Persons.
   *
   *   A first version asserted that and then withdrew it in the same sentence
   *   ("'no accounts' does not strictly imply 'no Persons'"), which left section
   *   3's gate skipped on a premise the comment disowned. The strong reading is
   *   the one that holds and the one section 6 relies on elsewhere; if a path is
   *   ever added that creates a Person without an account, this is what has to be
   *   revisited.
   * - **No pastoral assignment.** Section 5 invariant 3 permits zero for an
   *   administrator outside the pastoral structure, and section 6 requires it here:
   *   at this moment there is no tree to place anybody in.
   *
   * **It refuses unless no Person exists**, and asks its own table rather than
   * `auth`'s. A first version had no guard and relied on having one caller — but
   * this is public on a service the API uses, and what it creates is a Person with
   * **zero pastoral assignments**, which is the capability the 2026-08-25 ruling
   * removed from `CreatePersonInput` on the grounds that "a variant no caller can
   * justify is the same thing spelled differently". Offering it again as an
   * unguarded method is that capability once more, with a docblock instead of a
   * type.
   *
   * **Why `persons` rather than `accounts`.** The account is the thing that makes
   * a bootstrap a bootstrap, so `accounts` is the more direct question — and
   * `people` cannot ask it: `auth` imports `people` (the 2026-08-24 seam), so the
   * reverse restores the cycle that ruling removed. `persons` being empty is
   * exactly as true at the only moment this may run, because the bootstrap is the
   * first write to an empty database. Either table being non-empty means this is
   * not a fresh installation.
   *
   * The audit entry is the caller's, not this method's: the bootstrap writes three
   * and section 21 wants them named separately.
   */
  async createSystemAdministratorWithin(
    transaction: Transaction<Database>,
    input: {
      firstName: string;
      middleName: string | null;
      lastName: string;
      sex: Sex;
      civilStatus: CivilStatus;
      encodedAt: Date;
    },
  ): Promise<{ id: string; memberId: string; network: NetworkName }> {
    const anyPerson = await transaction
      .selectFrom('persons')
      .select('id')
      .limit(1)
      .executeTakeFirst();

    if (anyPerson) {
      throw new AlreadyBootstrappedError(
        'people',
        'People already exist, so this is not a fresh installation. An administrator ' +
          'is created once, by the bootstrap, before anything else is recorded.',
      );
    }

    const network = this.networks.networkForSex(input.sex);

    const person = await transaction
      .insertInto('persons')
      .values({
        id: randomUUID(),
        first_name: input.firstName,
        middle_name: input.middleName,
        last_name: input.lastName,
        // Section 3 makes a birthday optional and forbids inventing one. Nothing
        // here knows it, and a bootstrap is the last place to guess.
        birth_date: null,
        sex: input.sex,
        civil_status: input.civilStatus,
      })
      .returning(['id', 'member_id'])
      .executeTakeFirstOrThrow();

    // Through `networks`, which owns the table and checks the same-Network rules
    // against it (section 2).
    await this.networks.assignWithin(transaction, {
      personId: person.id,
      network,
      actorId: null,
      startedAt: input.encodedAt,
    });

    await transaction
      .insertInto('person_lifecycle')
      .values({
        person_id: person.id,
        state: 'CURRENT',
        actor_id: null,
        started_at: input.encodedAt,
      })
      .execute();

    return { id: person.id, memberId: person.member_id, network };
  }
}
