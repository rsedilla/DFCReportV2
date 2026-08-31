import { Inject, Injectable } from '@nestjs/common';

import { SettingsService } from '../admin/settings/settings.service';
import { AuditService } from '../audit/audit.service';
import { Capability } from '../auth/authorization/capabilities';
import { AuthorizationService, type Actor } from '../auth/authorization/authorization.service';
import {
  CapabilityDeniedError,
  InvariantViolationError,
  NotFoundError,
} from '../common/errors/api-error';
import { IdempotencyService } from '../common/idempotency/idempotency.service';
import { DATABASE, type Db } from '../database/database.module';
import { PeopleReadService } from '../people/people.read.service';

import { insertCellWithin } from './insert-cell';

import type { CurrentClaim } from '../common/idempotency/current-idempotency.decorator';
import type { CellCategory, Database } from '../database/schema';
import type { Transaction } from 'kysely';

export interface CreateCellDirectlyInput {
  cellLeaderId: string;
  category: CellCategory;
  /** ISO 8601: 1 is Monday, 7 is Sunday (SKILL.md section 20). */
  dayOfWeek: number;
  /** Wall-clock time in Asia/Manila, `HH:MM` or `HH:MM:SS`. */
  timeOfDay: string;
}

/**
 * Creating a Cell (SKILL.md section 10).
 *
 * **Only the initial-encoding path is here, and that is the whole of what section 2
 * relaxes.** Outside the phase a Cell comes into existence only through
 * request-and-approve, and `cell.manage_lifecycle` confers no power to create one.
 * While the phase is open, "Admin creates the Cell and the leadership assignment
 * directly, exercising `cell.approve_leadership` and `cell.manage_leadership` at
 * Whole Church scope" — the request step is skipped because there is nothing to
 * request, the Cells already exist in the church, and approval is not bypassed
 * since Admin is the approver.
 *
 * **The account step is deliberately not here.** Section 10 has approval proceed to
 * it, and section 7 provides in terms for "an actor holding only the first, who
 * records the assignment and leaves the account step pending" — so the two are
 * separately authorized actions rather than one write. Section 2 says the same of
 * this path: creating the Cell "is also what allows the leader's account to be
 * provisioned", which is permission rather than performance. The account is
 * provisioned by `POST /api/v1/accounts`, which from this change accepts a `LEADER`
 * because there is now a leadership assignment to qualify one.
 *
 * The alternative — provisioning inside this transaction — was rejected on section
 * 6's own shape: an email is sent after the transaction commits, and folding that
 * into Cell creation would make a delivery failure a fact about a Cell.
 */
@Injectable()
export class CellsService {
  constructor(
    @Inject(DATABASE) private readonly db: Db,
    private readonly people: PeopleReadService,
    private readonly authorization: AuthorizationService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly idempotency: IdempotencyService,
  ) {}

  async createDirectly(
    input: CreateCellDirectlyInput,
    actor: Actor,
    claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    // **Before the transaction, deliberately.** `authorize` reads `account_roles`,
    // `capability_grants` and — for a subtree scope — the tree, all on the pool. A
    // request that already holds a pooled connection for its transaction and then
    // asks for another is the liveness hazard section 24 names: the pool is bounded
    // at ten with no acquisition timeout, so ten concurrent creations would hold ten
    // connections and each wait for ever on an eleventh, and the liveness probe
    // shares that pool. `PeopleReassignmentService` is the established shape and
    // this follows it.
    //
    // Nothing in the tree can change the answer between here and the write, because
    // this grant is Whole Church: it does not resolve through the tree at all.
    await this.assertActorHoldsBothCapabilities(actor);

    return this.db.transaction().execute(async (trx) => {
      await this.assertEncodingPhaseOpen(trx);
      await this.assertActorIsAdmin(trx, actor);

      const person = await this.people.forDecisionWithin(trx, input.cellLeaderId);

      if (!person) {
        throw new NotFoundError('No such person.');
      }

      // The two refusals every path in this system makes about a target Person,
      // and they are made here rather than left to the foreign key: a merged
      // Person is not the one who holds the identity (section 3), and an archived
      // Person does not acquire new live relationships (section 3, section 5).
      if (person.mergedIntoId !== null) {
        throw new InvariantViolationError(
          'That person was absorbed by a merge. Name the surviving Person instead.',
          { cell_leader_id: input.cellLeaderId },
        );
      }

      if (person.isArchived) {
        throw new InvariantViolationError(
          'That person is archived, so they cannot be given a Cell to lead. Restore them ' +
            'first, which is a separate and separately audited decision.',
          { cell_leader_id: input.cellLeaderId },
        );
      }

      const created = await insertCellWithin(trx, input, actor.accountId);

      await this.audit.writeWithin(trx, {
        actorId: actor.accountId,
        action: 'cell.created',
        targetType: 'cell',
        targetId: created.id,
        after: {
          cell_id: created.cellId,
          state: 'ACTIVE',
          cell_leader_id: input.cellLeaderId,
          category: input.category,
          day_of_week: input.dayOfWeek,
          time_of_day: input.timeOfDay,
          // Section 2 makes this path available only while the phase is open, and
          // the entry says which path created the Cell. After the phase closes,
          // every Cell carries an approval instead.
          created_during_initial_encoding: true,
        },
      });

      // Section 11 makes this a fact of its own rather than a detail of the Cell:
      // it is what makes the person a current Cell Leader, and section 16 counts
      // New Cell Leaders by when a leadership assignment starts.
      await this.audit.writeWithin(trx, {
        actorId: actor.accountId,
        action: 'cell_leadership.opened',
        // **The Cell, on section 21's rule for all three leadership actions.** Scope
        // resolves an audit entry through its target (section 7), and section 7 gives
        // "a Cell, a Cell meeting, a membership or a leadership" one resolution — so a
        // Cell target is read by the rule written for what this entry is about.
        //
        // *This named the person until 2026-08-31, while `ended` and `changed` named
        // the Cell, and nothing had decided the split. Where exactly the two targets
        // give different answers is deliberately not claimed here: section 7 resolves a
        // Cell "as of the period being viewed" and defines that phrase, but not what
        // period a read of *this log* asks about — one entry is an instant and a
        // filtered range is a range. That is on CLAUDE.md's open list. Three drafts
        // asserted an answer and each was refuted; the rule rests on none of them.*
        targetType: 'cell',
        targetId: created.id,
        // Section 21 asks a leadership entry to carry "the outgoing and the incoming
        // leader where each exists". There is no outgoing one at a creation, and the
        // incoming leader is named in `after` rather than left to the entry's
        // `target_id`, so a handover's entry and this one read the same way — which
        // is also what makes the target a free choice rather than the only place the
        // leader appears.
        after: {
          cell_id: created.cellId,
          cell_uuid: created.id,
          cell_leader_id: input.cellLeaderId,
        },
      });

      // **Section 21 lists this as an action in its own right**: "Cell leadership
      // assignment left with account provisioning pending". This path always
      // produces that state — it writes no account and sends no email, because
      // section 7 makes the account a separately authorized step — and nothing else
      // in the system will record it. Section 6 says the same in the paragraph that
      // provides for an actor "who records the assignment and leaves the account
      // step pending".
      //
      // Written unconditionally rather than only where the actor lacks
      // `accounts.manage`, because section 21's item names a state rather than an
      // actor, and the state is the same either way: a Cell Leader with no account
      // until somebody calls `POST /api/v1/accounts`.
      await this.audit.writeWithin(trx, {
        actorId: actor.accountId,
        action: 'cell_leadership.account_pending',
        targetType: 'person',
        targetId: input.cellLeaderId,
        after: { cell_id: created.cellId },
      });

      const response = {
        id: created.id,
        cell_id: created.cellId,
        state: 'ACTIVE',
        cell_leader_id: input.cellLeaderId,
        category: input.category,
        day_of_week: input.dayOfWeek,
        time_of_day: created.timeOfDay,
        created_at: created.createdAt.toISOString(),
      };

      // Last statement in the transaction, holding the key's row lock, and
      // recording exactly what the endpoint returns (CLAUDE.md, Write endpoints).
      await this.idempotency.completeWithin(trx, {
        ...claim,
        status: 201,
        body: response,
      });

      return response;
    });
  }

  /**
   * Section 2: this path exists only while initial encoding is open, and closes
   * with it.
   *
   * Asked inside the caller's transaction, so the answer cannot be the state the
   * request arrived with — closing the phase is an audited Admin action and may
   * commit between a pooled read and this write.
   */
  private async assertEncodingPhaseOpen(trx: Transaction<Database>): Promise<void> {
    if (!(await this.settings.initialEncodingOpenWithin(trx))) {
      throw new InvariantViolationError(
        'Initial encoding is closed, so a Cell is no longer created directly. Every Cell ' +
          'now comes into existence through request-and-approve (SKILL.md section 10).',
        { initial_encoding_open: false },
      );
    }
  }

  /**
   * The second capability section 2 names, **at the scope section 2 names it at**.
   *
   * Section 2: Admin creates the Cell and the leadership assignment directly,
   * "exercising `cell.approve_leadership` and `cell.manage_leadership` at Whole
   * Church scope". The guard declares the first; section 7 settles that a guard
   * resolves one capability against one target, so the second is here.
   *
   * **The target is `church`, and an earlier version resolved it against the
   * prospective leader — which was a live authorization gap.**
   * `cell.manage_leadership` is not in `WHOLE_CHURCH_ONLY`, and every role default
   * carries it, `LEADER` at `OWN_SUBTREE` with the actor themselves included. So a
   * Leader holding an Admin-issued Whole Church grant of `cell.approve_leadership`
   * — which section 7 permits explicitly — passed the guard and then satisfied a
   * subtree check against their own disciple, or against themselves.
   *
   * That is section 10's own sentence, verbatim: "`cell.manage_leadership` at
   * own/subtree scope would let a leader hand a Cell to their own disciple with
   * nobody else involved — the outcome the creation workflow exists to prevent,
   * reached by the one route it did not cover." And naming themselves is what
   * section 10 forbids outright, because it restores their own Current Cell Leader
   * status and their upline's Leaders-with-12+ count with no second party.
   *
   * A `church` target admits only a Whole Church grant, which is what section 2
   * asks for and what makes the check mean anything.
   *
   * **The code it answers with is whatever `authorize` decides**, and an earlier
   * comment here claimed `SCOPE_DENIED` on the reasoning that passing the guard
   * implies holding this capability. It does not: the guard tests a different
   * capability. `SCOPE_DENIED` is what the reachable case produces, because every
   * role default carries `cell.manage_leadership` and only its scope can fail —
   * but an account whose sole role row is an unhonoured `SENIOR_PASTOR` one holds
   * nothing by default and would get `CAPABILITY_DENIED`, correctly.
   */
  private async assertActorHoldsBothCapabilities(actor: Actor): Promise<void> {
    await this.authorization.authorize(actor, Capability.CellManageLeadership, {
      kind: 'church',
    });
  }

  /**
   * Section 2 and section 10 both give this path to **Admin**, and the capabilities
   * alone are not that.
   *
   * Section 2 settled the identical ambiguity one paragraph away, for the tree
   * import: "The role is required, and the capabilities alone are not enough… an
   * implementer following the stated condition accepts a `LEADER` account holding
   * both at Whole Church, which Section 7 lets Admin grant." The same sentence is
   * true here, and the escalation it admits is larger: a Cell created outside
   * request-and-approve mints a Cell Leader.
   *
   * **Honoured rather than held**, and read from `account_roles` through the
   * caller's transaction rather than from anything the caller supplies — the shape
   * `PeopleImportService` settled on 2026-08-26. A `SENIOR_PASTOR` row this system
   * refuses to honour grants nothing (section 7), and would not satisfy this in any
   * case: section 2 names an Admin account, and section 7 keeps the two Senior
   * Pastors away from administrative operations deliberately.
   *
   * `CAPABILITY_DENIED`: the actor lacks a role rather than the reach of a grant,
   * which is what that code means where the refusal is not about a target (section
   * 22, and the 2026-08-26 ruling on the import's own role check).
   */
  private async assertActorIsAdmin(trx: Transaction<Database>, actor: Actor): Promise<void> {
    const roles = await this.authorization.honouredRolesWithin(trx, actor.accountId);

    if (!roles.includes('ADMIN')) {
      throw new CapabilityDeniedError(
        "Creating a Cell directly is Admin's, during initial encoding only (SKILL.md " +
          'section 2). Outside it, a Cell comes into existence through request-and-approve.',
        { required_role: 'ADMIN' },
      );
    }
  }
}
