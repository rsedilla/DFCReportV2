import { Inject, Injectable } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import {
  AuthorizationService,
  type Actor,
  type ActorAuthority,
} from '../auth/authorization/authorization.service';
import { Capability } from '../auth/authorization/capabilities';
import {
  InvariantViolationError,
  NotFoundError,
  ScopeDeniedError,
  ValidationFailedError,
} from '../common/errors/api-error';
import { NIL_UUID, sameId } from '../common/identifiers';
import { IdempotencyService } from '../common/idempotency/idempotency.service';
import { DATABASE, type Db } from '../database/database.module';

import { CellsReadService } from './cells.read.service';
import {
  decodeLeadershipRequestCursor,
  encodeLeadershipRequestCursor,
} from './leadership-request-cursor';

import type { CurrentClaim } from '../common/idempotency/current-idempotency.decorator';
import type {
  CellCategory,
  CellDeclineReason,
  CellRequestKind,
  Database,
} from '../database/schema';
import type { Transaction } from 'kysely';

export interface LeadershipRequestInput {
  kind: CellRequestKind;
  prospectiveLeaderId: string;
  category?: CellCategory;
  dayOfWeek?: number;
  timeOfDay?: string;
  cellId?: string;
}

/**
 * The Cell leadership request workflow: step one, and its decline
 * (SKILL.md section 10, *Creating a Cell*).
 *
 * **A request creates nothing.** Section 10: a `PENDING` request "creates no Cell,
 * holds no members, records no attendance, changes no leadership, and appears in no
 * count or metric". That is what lets this service exist without touching `cells`,
 * `cell_leaderships`, `cell_categories`, `cell_schedules` or `accounts` — approval
 * writes all of those in one transaction, and it lands separately.
 *
 * **One service for both kinds, because section 10 makes it one workflow.** Both carry
 * the same state machine, the same decline reasons, the same approver and the same two
 * steps, and splitting them "would duplicate all four and let them drift".
 */
@Injectable()
export class CellsLeadershipRequestService {
  constructor(
    @Inject(DATABASE) private readonly db: Db,
    private readonly authorization: AuthorizationService,
    private readonly audit: AuditService,
    private readonly idempotency: IdempotencyService,
    private readonly cells: CellsReadService,
  ) {}

  /**
   * Submit a request that a person should lead a Cell — a new one, or an existing one
   * handed to them.
   *
   * The guard has already resolved `cell.request_leadership` against the **prospective
   * leader**, at subtree-excluding-self — the one scope value in the system chosen so
   * that the object it resolves against is also the one object the actor may not be
   * (section 7, section 10).
   *
   * **That is not what enforces section 10's prohibition, and three docblocks said it
   * was.** "No holder of the capability, at any scope, may name themselves" is
   * categorical, and a scope value delivers it only while the grant carries that scope:
   * `scopeCovers` returns true on its first line for a `WHOLE_CHURCH` grant, before the
   * target is read at all, and a `NETWORK` grant compares a Network that for the actor
   * is their own. Section 7 lets Admin grant beyond a role's defaults and refuses no
   * wider grant. The prohibition is therefore the domain check below, which is the shape
   * section 7 prescribes wherever a rule forbids acting on oneself and which section 10
   * points at by naming section 5 invariant 4.
   *
   * **What is left is the Cell**, which only a handover has. Section 7 settles the
   * shape: the guard checks one target, and a rule about a second object is a check in
   * the owning module.
   *
   * **Nothing about the prospective leader is revalidated here, deliberately.** Section
   * 10 puts that at approval — "the state at approval governs, never the state at
   * request" — and a request naming somebody since archived is refused there, creating
   * nothing. Refusing it here as well would be a rule section 10 does not state, and it
   * would be the wrong one: a `PENDING` request is not a live relationship, so section
   * 3's bar on an archived Person acquiring one is not engaged.
   *
   * **The cost is a slot, and it is what makes the queue non-optional.** A `PENDING`
   * `NEW_CELL` request occupies its prospective leader's slot under
   * `cell_leadership_requests_one_pending_new_cell`, so a request that can never be
   * approved — one naming somebody archived the day after it was submitted — blocks
   * every later request for that person until it is declined. Declining is cheap and is
   * the remedy; what it needs is for somebody to see the stale row, which is why
   * section 19 puts pending requests on the Admin queue rather than leaving them to be
   * discovered by the next submission failing.
   */
  async request(
    input: LeadershipRequestInput,
    actor: Actor,
    claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    // **Before the transaction** (section 24). `authorityFor` reads `account_roles`
    // and `capability_grants` on the pool, and asking a bounded pool for a second
    // connection while holding one is the liveness hazard that section names.
    const authority = await this.authorization.authorityFor(actor.accountId);

    if (sameId(input.prospectiveLeaderId, actor.personId)) {
      // **Section 10: "No holder of the capability, at any scope, may name
      // themselves."** `SUBTREE_EXCL_SELF` delivers that only while the grant is
      // exactly that scope — `scopeCovers` returns true on its first line for a
      // `WHOLE_CHURCH` grant, before the target is read at all, and a `NETWORK` grant
      // compares the target's Network, which for the actor is their own. Section 7
      // permits Admin to grant any capability beyond a role's defaults and has no
      // mechanism refusing a *wider* grant, so both are ordinary rows.
      //
      // Section 10 says "at any scope" and cites section 5 invariant 4 as "the same
      // prohibition ... for the same reason" — and that one is a domain check rather
      // than a scope value, which is the shape section 7 prescribes where a rule
      // forbids acting on oneself. So this is section 10 implemented rather than a rule
      // invented: without it a leader whose only Cell has closed, holding one
      // Admin-issued Whole Church grant, restores their own Current Cell Leader status
      // with no upline involved.
      //
      // `sameId` rather than `===`, because this fails *open*: the check refuses, so a
      // mis-cased identifier skips it (section 7, the 2026-08-23 rule).
      throw new ScopeDeniedError(
        'A request names somebody else. No holder of this capability, at any scope, may ' +
          'name themselves (SKILL.md section 10).',
        { capability: Capability.CellRequestLeadership },
      );
    }

    if (input.kind === 'NEW_CELL' && input.cellId !== undefined) {
      // Refused rather than ignored. `cell_leadership_requests_new_cell_has_no_cell_
      // before_approval` says a PENDING NEW_CELL row names no Cell, so a client that
      // sent one meant something the workflow cannot do — dropping it silently would
      // answer 201 to a request the server did not perform.
      //
      // Here rather than on the DTO: two `@ValidateIf`s on one property are ANDed
      // rather than replaced, so "required for one kind and forbidden for the other"
      // is an unsatisfiable conjunction and cannot be expressed there at all.
      throw new ValidationFailedError(
        'A new-Cell request names no Cell. Section 10: nothing names one until approval ' +
          'mints it.',
        { field: 'cell_id' },
      );
    }

    return this.db.transaction().execute(async (trx) => {
      const cell =
        input.kind === 'HANDOVER'
          ? await this.assertHandoverCellWithin(trx, input, actor, authority)
          : null;

      // **Two uniqueness rules, one per kind, and they are not the same rule** (section
      // 10). Both are partial unique indexes and both stay the enforcement; these reads
      // exist so the ordinary case is a sentence rather than a `23505` rendered
      // `INTERNAL_ERROR` — the 500-instead-of-an-answer failure this repository keeps
      // recording. A race still lands on the index, which is the lesser half and is why
      // neither check is itself the enforcement.
      await this.assertNoConflictingPendingWithin(trx, input);

      const row = await trx
        .insertInto('cell_leadership_requests')
        .values({
          kind: input.kind,
          prospective_leader_id: input.prospectiveLeaderId,
          requested_by: actor.accountId,
          category: input.kind === 'NEW_CELL' ? (input.category as CellCategory) : null,
          day_of_week: input.kind === 'NEW_CELL' ? (input.dayOfWeek as number) : null,
          time_of_day: input.kind === 'NEW_CELL' ? (input.timeOfDay as string) : null,
          cell_id: input.kind === 'HANDOVER' ? (input.cellId as string) : null,
        })
        .returning(['id', 'state', 'requested_at'])
        .executeTakeFirstOrThrow();

      // Section 21 names "Cell leadership requested" with its kind. The prospective
      // leader is the target, because that is what the request is about and what a
      // reader asking how a leader was developed searches on — section 10 calls the
      // retained decline record exactly that.
      await this.audit.writeWithin(trx, {
        actorId: actor.accountId,
        action: 'cell_leadership_request.submitted',
        targetType: 'person',
        targetId: input.prospectiveLeaderId,
        before: null,
        after: {
          request_id: row.id,
          kind: input.kind,
          // Spread with explicit nulls rather than `undefined`: an absent key and a
          // key holding `undefined` are the same thing to `JSON.stringify`, but the
          // audit payload is typed `Json` and `undefined` is not one — so the union
          // refuses it rather than storing a hole nobody notices.
          ...(input.kind === 'NEW_CELL'
            ? {
                category: input.category ?? null,
                day_of_week: input.dayOfWeek ?? null,
                time_of_day: input.timeOfDay ?? null,
              }
            : { cell_id: cell?.cell_id ?? null, cell_uuid: cell?.id ?? null }),
        },
      });

      const response = {
        id: row.id,
        kind: input.kind,
        state: row.state,
        prospective_leader_id: input.prospectiveLeaderId,
        requested_at: row.requested_at.toISOString(),
        // Section 22 gives one concept one field name: `cell_id` is the `CELL-000000`
        // handle and the UUID travels as `cell_uuid`, which slice 2 established and the
        // membership routes follow. Null on a new Cell, where section 10 says nothing
        // names one until approval mints it.
        cell_id: cell?.cell_id ?? null,
        cell_uuid: cell?.id ?? null,
        category: input.kind === 'NEW_CELL' ? (input.category ?? null) : null,
        day_of_week: input.kind === 'NEW_CELL' ? (input.dayOfWeek ?? null) : null,
        time_of_day: input.kind === 'NEW_CELL' ? (input.timeOfDay ?? null) : null,
      };

      await this.idempotency.completeWithin(trx, { ...claim, status: 201, body: response });

      return response;
    });
  }

  /**
   * Decline a pending request, with a reason from the fixed list.
   *
   * **The requester may decline their own request** (section 10, *Declining*, and the
   * ruling of 2026-08-30). The prohibition section 10 states is on *approving* one you
   * submitted, and its reason does not carry: the requester benefits from an approval —
   * it moves Current Cell Leaders, New Cell Leaders for the period, and their own
   * progress toward Leaders with 12+ Direct Leaders — and benefits from a decline not
   * at all. `SUBMITTED_IN_ERROR` is in the fixed list for exactly this.
   *
   * The strict reading was refused because it is terminal rather than merely stricter:
   * `cell.approve_leadership` is Admin's alone, so on a single-Admin deployment a
   * request Admin submitted could be approved by nobody — correctly — and declined by
   * nobody either, leaving it `PENDING` for ever with the per-leader unique index
   * blocking every future `NEW_CELL` request for that person.
   *
   * **A decision is final**, so this refuses a request already decided rather than
   * rewriting it. The database refuses it too, in `cell_leadership_request_is_final`;
   * this is here so the answer is a sentence rather than a trigger message.
   */
  async decline(
    requestId: string,
    reason: CellDeclineReason,
    note: string | undefined,
    actor: Actor,
    claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    return this.db.transaction().execute(async (trx) => {
      // `FOR UPDATE`, because two concurrent declines would otherwise both read
      // `PENDING` and both write a decision — and the second would be refused by the
      // finality trigger as a `restrict_violation`, which nothing classifies. That
      // trigger is `BEFORE UPDATE FOR EACH ROW` rather than deferred, so it fires at the
      // statement once this lock releases; an earlier version of this comment said "at
      // COMMIT", which is the wrong mechanism for the right conclusion.
      // Taken on the request row alone: this operation writes no person-scoped edge, so
      // it needs none of the advisory locks section 5 orders.
      const existing = await trx
        .selectFrom('cell_leadership_requests')
        .select(['id', 'kind', 'state', 'prospective_leader_id', 'cell_id'])
        .where('id', '=', requestId)
        .forUpdate()
        .executeTakeFirst();

      if (!existing) {
        throw new NotFoundError('No such leadership request.');
      }

      if (existing.state !== 'PENDING') {
        throw new InvariantViolationError(
          'That request was already decided. A decision is never withdrawn or rewritten, ' +
            'and a declined request is retained as part of the record of how a leader was ' +
            'developed (SKILL.md section 10).',
          { request_id: existing.id, state: existing.state },
        );
      }

      const decidedAt = await this.nowWithin(trx);

      await trx
        .updateTable('cell_leadership_requests')
        .set({
          state: 'DECLINED',
          decline_reason: reason,
          note: note ?? null,
          decided_by: actor.accountId,
          decided_at: decidedAt,
        })
        .where('id', '=', existing.id)
        .execute();

      // Section 21: "Cell leadership request declined, with the kind and the reason."
      await this.audit.writeWithin(trx, {
        actorId: actor.accountId,
        action: 'cell_leadership_request.declined',
        targetType: 'person',
        targetId: existing.prospective_leader_id,
        before: { request_id: existing.id, state: 'PENDING' },
        after: {
          request_id: existing.id,
          kind: existing.kind,
          state: 'DECLINED',
          reason,
          // The note is recorded because `OTHER` requires one and it is the only place
          // the reason is expressed in words. Section 10 bounds what may be written
          // there: a decline records that a Cell was not opened at this time, never an
          // assessment of the person.
          note: note ?? null,
        },
      });

      const response = {
        id: existing.id,
        kind: existing.kind,
        state: 'DECLINED',
        reason,
        note: note ?? null,
        decided_at: decidedAt.toISOString(),
      };

      await this.idempotency.completeWithin(trx, { ...claim, status: 200, body: response });

      return response;
    });
  }

  /**
   * The Admin queue: pending requests of either kind, oldest first (section 19).
   *
   * **A read, so it takes no idempotency claim and opens no transaction.** The query
   * lives on `CellsReadService`, which is where this module's `SELECT`s are written;
   * this is `cells` answering its own controller.
   *
   * Section 22's envelope and its cursor pagination, with the `limit + 1` read that
   * answers whether another page exists without a count — section 22 returns no totals.
   */
  async pendingQueue(page: {
    limit?: number;
    cursor?: string;
  }): Promise<{ data: Record<string, unknown>[]; next_cursor: string | null }> {
    const limit = page.limit ?? 50;

    const rows = await this.cells.pendingLeadershipRequestsWithin(this.db, {
      limit: limit + 1,
      after: decodeLeadershipRequestCursor(page.cursor),
    });

    const visible = rows.slice(0, limit);
    const last = visible.at(-1);

    return {
      data: visible.map((row) => ({
        id: row.id,
        kind: row.kind,
        state: 'PENDING',
        prospective_leader_id: row.prospective_leader_id,
        requested_by: row.requested_by,
        requested_at: row.requested_at.toISOString(),
        // The Cell's UUID, and only for a handover. Section 10: for a new Cell nothing
        // names one until approval mints it. The `CELL-000000` handle is deliberately
        // not resolved here — it would be a join per page for a field the queue does
        // not decide anything by, and the Cell's own route carries it.
        cell_uuid: row.cell_id,
      })),
      next_cursor:
        rows.length > limit && last !== undefined
          ? encodeLeadershipRequestCursor({
              requestedAt: last.requested_at_key,
              id: last.id,
            })
          : null,
    };
  }

  /**
   * The Cell a handover names, and the actor's authority over it.
   *
   * **Resolved through `cell.manage_lifecycle`, which is section 10's own wording**:
   * the actor must have the Cell within their authorized scope "on the same terms that
   * govern closing it — its current leader, any leader upline of them acting within
   * their own subtree, Admin, or a Senior Pastor". That enumeration is exactly what
   * `OWN_SUBTREE`, `NETWORK` and `WHOLE_CHURCH` resolve to when the target is the
   * Cell's leader, so the rule is the capability that governs closing rather than a
   * list restated here.
   *
   * **Not that the three scope values resolve to that list**, which an earlier version
   * of this comment and of section 10 both claimed. A `NETWORK` grant covers every Cell
   * in a Network irrespective of pastoral position, which is wider than "any leader
   * upline of them acting within their own subtree"; no role holds any capability at
   * that scope by default, so the gap opens only through an explicit grant, and closing
   * a Cell has it too. `OWN_SUBTREE` is `LEADER`'s default for this capability, and
   * `ADMIN` and `SENIOR_PASTOR` hold it at Whole Church — which is how the other two
   * names on section 10's list are reached.
   *
   * **It cannot be `cell.request_leadership`**, which the guard already used: that one
   * is `SUBTREE_EXCL_SELF`, and the commonest handover of all has the actor *as* the
   * Cell's current leader — a leader stepping down and naming their own disciple. A
   * self-excluding scope would refuse exactly that.
   *
   * The consequence is narrow and worth stating rather than discovering: an actor
   * granted `cell.request_leadership` and not `cell.manage_lifecycle` cannot request a
   * handover. No role is in that position by default — every role holding the first
   * holds the second — and the outcome reads correctly anyway, since it means somebody
   * who could not close a Cell also cannot give it away.
   */
  private async assertHandoverCellWithin(
    trx: Transaction<Database>,
    input: LeadershipRequestInput,
    actor: Actor,
    authority: ActorAuthority,
  ): Promise<{ id: string; cell_id: string }> {
    const cell = await trx
      .selectFrom('cells')
      .select(['id', 'cell_id', 'state'])
      .where('id', '=', input.cellId as string)
      .executeTakeFirst();

    // **An absent Cell is answered the way an out-of-scope one is** (section 22): "an
    // actor whose scope does not cover a Cell cannot distinguish an absent Cell from one
    // they may not see — both answer `SCOPE_DENIED`, in one message carrying one details
    // payload. `NOT_FOUND` is therefore reached only by an actor whose scope *would*
    // have covered the Cell."
    //
    // Every other Cell route gets that from the guard, which resolves `{ kind: 'cell' }`
    // and hands `authorize` a target resolving to nobody. This route's guard resolves
    // the prospective leader instead, so the ordering is owed here — and an earlier
    // version answered `NOT_FOUND` before the scope check, which is an existence oracle
    // over Cell identifiers.
    //
    // The nil target reproduces the guard's own behaviour rather than restating it: a
    // Whole Church grant returns true before the target is read and so reaches
    // `NOT_FOUND`, and every narrower scope fails to cover it and gets the same refusal
    // an out-of-scope Cell gets.
    const leaderId = cell ? await this.cells.leaderForScopeWithin(trx, cell.id) : NIL_UUID;

    if (
      !(await this.authorization.coversWith(trx, actor, authority, Capability.CellManageLifecycle, {
        kind: 'person',
        personId: leaderId ?? NIL_UUID,
      }))
    ) {
      throw new ScopeDeniedError(
        'That Cell is outside your authorized scope. A handover is requested by the Cell ' +
          'leader or by a leader upline of them (SKILL.md section 10).',
        { capability: Capability.CellManageLifecycle },
      );
    }

    if (!cell) {
      // Reached only by an actor whose scope would have covered it, per the nil target
      // above — for whom absence is genuinely absence (section 22).
      throw new NotFoundError('No such Cell.');
    }

    if (leaderId === null) {
      throw new InvariantViolationError(
        'That Cell cannot be resolved to a leader, so there is no authority to check ' +
          'against (SKILL.md section 11).',
      );
    }

    if (cell.state === 'CLOSED') {
      // Section 10 lists a closed Cell among what approval must reject. A request
      // naming one can never be approved, so it is refused now rather than left to sit
      // pending for a refusal later.
      throw new InvariantViolationError(
        'That Cell is closed, so it cannot be handed to anyone. A closure is never ' +
          'reversed (SKILL.md section 10).',
        { cell_id: cell.cell_id },
      );
    }

    if (sameId(leaderId, input.prospectiveLeaderId)) {
      // Section 10: "A handover naming the Cell's current leader is refused." The
      // approval would end and reopen one leadership at a single instant, leaving an
      // audited operation that changed nothing and a boundary in the history where
      // nothing happened — the reasoning section 4 uses for a sex correction that
      // changes nothing and section 5 for a reassignment to the leader a person already
      // has.
      //
      // `sameId` rather than `===`: this compares a client-supplied identifier against
      // one out of a `uuid` column, and a check that fails *open* on a mis-cased value
      // normalizes again rather than trusting the boundary pipe (section 7).
      throw new InvariantViolationError(
        'That person already leads this Cell, so there is nothing to hand over ' +
          '(SKILL.md section 10).',
        { cell_id: cell.cell_id, person_id: input.prospectiveLeaderId },
      );
    }

    return { id: cell.id, cell_id: cell.cell_id };
  }

  /**
   * The two uniqueness rules, asked as questions rather than met as constraints.
   *
   * **Neither is widened to cover both kinds, and section 10 says why.** A pending new
   * Cell for a person and a pending handover of some other Cell to the same person are
   * different questions about different Cells, both legitimate — one leader may lead
   * many. Widening the first across kinds would make the second unsubmittable rather
   * than declinable, and `DUPLICATE_REQUEST` exists in the fixed list precisely so a
   * person adjudicates a case like that rather than an index refusing it.
   */
  private async assertNoConflictingPendingWithin(
    trx: Transaction<Database>,
    input: LeadershipRequestInput,
  ): Promise<void> {
    const conflict = await trx
      .selectFrom('cell_leadership_requests')
      .select('id')
      .where('state', '=', 'PENDING')
      .where('kind', '=', input.kind)
      .where((eb) =>
        input.kind === 'NEW_CELL'
          ? eb('prospective_leader_id', '=', input.prospectiveLeaderId)
          : eb('cell_id', '=', input.cellId as string),
      )
      .executeTakeFirst();

    if (!conflict) {
      return;
    }

    throw new InvariantViolationError(
      input.kind === 'NEW_CELL'
        ? 'That person already has a pending request for a new Cell. Decide that one ' +
            'first (SKILL.md section 10).'
        : 'That Cell already has a pending handover request. Decide that one first ' +
            '(SKILL.md section 10).',
      { request_id: conflict.id },
    );
  }

  /**
   * The database clock, read inside the transaction.
   *
   * `clock_timestamp()` rather than `now()`, which is transaction start: this row is
   * written after a `FOR UPDATE` wait, and stamping it with the instant the request
   * arrived would put the decision before a write it followed. That is the defect the
   * closure endpoint shipped once and had to correct.
   */
  private async nowWithin(trx: Transaction<Database>): Promise<Date> {
    const row = await trx
      .selectNoFrom((eb) => eb.fn<Date>('clock_timestamp', []).as('at'))
      .executeTakeFirstOrThrow();

    return row.at;
  }
}
