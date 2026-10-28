import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import { AuthorizationService } from '../auth/authorization/authorization.service';
import { Capability } from '../auth/authorization/capabilities';
import { HierarchyService } from '../hierarchy/hierarchy.service';
import { NetworksService } from '../networks/networks.service';
import {
  DuplicateAcknowledgementRequiredError,
  NotFoundError,
  ResourceBusyError,
} from '../common/errors/api-error';
import { IdempotencyService } from '../common/idempotency/idempotency.service';
import { canonicalId } from '../common/identifiers';
import { AlreadyBootstrappedError } from '../common/errors/already-bootstrapped';
import { DATABASE, type Db } from '../database/database.module';
import { lockPersonNameWithin, lockPersonsWithin } from '../database/person-lock';

import { APPLICATION_RULES, lastNameKey, type Subject } from './duplicate-matching';
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
    private readonly authorization: AuthorizationService,
  ) {}

  /**
   * Records one church-wide search (SKILL.md sections 8 and 21, decision 0303): who
   * searched, the term, and how many people that request returned. It targets the
   * searching account, as the second sign-in step's entries do. A search writes nothing
   * else, so the transaction holds this entry alone.
   */
  async recordDirectorySearch(accountId: string, term: string, returned: number): Promise<void> {
    await this.db.transaction().execute((trx) =>
      this.audit.writeWithin(trx, {
        actorId: accountId,
        action: 'directory.searched',
        targetType: 'account',
        targetId: accountId,
        after: { term, returned },
      }),
    );
  }

  /**
   * Records one duplicate check that showed somebody outside the searcher's scope
   * (SKILL.md sections 3 and 21, decision 0304): the names typed and the people shown,
   * never the birthday or the mobile number, which describe the person being added.
   */
  async recordDuplicateCheck(
    accountId: string,
    firstName: string,
    lastName: string,
    shown: string[],
  ): Promise<void> {
    await this.db.transaction().execute((trx) =>
      this.audit.writeWithin(trx, {
        actorId: accountId,
        action: 'directory.matched',
        targetType: 'account',
        targetId: accountId,
        after: { first_name: firstName, last_name: lastName, shown },
      }),
    );
  }

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
     *
     * `leaderId` is the candidate's current pastoral leader, read inside this add's
     * transaction (decision 0401). The caller reads its scope before the transaction,
     * so a person added under a leader in that scope a moment earlier, by somebody
     * else, is not yet in it; their leader is.
     */
    canSeeReasons: (personId: string, leaderId: string | null) => Promise<boolean>,
  ): Promise<Record<string, unknown>> {
    // **Only the Admin gives a title** (decision 0374): `people.set_title`, at Whole Church.
    // A blank one is no title, so a form that sends an empty box is not refused.
    if (input.title?.trim()) {
      await this.authorization.assertHolds(actor, Capability.PeopleSetTitle);
    }

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
    return this.db.transaction().execute(async (trx) => {
      // **The check runs under a lock on the last name, inside the add** (decision 0401).
      // Checked before the transaction, two leaders adding one person at the same moment
      // each looked before either had written, and both were added. Every Tier 1 rule
      // needs equal last names, so the second add waits here and then sees the first.
      // Taken before any person lock (section 5's order): nothing else takes this one.
      await lockPersonNameWithin(trx, lastNameKey(subject.lastName));
      const matches = await this.duplicates.findDuplicates(subject, APPLICATION_RULES, trx);
      const leaders = await this.hierarchy.directLeaderIdsOf(
        matches.map((match) => match.candidate.id),
        trx,
      );
      const visible = (personId: string) => canSeeReasons(personId, leaders.get(personId) ?? null);

      // **The gate applies only to candidates the actor may see.**
      //
      // Every Tier 1 rule but one rests on a birthday or a mobile number, so an
      // out-of-scope Tier 1 candidate is one section 8 does not permit surfacing
      // (`visibleCandidates`). Refusing on one anyway would answer "acknowledge
      // this" with nothing to acknowledge, and the encoder could never create that
      // Person at all -- a permanent block, which is worse than the duplicate it
      // was guarding against and is what section 3 means by never blocking
      // creation. The one that does not (decision 0399, equal names with neither
      // field given) is held to the same gate: its candidate still cannot be shown
      // in full to somebody outside their branch.
      //
      // So an invisible duplicate does not gate. The cost is stated in section 3:
      // a cross-branch duplicate resting on a protected field is not caught for a
      // leader outside that branch, and is caught by the leader who holds them.
      let gated = false;
      for (const match of matches) {
        if (match.tier !== 1 || acknowledged.has(canonicalId(match.candidate.id))) {
          continue;
        }

        if (await visible(match.candidate.id)) {
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
      // or a mobile number, or for decision 0399 their absence, so gating on an out-of-scope candidate would make the
      // status vary with a value section 8 protects — the same oracle as the
      // candidate list, one field further out. The status now varies only with what
      // the actor is already allowed to know.
      if (gated) {
        throw new DuplicateAcknowledgementRequiredError(
          await this.duplicates.visibleDuplicatesFor(
            subject,
            visible,
            (match) => match.tier === 1 && !acknowledged.has(canonicalId(match.candidateId)),
            APPLICATION_RULES,
            trx,
          ),
        );
      }

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
          title: input.title?.trim() || null,
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
          'title',
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
   * middle and last name, birthday, civil status and mobile number; a title also needs
   * `people.set_title` (decision 0374). **Not sex** —
   * that determines Network, which determines which pastoral edges are legal, so
   * it has its own capability and its own audited path (section 4).
   *
   * **A changed name, birthday or mobile number is checked for duplicates as creating a
   * Person is** (section 3, decision 0396): a Tier 1 candidate the actor may see and has not
   * acknowledged stops the save, the person themself never counting, and an edit that
   * changes none of those fields is not checked.
   *
   * **Asked before the transaction opens**, because the check reads the pool. Create differs:
   * it checks inside its transaction under the last-name lock (decision 0401), which is safe
   * there only because its caller reads the scope as a set before the transaction opens and the
   * population is read through the transaction. Here, the check reads the pool:
   * asked while this request holds a connection and the row lock, it would ask a bounded pool
   * for more connections (section 24). The row is then locked and, where somebody changed one
   * of the compared fields in between, the write answers `RESOURCE_BUSY` rather than saving
   * past a check made on other values; the same body sent again is checked afresh.
   */
  async editBasic(
    personId: string,
    changes: {
      title?: string | null;
      firstName?: string;
      middleName?: string | null;
      lastName?: string;
      birthDate?: string;
      civilStatus?: CivilStatus;
      mobileNumber?: string | null;
      acknowledgedDuplicateIds?: readonly string[];
    },
    actor: { accountId: string; personId: string },
    claim: CurrentClaim,
    /** Whether the actor may see why a candidate matched, as on create. */
    canSeeReasons: (personId: string) => Promise<boolean>,
  ): Promise<Record<string, unknown>> {
    const checked = await this.db
      .selectFrom('persons')
      .select(['first_name', 'middle_name', 'last_name', 'birth_date', 'sex', 'mobile_number'])
      .where('id', '=', personId)
      .executeTakeFirst();
    if (checked === undefined) {
      throw new NotFoundError('No such person.');
    }
    const passedOver = await this.assertNoUnacknowledgedDuplicate(
      checked,
      changes,
      personId,
      canSeeReasons,
    );

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
          'title',
          'first_name',
          'middle_name',
          'last_name',
          'birth_date',
          'sex',
          'civil_status',
          'mobile_number',
        ])
        .where('id', '=', personId)
        // **Locked**, so `before` is the value immediately prior to this write: without it, an
        // edit waiting on a concurrent one's row lock records that one's change as its own, and
        // decision 0374's title check would read a title that changes underneath it.
        .forNoKeyUpdate()
        .executeTakeFirst();

      if (before === undefined) {
        throw new NotFoundError('No such person.');
      }

      // **Only the Admin sets, changes or clears a title** (decision 0374). Refused only where
      // the title would change, so a form that sends back the one already recorded, as a page
      // opened before the change still does, is not refused for it. **An unchanged title is
      // then not written at all**: written back, it would undo a title the Admin changed after
      // `before` was read, by an actor who may not set one.
      const title = changes.title === undefined ? undefined : changes.title?.trim() || null;
      const titleChanges = title !== undefined && title !== before.title;
      if (titleChanges) {
        await this.authorization.assertHolds(actor, Capability.PeopleSetTitle);
      }

      // The duplicate check was made on `checked`; a change to what it compared since then
      // means it was made on other values.
      if (
        before.first_name !== checked.first_name ||
        before.middle_name !== checked.middle_name ||
        before.last_name !== checked.last_name ||
        before.birth_date !== checked.birth_date ||
        before.mobile_number !== checked.mobile_number
      ) {
        throw new ResourceBusyError(
          { person_id: personId },
          'This person was changed while being saved. Retry in a moment.',
        );
      }

      const person = await trx
        .updateTable('persons')
        .set({
          ...(titleChanges ? { title } : {}),
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
          'title',
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
        // The candidates passed over, which are part of what was done (section 21): only those
        // this check found, and always written, so an empty list means none was needed.
        after: { ...person, acknowledged_duplicate_ids: passedOver },
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
   * The duplicate check an edit owes (decision 0396): only where a name, the birthday or the
   * mobile number changes, against the record as it will read, the person themself excluded.
   * Gated as on create, on a visible Tier 1 candidate not yet acknowledged. Answers the
   * acknowledged ids that were visible Tier 1 candidates of this check, for the audit entry.
   * A pair confirmed different before is asked about again: the answer is not stored per pair
   * (owner, 2026-10-27).
   */
  private async assertNoUnacknowledgedDuplicate(
    before: {
      first_name: string;
      middle_name: string | null;
      last_name: string;
      birth_date: string | null;
      sex: Sex;
      mobile_number: string | null;
    },
    changes: {
      firstName?: string;
      middleName?: string | null;
      lastName?: string;
      birthDate?: string;
      mobileNumber?: string | null;
      acknowledgedDuplicateIds?: readonly string[];
    },
    personId: string,
    canSeeReasons: (personId: string) => Promise<boolean>,
  ): Promise<string[]> {
    const subject: Subject = {
      firstName: changes.firstName?.trim() ?? before.first_name,
      middleName:
        changes.middleName === undefined ? before.middle_name : changes.middleName?.trim() || null,
      lastName: changes.lastName?.trim() ?? before.last_name,
      birthDate: changes.birthDate ?? before.birth_date,
      sex: before.sex,
      mobileNumberNormalized:
        changes.mobileNumber === undefined
          ? normalizeMobile(before.mobile_number)
          : normalizeMobile(changes.mobileNumber),
    };

    const identityChanges =
      subject.firstName !== before.first_name ||
      subject.middleName !== before.middle_name ||
      subject.lastName !== before.last_name ||
      subject.birthDate !== before.birth_date ||
      subject.mobileNumberNormalized !== normalizeMobile(before.mobile_number);
    if (!identityChanges) {
      return [];
    }

    const self = canonicalId(personId);
    const acknowledged = new Set(
      (changes.acknowledgedDuplicateIds ?? []).map((candidateId) => canonicalId(candidateId)),
    );
    const owed = (candidateId: string) =>
      canonicalId(candidateId) !== self && !acknowledged.has(canonicalId(candidateId));

    let gated = false;
    const passedOver: string[] = [];
    for (const match of await this.duplicates.findDuplicates(subject, APPLICATION_RULES)) {
      const candidateId = canonicalId(match.candidate.id);
      if (match.tier !== 1 || candidateId === self || !(await canSeeReasons(match.candidate.id))) {
        continue;
      }
      if (acknowledged.has(candidateId)) {
        passedOver.push(candidateId);
      } else {
        gated = true;
      }
    }

    if (gated) {
      throw new DuplicateAcknowledgementRequiredError(
        await this.duplicates.visibleDuplicatesFor(
          subject,
          canSeeReasons,
          (match) => match.tier === 1 && owed(match.candidateId),
          APPLICATION_RULES,
        ),
      );
    }

    return passedOver;
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
        // Section 3 requires a birthday only of `POST /people` (decision 0328) and
        // forbids inventing one. Nothing here knows it.
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
