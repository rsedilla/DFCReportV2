import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { SettingsService } from '../admin/settings/settings.service';
import { AuditService } from '../audit/audit.service';
import { InvariantViolationError, NotFoundError } from '../common/errors/api-error';
import { HierarchyService } from '../hierarchy/hierarchy.service';
import { NetworksService } from '../networks/networks.service';
import { lockPersonsWithin } from '../database/person-lock';

import { assertLeaderIsAssignable } from './leader-assignability';
import { composeName, type PersonPlacement } from './people.shared';

import type { CivilStatus, Database, NetworkName, Sex } from '../database/schema';
import type { Transaction } from 'kysely';

/**
 * The per-row writes of the leadership-tree import (SKILL.md section 2, How the
 * tree import runs).
 *
 * The import itself lives in `admin`, which is where section 2 puts the phase and
 * the administrative operations. What lives here is everything that touches
 * `persons` and `person_lifecycle`, because section 2 gives those tables to this
 * module and says no other module writes them, ever.
 *
 * **Its own service rather than two more methods on `PeopleService`.** The five
 * services in this module are named for the operations they own, and this one owns
 * a rule of its own: creation during the import skips the duplicate gate that
 * `PeopleService.create` enforces on every request, because section 3 forbids
 * adjudicating a Tier 1 candidate with nobody present and section 2 moves that
 * decision into the decisions file instead. A method that skips a section 3 bound
 * should not sit in the file whose job is enforcing it.
 *
 * **Both write methods refuse unless the initial-encoding phase is open**, and
 * that is the whole reason this service exists in the shape it does. These are
 * public methods on a service the API's injector can resolve, and what they offer
 * is Person creation with no duplicate gate and no idempotency claim. Guarded by a
 * docblock that is a hole; guarded by a read of `settings` it is a phase, which is
 * what section 2 says the relaxations of this phase are. The precedent is
 * `createSystemAdministratorWithin` and `createFirstAdminWithin`, each of which
 * refuses on its own account rather than trusting its one caller.
 *
 * The phase reader is `admin`'s, reached through `SettingsModule` — a sub-module
 * of `admin` that owns `settings` and imports nothing, so this does not close a
 * cycle against the import that calls it. Same seam, and the same reason, as
 * `AuthorizationModule` splitting out of `AuthModule`.
 */
@Injectable()
export class PeopleImportService {
  constructor(
    private readonly audit: AuditService,
    private readonly hierarchy: HierarchyService,
    private readonly networks: NetworksService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Creates one Person of the tree, with their Network, lifecycle and pastoral
   * assignment, inside the import's single transaction.
   *
   * The same set of rows `PeopleService.create` writes, and deliberately so: the
   * two paths must not produce Persons that differ in what was recorded about
   * them. What is missing is the duplicate gate, which the decisions file has
   * already answered, and the idempotency completion, which belongs to a request
   * and there is none — section 2 makes this a script precisely so that a
   * transaction of minutes is not holding one of the connections section 24
   * bounds.
   *
   * `batchId` groups every entry of one import, which section 2 requires: one
   * entry for an import touching thousands of Persons records no target and no
   * before-and-after values, which section 21 does require.
   */
  async createForImportWithin(
    transaction: Transaction<Database>,
    input: {
      firstName: string;
      middleName: string | null;
      lastName: string;
      /** Null where the file did not carry one. Section 3: never fabricate one. */
      birthDate: string | null;
      sex: Sex;
      civilStatus: CivilStatus;
      placement: PersonPlacement;
      /** One instant for the whole import, so every row shares an effective date. */
      encodedAt: Date;
      /**
       * The Member IDs of the Tier 1 candidates that stood against this row when
       * the adjudicator decided to create anyway (section 3).
       *
       * **Recorded because otherwise the acknowledgement exists only in a
       * spreadsheet**, which is outside the system and outside `audit_log` — and
       * that acknowledgement is the entire reason section 2 built a two-phase
       * import. Section 21 asks for the relevant values, and for this path "who
       * was on the table and passed over" is the relevant value.
       *
       * Member IDs rather than the identifiers `PeopleService.create` records,
       * because that is what the decisions file is written in: recording a UUID
       * here would be recording something the adjudicator never saw.
       */
      acknowledgedDuplicateMemberIds?: readonly string[];
    },
    actor: { accountId: string },
    batchId: string,
  ): Promise<{ id: string; memberId: string; network: NetworkName }> {
    await this.assertEncodingPhaseOpen(transaction);

    const network = this.networks.networkForSex(input.sex);

    if (input.placement.kind === 'UNDER') {
      // Lock first, then check — the order `PeopleService.create` settled. The
      // leader's Network decides whether this edge is legal and a correction to it
      // can commit between a check and this write, which leaves the answer stale
      // and the deferred trigger refusing at COMMIT as a raw constraint violation.
      await lockPersonsWithin(transaction, [input.placement.pastoralLeaderId]);
      await assertLeaderIsAssignable(
        transaction,
        input.placement.pastoralLeaderId,
        network,
        input.encodedAt,
        this.networks,
      );
    }

    const person = await transaction
      .insertInto('persons')
      .values({
        id: randomUUID(),
        first_name: input.firstName,
        middle_name: input.middleName,
        last_name: input.lastName,
        birth_date: input.birthDate,
        sex: input.sex,
        civil_status: input.civilStatus,
        // Section 2 names what the import loads and a mobile number is not among
        // it. Absent rather than empty: section 3 makes the field optional and a
        // fabricated one is worse than none, because it is a Tier 1 signal.
        mobile_number: null,
        mobile_number_normalized: null,
      })
      .returning(['id', 'member_id'])
      .executeTakeFirstOrThrow();

    await this.networks.assignWithin(transaction, {
      personId: person.id,
      network,
      actorId: actor.accountId,
      startedAt: input.encodedAt,
    });

    await transaction
      .insertInto('person_lifecycle')
      .values({
        person_id: person.id,
        state: 'CURRENT',
        actor_id: actor.accountId,
        started_at: input.encodedAt,
      })
      .execute();

    await this.hierarchy.openAssignmentWithin(
      transaction,
      input.placement.kind === 'ROOT'
        ? {
            personId: person.id,
            root: true,
            rootNetwork: network,
            startedAt: input.encodedAt,
          }
        : {
            personId: person.id,
            leaderId: input.placement.pastoralLeaderId,
            startedAt: input.encodedAt,
          },
    );

    await this.audit.writeWithin(transaction, {
      actorId: actor.accountId,
      action: 'person.created',
      targetType: 'person',
      targetId: person.id,
      // The same values `PeopleService.create` records, because section 21 wants
      // what was created rather than that something was — and a reader searching
      // the log should not have to know which path wrote the entry.
      //
      // One field differs and the difference is deliberate:
      // `acknowledged_duplicate_member_ids` rather than
      // `acknowledged_duplicate_ids`, because the import's acknowledgement is
      // taken in Member IDs and a reader must not mistake one for the other.
      after: {
        id: person.id,
        member_id: person.member_id,
        first_name: input.firstName,
        middle_name: input.middleName,
        last_name: input.lastName,
        birth_date: input.birthDate,
        sex: input.sex,
        civil_status: input.civilStatus,
        mobile_number: null,
        network,
        pastoral_leader_id:
          input.placement.kind === 'ROOT' ? null : input.placement.pastoralLeaderId,
        network_root: input.placement.kind === 'ROOT',
        acknowledged_duplicate_member_ids: [...(input.acknowledgedDuplicateMemberIds ?? [])],
        import: true,
      },
      batchId,
    });

    return { id: person.id, memberId: person.member_id, network };
  }

  /**
   * The Person a `USE_EXISTING` decision names, refusing every state the tree
   * cannot legally place.
   *
   * By Member ID rather than by identifier, because that is what the decisions
   * file carries: section 2 chose it over the UUID on the grounds that the
   * adjudicator reads it off a report and may retype it, and `M-000000` survives
   * that where a UUID does not.
   *
   * **A sex mismatch is refused rather than corrected.** Sex decides Network
   * (section 4), a Network change forces a pastoral reassignment, and section 4
   * gives that its own capability and its own audited route — `people.correct_sex`,
   * Admin only. An import that quietly changed it would move a person between
   * Networks with no reason recorded and nothing to say it happened, which is the
   * escalation section 7 keeps that capability Admin-only to prevent.
   */
  async resolveExistingWithin(
    transaction: Transaction<Database>,
    memberId: string,
    expected: { sex: Sex },
  ): Promise<{ id: string; memberId: string; fullName: string }> {
    const person = await transaction
      .selectFrom('persons')
      .leftJoin('person_lifecycle', (join) =>
        join
          .onRef('person_lifecycle.person_id', '=', 'persons.id')
          .on('person_lifecycle.ended_at', 'is', null),
      )
      .select([
        'persons.id as id',
        'persons.member_id as member_id',
        'persons.first_name as first_name',
        'persons.middle_name as middle_name',
        'persons.last_name as last_name',
        'persons.sex as sex',
        'persons.merged_into_id as merged_into_id',
        'person_lifecycle.state as state',
      ])
      .where('persons.member_id', '=', memberId)
      .executeTakeFirst();

    if (!person) {
      throw new NotFoundError(`No Person carries the Member ID ${memberId}.`);
    }

    if (person.merged_into_id !== null) {
      throw new InvariantViolationError(
        `${memberId} was absorbed by a merge. Name the surviving Person instead.`,
        { member_id: memberId },
      );
    }

    if (person.state === 'ARCHIVED') {
      throw new InvariantViolationError(
        `${memberId} is archived, so the tree may not place them. Restore them first, ` +
          'which is a separate and separately audited decision, or create a new Person.',
        { member_id: memberId },
      );
    }

    if (person.sex !== expected.sex) {
      throw new InvariantViolationError(
        `${memberId} is recorded as ${person.sex} and the tree file says ${expected.sex}. ` +
          'Sex decides Network, so this is a correction under `people.correct_sex` (section 4) ' +
          'and not something an import performs as a side effect.',
        { member_id: memberId },
      );
    }

    // **No Network is returned, deliberately.** Deriving one from the sex checked
    // just above would be right wherever the record and the file agree, and this
    // method is the thing that establishes they agree — so it reads as safe. It is
    // not the value the edge is checked against: `attachExistingWithin` writes no
    // Network row, so what governs is the row already in `network_assignments`,
    // and that is what it reads.
    return {
      id: person.id,
      memberId: person.member_id,
      fullName: composeName(person),
    };
  }

  /**
   * Gives an existing Person the pastoral assignment the tree gives them.
   *
   * **It refuses where they already hold an active one, naming nothing else**
   * (section 2). Section 5 permits exactly one, so proceeding would mean closing
   * the one they have — which is a reassignment, carrying its own authorization
   * and its own audit entry. An import must not perform one as a side effect of a
   * duplicate adjudication, because the person who decided these two records are
   * one person was never asked whether to move anybody. Handing it back makes it an
   * ordinary reassignment, decided by whoever should decide it.
   *
   * **It refuses to make an existing Person a Network root.** Section 5 says a root
   * is created only by the initial import, and `createForImportWithin` is what
   * creates one; taking somebody who already exists and seating them is a different
   * act, and section 5 also says a root cannot be reassigned by anyone. Nothing
   * states which of those governs here, so the fail-closed reading is taken and the
   * question is recorded as open in `CLAUDE.md` rather than answered by a side
   * effect.
   *
   * The case that makes it more than theoretical: the administrator the first-Admin
   * bootstrap creates has no pastoral assignment, which section 5 invariant 3 calls
   * a correct permanent state for somebody outside the pastoral structure — and
   * without this they could be named on a root row and pulled into it.
   *
   * The audit entry is `pastoral_assignment.transferred` with a null previous
   * leader, which is what it is: the Person had none. Section 21's list is open and
   * its convention is `<noun>.<past-tense verb>`, so a separate `.opened` action
   * would be admissible — and it would split the one question a reader asks of this
   * log, "who has led this person", across two action names for no gain.
   */
  async attachExistingWithin(
    transaction: Transaction<Database>,
    input: {
      personId: string;
      memberId: string;
      placement: PersonPlacement;
      encodedAt: Date;
    },
    actor: { accountId: string },
    batchId: string,
  ): Promise<void> {
    await this.assertEncodingPhaseOpen(transaction);

    if (input.placement.kind === 'ROOT') {
      throw new InvariantViolationError(
        `${input.memberId} names an existing Person for a Network root row. A root is created ` +
          'by the import and is not a seat an existing Person is moved into (section 5) — ' +
          'decide CREATE for that row, or take it up as a Network-level decision.',
        { member_id: input.memberId, person_id: input.personId },
      );
    }

    // Bound once, so the three uses below cannot each re-narrow the union and one
    // of them get it wrong. Everything past the refusal above is an ordinary edge.
    const pastoralLeaderId = input.placement.pastoralLeaderId;

    // **Both keys in one call, because the ordering guarantee is per call.**
    // `lockPersonsWithin` sorts what it is given and issues one statement per key;
    // two calls therefore acquire in the order they were written, not in key
    // order. Locking the subject and then the leader is exactly the shape section
    // 5 names as a deadlock: a concurrent reassignment naming the same pair takes
    // them sorted, and where the leader's key is the lower one the two run in
    // opposite orders. That is a deadlock rather than a wait, so the three-second
    // `lock_timeout` does not bound it — PostgreSQL picks a victim and raises
    // `40P01`, which nothing here classifies.
    //
    // The subject is locked at all because their own row is what is being decided:
    // a Network correction committing alongside changes which Network their new
    // edge belongs to. `openAssignmentWithin` will take the leader's lock again,
    // which is free — the same transaction already holds it.
    await lockPersonsWithin(transaction, [input.personId, pastoralLeaderId]);

    // Asked of `hierarchy`, which owns `pastoral_assignments` (section 2). A
    // standalone read rooted in a table this module does not own is not the join
    // exemption section 2 names, and the interface already answers exactly this —
    // `PeopleSexCorrectionService` calls the same method with a transaction.
    const open = await this.hierarchy.openAssignmentOf(transaction, input.personId);

    if (open) {
      throw new InvariantViolationError(
        `${input.memberId} already holds an active pastoral assignment, so the tree cannot ` +
          'place them without closing it. That is a reassignment, which carries its own ' +
          'authorization and its own audit entry (section 5) — make it separately and run the ' +
          'import again, or decide CREATE for this row.',
        { member_id: input.memberId, person_id: input.personId },
      );
    }

    // **The Network is read, not derived from sex.** `resolveExistingWithin`
    // checks that the recorded sex agrees with the file, so deriving would give
    // the right answer wherever the two agree — and this method writes no Network
    // row, so wherever they disagree the pre-check passes on a value the database
    // does not hold and the deferred trigger raises a raw `check_violation` at
    // COMMIT. That is the 500-instead-of-an-answer failure `assertLeaderIsAssignable`
    // exists to prevent. `PeopleReassignmentService` reads it for the same reason.
    //
    // Null is refused rather than attempted (section 5): a Person carrying no open
    // Network row has no Network for the edge to be checked against, and the
    // trigger would compare against null and refuse at commit with nothing an
    // operator can act on.
    const network = await this.networks.networkAsOf(transaction, input.personId, input.encodedAt);
    if (network === null) {
      throw new InvariantViolationError(
        `${input.memberId} has no Network recorded as of the encoding date, so the tree ` +
          'cannot place them: a pastoral edge is legal only between two people in the same ' +
          'Network, and one end of this one has none.',
        { member_id: input.memberId, person_id: input.personId },
      );
    }

    await assertLeaderIsAssignable(
      transaction,
      pastoralLeaderId,
      network,
      input.encodedAt,
      this.networks,
    );

    await this.hierarchy.openAssignmentWithin(transaction, {
      personId: input.personId,
      leaderId: pastoralLeaderId,
      startedAt: input.encodedAt,
    });

    await this.audit.writeWithin(transaction, {
      actorId: actor.accountId,
      action: 'pastoral_assignment.transferred',
      targetType: 'person',
      targetId: input.personId,
      // Section 5 requires the entry to carry the previous and the new leader. The
      // previous is null and is written rather than omitted: an absent key and a
      // null one read the same to a person and differently to a query.
      before: { pastoral_leader_id: null },
      after: { pastoral_leader_id: pastoralLeaderId, network, import: true },
      batchId,
    });
  }

  /**
   * Section 2: the import runs inside the initial-encoding phase, and a relaxation
   * reachable after its phase closed is not a temporary one.
   *
   * Read inside the caller's transaction rather than before it, so that a close
   * committing alongside is seen. The script asks the same question first, for a
   * better message; this is the one that decides.
   */
  private async assertEncodingPhaseOpen(transaction: Transaction<Database>): Promise<void> {
    if (!(await this.settings.initialEncodingOpenWithin(transaction))) {
      throw new InvariantViolationError(
        'The initial-encoding phase is closed, so the leadership-tree import cannot run. ' +
          'Everyone below the spine is encoded by the leader who holds them (section 2).',
        { setting: 'initial_encoding_open' },
      );
    }
  }
}
