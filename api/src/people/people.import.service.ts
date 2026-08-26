import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { SettingsService } from '../admin/settings/settings.service';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService } from '../auth/authorization/authorization.service';
import {
  InvariantViolationError,
  NotFoundError,
  ScopeDeniedError,
} from '../common/errors/api-error';
import { HierarchyService } from '../hierarchy/hierarchy.service';
import { NetworksService } from '../networks/networks.service';
import { lockPersonsWithin } from '../database/person-lock';

import { assertLeaderIsAssignable } from './leader-assignability';
import { composeName, type PersonPlacement } from './people.shared';

import type { CivilStatus, Database, NetworkName, Sex } from '../database/schema';
import type { Transaction } from 'kysely';

/**
 * Who an import is running as.
 *
 * **An account identifier and nothing else, deliberately.** A first version
 * carried the actor's `ActorAuthority` and checked the role from it, on the
 * reasoning that reading authority inside a transaction is the section 24 hazard.
 * The reasoning was right and the shape was wrong: `ActorAuthority` is plain data,
 * so the module this check exists to defend against could hand over
 * `{ roles: ['ADMIN'] }` and satisfy it. A check that reads a fact its caller
 * supplied is not a check.
 *
 * The precedent cited for it did not carry either. `createSystemAdministratorWithin`
 * and `createFirstAdminWithin` each read their own module's table for a fact no
 * caller supplies, which is the property that makes them guards and is exactly
 * what the authority-carrying version lacked — section 25 rule 19, in the batch
 * written to apply it.
 *
 * The roles are read through the caller's transaction instead
 * (`AuthorizationService.honouredRolesWithin`), which answers the section 24
 * concern without answering it with data.
 */
export interface ImportActor {
  accountId: string;
}

/**
 * The per-row writes of the leadership-tree import (SKILL.md section 2, How the
 * tree import runs).
 *
 * The import itself lives in `admin`, which is where section 2 puts the phase and
 * the administrative operations. What lives here is everything that touches
 * `persons` and `person_lifecycle`, because section 2 gives those tables to this
 * module and says no other module writes them, ever.
 *
 * **Its own service rather than two more methods on `PeopleService`.** The
 * services in this module are named for the operations they own, and this one owns
 * a rule of its own: creation during the import skips the duplicate gate that
 * `PeopleService.create` enforces on every request, because section 3 forbids
 * adjudicating a Tier 1 candidate with nobody present and section 2 moves that
 * decision into the decisions file instead. A method that skips a section 3 bound
 * should not sit in the file whose job is enforcing it.
 *
 * **Both write methods refuse on their own account, twice**, and that is the whole
 * reason this service exists in the shape it does. These are public methods on a
 * service `PeopleModule` exports, so any module importing it can inject them — and
 * what they offer is Person creation with no duplicate gate and no idempotency
 * claim. Guarded by a docblock that is a hole. The precedent is
 * `createSystemAdministratorWithin` and `createFirstAdminWithin`, each of which
 * refuses rather than trusting its one caller (2026-08-26).
 *
 * They refuse unless **the initial-encoding phase is open**, which is what section
 * 2 says makes this phase's relaxations temporary; and unless **the actor holds
 * `ADMIN`**, which is section 2's other precondition and the one that carries the
 * section 5 invariant 4 escalation. A first version put the role check only at the
 * orchestration door in `admin/tree-import`, and then said in three places that it
 * was closed "for the whole run" — true of that door, and this module's door was
 * unlocked.
 *
 * **Neither reads anything its caller handed it**, which is what makes them
 * refusals rather than assertions: the phase comes from `settings` and the roles
 * from `account_roles`, both through the caller's transaction. The version between
 * those two took the actor's `ActorAuthority` as an argument and read the role from
 * it — see `ImportActor` for why that was not a check at all.
 *
 * **The capabilities are not re-checked here**, and section 2 says so rather than
 * implying otherwise. They are the script's precondition. On the only path that
 * exists they are implied by the role, since `ROLE_DEFAULTS.ADMIN` carries both at
 * Whole Church; on a hypothetical path from another module they would not be
 * checked at all, which is a gap this docblock names rather than papers over.
 *
 * The phase reader is `admin`'s, reached through `SettingsModule` — a sub-module
 * of `admin` that owns `settings` and imports nothing, so this does not close a
 * cycle against the import that calls it. Same seam, and the same reason, as
 * `AuthorizationModule` splitting out of `AuthModule`. The role reader is `auth`'s,
 * through `AuthorizationModule`, which `PeopleModule` already imports.
 */
@Injectable()
export class PeopleImportService {
  constructor(
    private readonly audit: AuditService,
    private readonly authorization: AuthorizationService,
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
       * The Member IDs of the Tier 1 candidates standing against this row **when
       * the commit ran** (section 3).
       *
       * **Recorded because otherwise the acknowledgement exists only in a
       * spreadsheet**, which is outside the system and outside `audit_log` — and
       * that acknowledgement is the entire reason section 2 built a two-phase
       * import. Section 21 asks for the relevant values, and for this path "who
       * was on the table and passed over" is the relevant value.
       *
       * **Not necessarily the set the adjudicator saw**, and the docblock said so
       * for one commit while the caller passed the commit-time set. Where a
       * candidate arrives between the dry run and the commit for a row that already
       * carries a decision, they are named here as acknowledged and nobody was
       * asked about them. Section 2's decisions file carries no candidate column,
       * so the adjudicated set is not available to record — the same absence that
       * leaves that gap open in `CLAUDE.md`.
       *
       * Member IDs rather than the identifiers `PeopleService.create` records,
       * because that is what the decisions file is written in: recording a UUID
       * here would be recording something the adjudicator never saw.
       */
      acknowledgedDuplicateMemberIds?: readonly string[];
    },
    actor: ImportActor,
    batchId: string,
  ): Promise<{ id: string; memberId: string; network: NetworkName }> {
    await this.assertActorMayImport(transaction, actor);
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
   * **It will seat an existing Person as a Network root**, which was refused for
   * one commit and should not have been. Section 2 says a row resolving to an
   * existing Person "receives the pastoral assignment the tree gives them" and
   * states no exception for a root row; section 5's "a root is created only by the
   * initial import" is about creating the *root row*, which is exactly what this
   * does. Read together the specification requires the behaviour, and the refusal
   * was a rule invented in a service.
   *
   * The reason offered for it does not survive either. It was the administrator,
   * who correctly holds no assignment forever (section 5 invariant 3, third case)
   * and would therefore be the ideal Person for a root row to absorb — but reaching
   * that needs an Admin to write their Member ID against a root row in the
   * decisions file, deliberately. That is a mistake an Admin can make, like many
   * others they can make with this file, and not an escalation.
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
    actor: ImportActor,
    batchId: string,
  ): Promise<void> {
    await this.assertActorMayImport(transaction, actor);
    await this.assertEncodingPhaseOpen(transaction);

    // **Every key in one call, because the ordering guarantee is per call.**
    // `lockPersonsWithin` sorts what it is given and issues one statement per key;
    // two calls therefore acquire in the order they were written, not in key
    // order. Locking the subject and then the leader is the shape section 5 names
    // as a deadlock: a concurrent reassignment naming the same pair takes them
    // sorted, and where the leader's key is the lower one the two run in opposite
    // orders.
    //
    // **This narrows the hazard rather than removing it, and saying otherwise
    // would be the overclaim this file has already made once.** The import runs the
    // whole tree in one transaction and holds every lock to commit, so the union of
    // keys across rows is still acquired in tree order rather than in key order. A
    // concurrent writer taking two person locks sorted can still cycle with it.
    // The consequence is unchanged and is recorded as open in `CLAUDE.md`:
    // PostgreSQL raises `40P01`, and `isLockTimeout` matches `55P03` only and
    // deliberately, so a deadlock renders `INTERNAL_ERROR`.
    //
    // The subject is locked at all because their own row is what is being decided:
    // a Network correction committing alongside changes which Network their new
    // edge belongs to. `openAssignmentWithin` will take its own lock again, which
    // is free — the same transaction already holds it.
    await lockPersonsWithin(
      transaction,
      input.placement.kind === 'UNDER'
        ? [input.personId, input.placement.pastoralLeaderId]
        : [input.personId],
    );

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

    if (input.placement.kind === 'UNDER') {
      await assertLeaderIsAssignable(
        transaction,
        input.placement.pastoralLeaderId,
        network,
        input.encodedAt,
        this.networks,
      );
    }

    await this.hierarchy.openAssignmentWithin(
      transaction,
      input.placement.kind === 'ROOT'
        ? {
            personId: input.personId,
            root: true,
            // The Network read above, not one derived from sex — the same value
            // the `UNDER` branch checks the edge against, and the one migration
            // 0008's index compares the seat to.
            rootNetwork: network,
            startedAt: input.encodedAt,
          }
        : {
            personId: input.personId,
            leaderId: input.placement.pastoralLeaderId,
            startedAt: input.encodedAt,
          },
    );

    await this.audit.writeWithin(transaction, {
      actorId: actor.accountId,
      action: 'pastoral_assignment.transferred',
      targetType: 'person',
      targetId: input.personId,
      // Section 5 requires the entry to carry the previous and the new leader. The
      // previous is null and is written rather than omitted: an absent key and a
      // null one read the same to a person and differently to a query.
      before: { pastoral_leader_id: null },
      after: {
        pastoral_leader_id:
          input.placement.kind === 'ROOT' ? null : input.placement.pastoralLeaderId,
        // A root is not "no leader" — it is a Network-level position, and an entry
        // recording only a null would not say which of the two states was written.
        network_root: input.placement.kind === 'ROOT',
        network,
        import: true,
      },
      batchId,
    });
  }

  /**
   * Section 2: the import runs as an Admin account.
   *
   * The capabilities alone are not enough, and the reason is section 5 invariant
   * 4: it is decided by **role** rather than by capability (2026-08-23), precisely
   * so a Whole Church grant does not satisfy it — and every assignment this service
   * opens is a *first* assignment, which never reaches it. Requiring the role is
   * the same check with no per-row path to forget.
   *
   * **Read from `account_roles` through the caller's transaction**, not from
   * anything the caller passed. That is the whole difference between this and the
   * version it replaces, and it is why `honouredRolesWithin` exists.
   *
   * Honoured rather than held: a `SENIOR_PASTOR` row this system refuses to honour
   * grants nothing (section 7), and would not satisfy this anyway — section 2 says
   * an Admin account, and section 7 keeps the two Senior Pastors away from
   * administrative operations on purpose.
   *
   * **It answers `SCOPE_DENIED`, and section 7 states that rule rather than this
   * being an inference from it.** Section 7: where an actor holds the capability by
   * another route "and it is the withheld **exemption** that refuses, that is a
   * statement about the actor's authority over a target rather than about what they
   * hold, and it answers `SCOPE_DENIED`, exactly as Section 5 invariant 4 does for
   * every other actor." That is this refusal — invariant 4's exemption withheld
   * because the account holds no exempting role — and
   * `HierarchyService.assertMayReparent`, invariant 4 where it normally lives,
   * throws the same.
   *
   * *`CAPABILITY_DENIED` was chosen first and was wrong, on a citation that dropped
   * the qualifier section 7 calls load-bearing.* Section 7 gives that code only
   * "where nothing else the account holds carries the capability" — and the actor
   * this check exists to stop is precisely one who **does** hold both, at Whole
   * Church, by explicit grant. Section 22's gloss for the code, "the actor lacks the
   * capability", is false of the reachable case, and an administrator reading it is
   * sent to grant what they already granted, which is the failure the two codes are
   * split to prevent.
   *
   * *A first correction then called this "the nearest rule rather than a stated
   * one", which was more tentative than the specification warrants — section 7's
   * sentence above is the rule, written for the Senior Pastor identity check and
   * general in its terms.*
   */
  private async assertActorMayImport(
    transaction: Transaction<Database>,
    actor: ImportActor,
  ): Promise<void> {
    const roles = await this.authorization.honouredRolesWithin(transaction, actor.accountId);

    if (!roles.includes('ADMIN')) {
      throw new ScopeDeniedError(
        'The leadership-tree import runs as an Admin account (section 2). Holding ' +
          '`people.create` and `people.manage_pastoral_assignment` at Whole Church is not ' +
          'enough: section 5 invariant 4 is decided by role, and every assignment an import ' +
          'opens is a first assignment that never reaches it.',
        { account_id: actor.accountId },
      );
    }
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
