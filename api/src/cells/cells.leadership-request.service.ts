import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

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
  ResourceBusyError,
  ScopeDeniedError,
  ValidationFailedError,
} from '../common/errors/api-error';
import { NIL_UUID, sameId } from '../common/identifiers';
import { IdempotencyService } from '../common/idempotency/idempotency.service';
import { CellLock, lockCellsWithin } from '../database/cell-lock';
import { DATABASE, type Db } from '../database/database.module';
import { HierarchyService } from '../hierarchy/hierarchy.service';
import { boundLockWaitsWithin, lockPersonsWithin } from '../database/person-lock';
import { NetworksService } from '../networks/networks.service';
import { PeopleReadService } from '../people/people.read.service';

import { CellsReadService } from './cells.read.service';
import { insertCellWithin } from './insert-cell';
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

/** The columns approval reads from a `PENDING` request under its row lock. */
interface PendingRequest {
  id: string;
  kind: CellRequestKind;
  state: string;
  prospective_leader_id: string;
  requested_by: string;
  cell_id: string | null;
  category: CellCategory | null;
  day_of_week: number | null;
  time_of_day: string | null;
}

/** What an approval did, shared by both kinds so the caller writes one record. */
interface AppliedApproval {
  /** The instant the write took effect, and the request's `decided_at`. */
  at: Date;
  cellId: string;
  cellUuid: string;
  outgoingLeaderId: string | null;
}

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
 * **A request creates nothing; an approval creates everything.** Section 10: a
 * `PENDING` request "creates no Cell, holds no members, records no attendance, changes
 * no leadership, and appears in no count or metric". `request` and `decline` therefore
 * touch only `cell_leadership_requests`; `approve` is where `cells`,
 * `cell_categories`, `cell_schedules` and `cell_leaderships` are written, in one
 * transaction.
 *
 * `accounts` is the one it still does not touch, and that is section 10's ruling of
 * 2026-08-30 rather than an omission: approval records the leadership and leaves the
 * account step pending, writing the entry section 21 names for that state.
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
    private readonly people: PeopleReadService,
    private readonly networks: NetworksService,
    private readonly hierarchy: HierarchyService,
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
   * target is read at all, and a `NETWORK` grant covers the actor wherever it names
   * their own Network. Section 7 lets Admin grant beyond a role's defaults and refuses no
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
      // **The bound, which this operation owes and did not set** (section 5). It takes
      // a row lock and locks no person, so `lockPersonsWithin`'s early return never
      // sets `lock_timeout` for it -- "a caller that takes row locks must set the bound
      // itself where its person list can be empty". Approval is what made that
      // reachable: it now holds this same row across an entire Cell creation, so a
      // concurrent decline can wait on a transaction doing three seconds of lock waits
      // of its own, in a bounded pool the liveness probe shares (section 24).
      await boundLockWaitsWithin(trx);

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
   * Approve a pending request: mint the Cell, or hand an existing one over
   * (SKILL.md section 10, *Step two — Admin approves*).
   *
   * **The guard has declared `cell.approve_leadership` against the church**, which
   * section 7 gives to Admin alone at Whole Church only — so a grant issued narrower
   * covers nothing and is refused `SCOPE_DENIED` before this runs.
   *
   * **What this method owes on top of that is section 10's per-request control**: "no
   * actor may approve a request they submitted", which holds "even where one person
   * happens to hold both capabilities" and must not be left to the two capabilities
   * never meeting in one actor. Migration 0009 carries the same rule as
   * `..._approver_is_not_requester`; this is here so the answer is a sentence rather
   * than a constraint violation rendered `INTERNAL_ERROR`.
   *
   * **Everything takes effect at approval, never at request**, so there is no effective
   * date to send and none is accepted. Section 16 counts New Cell Leaders by when a
   * leadership assignment starts, and section 10 is explicit that a request made on 30
   * September and approved on 2 October belongs to October.
   *
   * **One instant, taken from the write itself.** A new Cell's four rows share the
   * Cell's `created_at`, and a handover's two share the closing row's `ended_at`;
   * `decided_at` is that same value rather than a second clock read. Migration 0009
   * refuses a handover whose two rows differ by so much as a microsecond, and its own
   * comment names the cause: "any approval endpoint that reads the clock twice produces
   * this shape by accident."
   */
  async approve(
    requestId: string,
    actor: Actor,
    claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    // ------------------------------------------------------------------
    // On the pool, before the transaction opens (section 24). `authorityFor` and
    // `actorFor` each read a table, and asking a bounded pool for a second
    // connection while holding one is the liveness hazard that section names.
    // ------------------------------------------------------------------
    // **The actor's own authority is deliberately not read here.** Every scope
    // question this operation asks is about the *requester* (section 10), and the only
    // thing asked of the approver is `cell.approve_leadership`, which the guard has
    // already decided against the church — section 7 gives it at Whole Church only, so
    // there is no narrower reach left for a domain check to test.
    //
    // **Read once here to learn whom to lock, then read again under the lock.** The
    // person locks must be taken before any `cells` row lock (section 5), and the
    // people this operation touches are named by the request rather than by the
    // caller — so the list cannot be built without reading it first.
    //
    // **Two of the three values the lock list is built from are frozen, and the third
    // is not.** `cell_leadership_request_is_final` freezes the kind and the person
    // named (and `requested_by`, which chooses whose authority is read rather than
    // what is locked). It does **not** freeze `cell_id`, which decides which `cells`
    // row is locked and whose leadership is looked up. So the pre-read is not safe by
    // the trigger alone, and the re-read under the lock compares what the trigger does
    // not guarantee rather than assuming it.
    //
    // *An earlier version of this paragraph claimed the trigger made every value the
    // locks are chosen from immutable, which is broader than the trigger. The commit
    // that recorded that finding said it had been corrected here and corrected only
    // the comparison further down — a fix claimed in the past tense and not made,
    // which is the class it was fixing.*
    const pre = await this.db
      .selectFrom('cell_leadership_requests')
      .select(['id', 'kind', 'prospective_leader_id', 'requested_by', 'cell_id'])
      .where('id', '=', requestId)
      .executeTakeFirst();

    if (!pre) {
      // Safe as a `NOT_FOUND` rather than a denial: the guard admits only a Whole
      // Church holder of `cell.approve_leadership`, so every caller reaching here
      // would have been covered had the request existed — which is exactly the actor
      // section 22 reserves `NOT_FOUND` for.
      throw new NotFoundError('No such leadership request.');
    }

    const requester = await this.authorization.actorFor(pre.requested_by);

    if (requester === null) {
      // Unreachable while `requested_by` references `accounts` and section 5 refuses
      // to delete a row that carries authority history. Refused rather than assumed
      // away, because the alternative is evaluating the requester's scope against
      // nobody and silently approving.
      throw new InvariantViolationError(
        'The account that submitted this request no longer exists, so the scope it was ' +
          'submitted under cannot be revalidated (SKILL.md section 10).',
        { request_id: pre.id },
      );
    }

    const requesterAuthority = await this.authorization.authorityFor(pre.requested_by);

    // The outgoing leader, for a handover, so the lock list is complete. Re-read
    // under the locks below; this value decides nothing.
    const outgoingBeforeLock =
      pre.kind === 'HANDOVER' && pre.cell_id !== null
        ? await this.cells.leaderForScope(pre.cell_id)
        : null;

    return this.db.transaction().execute(async (trx) => {
      // ------------------------------------------------------------------
      // The locks, in the order section 5 fixes: the bound, then people, then Cells.
      // ------------------------------------------------------------------
      await boundLockWaitsWithin(trx);

      // Both leaders, because both Networks are compared. `assert_leadership_stays_
      // in_network` reads `network_as_of` for the incoming leader and for the row it
      // succeeds, and a Network change on either is exactly what the advisory lock
      // serializes against (section 5). The prospective leader always needs one: a
      // person who leads nobody may have their Network corrected freely (section 4),
      // so "they lead a Cell already" is not a reason to skip it. The helper sorts by
      // lock key; this call site must not.
      await lockPersonsWithin(
        trx,
        [pre.prospective_leader_id, outgoingBeforeLock].filter((id): id is string => id !== null),
      );

      // `FOR SHARE`: this operation does not write the `cells` row, and depends on its
      // `state` staying put — the same strength `CellLock.ReadsTheState` documents. It
      // conflicts with the `FOR NO KEY UPDATE` a closure takes, which is what stops a
      // Cell closing underneath a handover, and it does not conflict with itself.
      if (pre.kind === 'HANDOVER' && pre.cell_id !== null) {
        await lockCellsWithin(trx, [{ cellId: pre.cell_id, strength: CellLock.ReadsTheState }]);
      }

      // ------------------------------------------------------------------
      // What the locks make it safe to decide.
      // ------------------------------------------------------------------

      // `FOR UPDATE` on the request, so two concurrent approvals cannot both read
      // `PENDING`. The second would otherwise be refused by the finality trigger as a
      // `restrict_violation`, which nothing classifies.
      const request = await trx
        .selectFrom('cell_leadership_requests')
        .select([
          'id',
          'kind',
          'state',
          'prospective_leader_id',
          'requested_by',
          'cell_id',
          'category',
          'day_of_week',
          'time_of_day',
        ])
        .where('id', '=', requestId)
        .forUpdate()
        .executeTakeFirst();

      if (!request) {
        throw new NotFoundError('No such leadership request.');
      }

      if (request.state !== 'PENDING') {
        throw new InvariantViolationError(
          'That request was already decided. A decision is never withdrawn or rewritten ' +
            '(SKILL.md section 10, *Declining*). The way forward from a decline is a new ' +
            'request.',
          { request_id: request.id, state: request.state },
        );
      }

      // **Section 10's enforceable control**, and it is checked here rather than
      // inferred from who holds what: "do not rely instead on the two capabilities
      // never meeting in one actor — Admin holds both by default, and separation
      // expressed only through role defaults is separation an Admin-issued grant can
      // undo". `sameId` rather than `===` because this refuses, so it fails *open*: a
      // mis-cased identifier would skip it (section 7, the 2026-08-23 rule).
      if (sameId(request.requested_by, actor.accountId)) {
        throw new ScopeDeniedError(
          'You submitted this request, so you may not approve it. Approving a new Cell ' +
            'Leader needs a second party (SKILL.md section 10).',
          { capability: Capability.CellApproveLeadership },
        );
      }

      // **`requested_by` and `cell_id`, and they are here for different reasons.**
      // `requested_by` chooses whose authority was read before the transaction, not
      // what was locked; `cell_id` chooses which `cells` row was locked and whose
      // leadership was looked up. `cell_leadership_request_is_final` freezes the first
      // and not the second (migration 0009), so only one of the two would be safe to
      // argue rather than check.
      //
      // **The remedy is a bare retry, and the message says so.** This whole paragraph
      // used to argue the opposite — that the refusal is a 4xx, so the key it used
      // would replay it, so the next attempt needs a *new* key — and the ruling of
      // 2026-08-31 removed the premise rather than the conclusion: it is a 503 now, a
      // 5xx releases the key, and the same key is the one to reuse. The argument was
      // sound about a stored refusal and this is no longer one.
      //
      // The three disjuncts below are unreachable today, and not all for the same
      // reason. `requested_by` is frozen by `cell_leadership_request_is_final`, and
      // `cell_id`'s *nullness* is tied to `kind` by a check constraint while `kind` is
      // frozen — both enforced in the database. `cell_id`'s **value** on a PENDING
      // handover is frozen by nothing: it is unreached because no code writes it, which
      // is a weaker guarantee, and whether it should be frozen is on CLAUDE.md's open
      // list. They are checked because the *argument* is what goes stale, and a
      // revision path for a pending request would make the third live.
      //
      // **`RESOURCE_BUSY`, settled 2026-08-31.** Section 22 places a refusal by asking
      // whether this same body, resubmitted unchanged, could succeed. Here it could:
      // the body is a request identifier, and a second attempt rebuilds its lock list
      // from a fresh pre-read of the row as it now stands. So this reached no decision
      // about the request, and a 409 would have been stored against the key and
      // replayed for the retention — the client's own retry answered with the refusal
      // for a day.
      //
      // *The paragraph here previously argued the opposite, on section 22's then
      // definition of `RESOURCE_BUSY` as an elapsed wait or a deadlock victim, and it
      // was right that settling it in one module was not a fix batch's to do. Section
      // 22 now names a stale premise as a third condition, and `floorBreach` moved with
      // this.*
      //
      // **The advice moves with the status.** A 5xx releases the key, so the retry
      // reuses it; telling a client to mint a new one would send it to change a body it
      // has no reason to change.
      if (
        !sameId(request.requested_by, pre.requested_by) ||
        (request.cell_id === null) !== (pre.cell_id === null) ||
        (request.cell_id !== null && pre.cell_id !== null && !sameId(request.cell_id, pre.cell_id))
      ) {
        throw new ResourceBusyError(
          { request_id: request.id },
          'This request changed while it was being approved, so the locks it took no ' +
            'longer cover what it would write. Retry in a moment.',
        );
      }

      const decision = await this.assertApprovableWithin(trx, request, {
        actor,
        requester,
        requesterAuthority,
        outgoingBeforeLock,
      });

      // ------------------------------------------------------------------
      // The writes.
      // ------------------------------------------------------------------
      const applied =
        request.kind === 'NEW_CELL'
          ? await this.approveNewCellWithin(trx, request, actor)
          : await this.handOverWithin(trx, request, decision, actor);

      await trx
        .updateTable('cell_leadership_requests')
        .set({
          state: 'APPROVED',
          decided_by: actor.accountId,
          decided_at: applied.at,
          // "For NEW_CELL, null until approval sets it" (section 10), which
          // `..._new_cell_names_its_cell_at_approval` requires of an APPROVED row. A
          // handover already names its Cell and the value is unchanged.
          cell_id: applied.cellUuid,
        })
        .where('id', '=', request.id)
        .execute();

      // Section 21: "Cell leadership request approved, with the kind." The prospective
      // leader is the target, matching the submitted and declined entries, because a
      // reader asking how a leader was developed searches on the person.
      await this.audit.writeWithin(trx, {
        actorId: actor.accountId,
        action: 'cell_leadership_request.approved',
        targetType: 'person',
        targetId: request.prospective_leader_id,
        before: { request_id: request.id, state: 'PENDING' },
        after: {
          request_id: request.id,
          kind: request.kind,
          state: 'APPROVED',
          cell_id: applied.cellId,
          cell_uuid: applied.cellUuid,
        },
      });

      // **Section 21 lists this as an action in its own right**: "Cell leadership
      // assignment left with account provisioning pending". Section 10 requires it on
      // every approval of either kind, unconditionally — leading a Cell and holding an
      // account are not the same fact, and a current Cell Leader with the account step
      // still pending is exactly what direct creation and every earlier approval both
      // produce. The honest test is whether an Account exists, and `cells` may not ask
      // it: `auth` imports this module, so a read back would close the cycle section 2
      // keeps open.
      await this.audit.writeWithin(trx, {
        actorId: actor.accountId,
        action: 'cell_leadership.account_pending',
        targetType: 'person',
        targetId: request.prospective_leader_id,
        after: { cell_id: applied.cellId },
      });

      const response = {
        id: request.id,
        kind: request.kind,
        state: 'APPROVED',
        decided_at: applied.at.toISOString(),
        cell_id: applied.cellId,
        cell_uuid: applied.cellUuid,
        cell_leader_id: request.prospective_leader_id,
        // Null on a new Cell, which succeeds nobody. Section 21 asks a leadership
        // entry to carry "the outgoing and the incoming leader where each exists", and
        // the response says the same so a client need not read the log to render it.
        outgoing_cell_leader_id: applied.outgoingLeaderId,
      };

      // Last statement in the transaction, holding the key's row lock, and recording
      // exactly what the endpoint returns (CLAUDE.md, Write endpoints).
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
   * Section 10's revalidation, in full: "the state at approval governs, never the
   * state at request".
   *
   * **Both conditions are asked of the requester, not of the approver**, and asked
   * whole. Each is the question the request step itself asked —
   * `cell.request_leadership` over the prospective leader, `cell.manage_lifecycle`
   * over the Cell — put to the account in `requested_by`. Section 10 gives the reason
   * for the Cell: its leader may be pastorally reassigned while the request sits
   * pending, which carries it out of the requester's subtree, and approving anyway
   * completes a handover of a Cell they no longer oversee.
   *
   * **One refusal covers both halves, and which moved is not distinguished.** The
   * predicate is the whole of the requester's authority, so it answers no where the
   * person or the Cell moved out of reach and equally where the requester has since
   * lost the capability or the role carrying it. Account status is deliberately not
   * part of it — a disabled account keeps its roles and grants, because section 6
   * makes disablement an authentication decision, and consulting status here would be
   * a rule about what a grant means and so section 7's rather than this endpoint's.
   *
   * **"Had their Network changed" is not a condition of its own**, and section 10 now
   * says why: nothing records the prospective leader's Network at request time, so it
   * had no baseline and could not be evaluated. It needs none. A Network change forces
   * a pastoral reassignment into the new Network at the same instant (section 4) and
   * no pastoral edge crosses Networks (section 5), so the moved person leaves the
   * requester's subtree and the check below fires.
   *
   * A `NETWORK`-scoped grant catches it more directly still, comparing the person's
   * current Network against the granted one. `WHOLE_CHURCH` is the one value that
   * misses it, because `scopeCovers` is satisfied before the target is read.
   */
  private async assertApprovableWithin(
    trx: Transaction<Database>,
    request: PendingRequest,
    context: {
      actor: Actor;
      requester: Actor;
      requesterAuthority: ActorAuthority;
      outgoingBeforeLock: string | null;
    },
  ): Promise<{ outgoingLeaderId: string | null }> {
    const person = await this.people.forDecisionWithin(trx, request.prospective_leader_id);

    if (!person) {
      throw new InvariantViolationError('The person this request names no longer exists.', {
        person_id: request.prospective_leader_id,
      });
    }

    // The two refusals every path in this system makes about a target Person. Section
    // 10 names both here in terms: reject where they have since been absorbed by a
    // Merge or archived, "creating nothing" — without which approval would open an
    // active leadership assignment for an archived Person and proceed to provision
    // their credentials, the outcome section 3's archive guard exists to prevent.
    if (person.mergedIntoId !== null) {
      throw new InvariantViolationError(
        'That person was absorbed by a merge since this request was submitted. Decline it ' +
          'and submit one naming the surviving Person (SKILL.md section 10).',
        { person_id: request.prospective_leader_id },
      );
    }

    if (person.isArchived) {
      throw new InvariantViolationError(
        'That person has been archived since this request was submitted, so they cannot be ' +
          'given a Cell to lead. Restore them first, which is a separate and separately ' +
          'audited decision (SKILL.md section 10).',
        { person_id: request.prospective_leader_id },
      );
    }

    if (
      !(await this.authorization.coversWith(
        trx,
        context.requester,
        context.requesterAuthority,
        Capability.CellRequestLeadership,
        { kind: 'person', personId: request.prospective_leader_id },
      ))
    ) {
      throw new ScopeDeniedError(
        'The person this request names is no longer within the authorized subtree of the ' +
          'leader who requested it. Decline it; whoever now holds that pastoral ' +
          'relationship may submit another (SKILL.md section 10).',
        // **Whose authority failed, and it is not the caller's.** Section 22 splits its
        // two codes so an administrator knows which half to fix; without naming the
        // subject, an Admin reading `capability` here audits their own grants and finds
        // nothing wrong, because the refusal is about the requester's reach.
        {
          capability: Capability.CellRequestLeadership,
          subject: 'requester',
          requested_by: context.requester.accountId,
        },
      );
    }

    if (request.kind === 'NEW_CELL') {
      await this.assertNewCellNetworkWithin(trx, request.prospective_leader_id);
      return { outgoingLeaderId: null };
    }

    return {
      outgoingLeaderId: await this.assertHandoverApprovableWithin(trx, request, context),
    };
  }

  /**
   * Section 10: for a new Cell, "approval must also confirm that they and their
   * pastoral leader share a Network, because a Cell inherits its leader's Network and
   * Section 5 forbids a cross-Network edge."
   *
   * **Nothing can fail against this, and that is stated here rather than left for
   * somebody to find by deleting it.** `assert_assignment_same_network` makes a
   * cross-Network pastoral edge impossible on every write (section 5), so no operation
   * this system offers can produce the state this refuses. It is written anyway on the
   * reasoning `CellsReadService.isCurrentCellLeaderWithin` already records for its own
   * unfalsifiable half: the rule that makes the two agree is a **constraint trigger**,
   * and `pg_restore --disable-triggers` skips one — the argument this repository has
   * made twice before, for the Senior Pastor slot and the Network root seat.
   *
   * **A person with no pastoral leader is not refused**, because section 5 invariant 3
   * makes zero open assignments legitimate for three kinds of Person and section 10
   * asks only that leader and pastoral leader *share* a Network where there is one.
   * Refusing would invent a rule. A person with no **Network** row is a different
   * matter and is refused by `assert_leadership_stays_in_network` at commit, which is
   * the only state that leaves a Cell's Network underivable.
   */
  private async assertNewCellNetworkWithin(
    trx: Transaction<Database>,
    personId: string,
  ): Promise<void> {
    // **Through `hierarchy`, which owns `pastoral_assignments`** (section 2, Modules).
    // The first version selected from that table here, which section 2 permits for
    // exactly one shape -- "a read joined onto a query rooted in a table the reading
    // module owns" -- and this is a standalone read rooted in another module's table.
    // `openAssignmentOf` is the same query and already takes an executor; it is the
    // identical defect and remedy CLAUDE.md records for `attachExistingWithin`.
    const edge = await this.hierarchy.openAssignmentOf(trx, personId);

    if (!edge || edge.leaderId === null) {
      return;
    }

    const [personNetwork, leaderNetwork] = await Promise.all([
      this.networks.currentNetwork(trx, personId),
      this.networks.currentNetwork(trx, edge.leaderId),
    ]);

    if (personNetwork !== null && leaderNetwork !== null && personNetwork !== leaderNetwork) {
      throw new InvariantViolationError(
        'That person and their pastoral leader are in different Networks, so a Cell for ' +
          'them would inherit a Network its leader does not belong to (SKILL.md sections 5 ' +
          'and 10).',
        { person_id: personId },
      );
    }
  }

  /**
   * The Cell half of section 10's revalidation, for a handover.
   *
   * Four refusals, and section 10 states each: reject where the Cell has since been
   * closed; where the incoming leader and the Cell's current leader do not share a
   * Network; where the Cell's leader is now the person the request names, "since a
   * handover that changes nothing is refused"; and where the Cell has moved outside
   * the requester's authorized scope.
   *
   * Returns the outgoing leader, which the write and the audit entry both need.
   */
  private async assertHandoverApprovableWithin(
    trx: Transaction<Database>,
    request: PendingRequest,
    context: {
      requester: Actor;
      requesterAuthority: ActorAuthority;
      outgoingBeforeLock: string | null;
    },
  ): Promise<string> {
    const cell = await trx
      .selectFrom('cells')
      .select(['id', 'cell_id', 'state'])
      .where('id', '=', request.cell_id as string)
      .executeTakeFirst();

    if (!cell) {
      // Unreachable: `cell_leadership_requests.cell_id` references `cells`, and
      // migration 0009 refuses a DELETE on that table outright.
      throw new InvariantViolationError('The Cell this request names no longer exists.', {
        request_id: request.id,
      });
    }

    if (cell.state === 'CLOSED') {
      throw new InvariantViolationError(
        'That Cell has been closed since this request was submitted, so it cannot be handed ' +
          'to anyone. A closure is never reversed (SKILL.md section 10).',
        { cell_id: cell.cell_id },
      );
    }

    const outgoingLeaderId = await this.cells.leaderForScopeWithin(trx, cell.id);

    if (outgoingLeaderId === null) {
      throw new InvariantViolationError(
        'That Cell cannot be resolved to a leader, so there is no authority to check ' +
          'against (SKILL.md section 11).',
      );
    }

    // **The lock list was built from a pre-read, and this is what makes that safe
    // rather than assumed.** The outgoing leader can change only through an operation
    // that writes `cell_leaderships`, and there are four: a closure, which is refused
    // above by `state`; a `NEW_CELL` approval and direct creation during initial
    // encoding, which both go through `insert-cell.ts` and both write a *different*
    // Cell; and another handover approval, which needs a second PENDING handover for
    // this Cell and `..._one_pending_handover` permits only one. So this cannot differ.
    //
    // *Counted as three until the fourth pass: `insert-cell.ts` has two callers and
    // only one was named. The conclusion is unchanged, because the reason given for a
    // NEW_CELL approval — it writes a different Cell — is the same reason direct
    // creation does not matter.*
    //
    // Refused rather than trusted, because if it ever did the person whose Network is
    // about to be compared would be one this transaction never locked.
    if (context.outgoingBeforeLock === null) {
      // A Cell that had no leadership row when the lock list was built and has one
      // now. No operation produces it -- an `ACTIVE` Cell always has exactly one, and a
      // `CLOSED` one is refused above. Kept rather than removed because the alternative
      // is comparing a leader against nothing and proceeding to write against a person
      // this transaction never locked.
      //
      // *The message said "so there is nobody to hand it over from", which is false of
      // the only state that reaches this: `outgoingLeaderId` was read non-null four
      // lines above, so there is somebody -- they are simply somebody the lock list,
      // built before the transaction, does not cover.*
      //
      // `RESOURCE_BUSY` on section 22's placement question: the body is unchanged by
      // this refusal and a second attempt builds its lock list from what the Cell holds
      // then, so the same submission can succeed. A 5xx releases the key, so the retry
      // reuses it.
      throw new ResourceBusyError(
        { cell_id: cell.cell_id },
        'That Cell acquired its leadership assignment while this approval was starting, ' +
          'so the approval holds no lock on the leader it would hand over from. Retry ' +
          'in a moment (SKILL.md section 11).',
      );
    }

    if (!sameId(outgoingLeaderId, context.outgoingBeforeLock)) {
      // `RESOURCE_BUSY` for the reason the pre-read check gives: section 22 places a
      // refusal by whether this same body could succeed on a later attempt, and this
      // one could — the Cell has a leader, the lock list simply does not cover them,
      // and a second attempt builds it from the leader now in place.
      //
      // **Note what this is not.** A handover refused because the incoming leader
      // *already leads the Cell*, immediately below, is a decision about this request
      // and stays a 409: no retry of it can ever succeed.
      throw new ResourceBusyError(
        { cell_id: cell.cell_id },
        'This Cell changed hands while the approval was being made, so the leader it ' +
          'locked is no longer the one it would hand over from. Retry in a moment.',
      );
    }

    if (sameId(outgoingLeaderId, request.prospective_leader_id)) {
      // Section 10: "where the Cell's leader is now the person the request names,
      // since a handover that changes nothing is refused". The request step refuses
      // this too; it is reachable here because the Cell may have been handed to that
      // person in between.
      throw new InvariantViolationError(
        'That person already leads this Cell, so there is nothing to hand over ' +
          '(SKILL.md section 10).',
        { cell_id: cell.cell_id, person_id: request.prospective_leader_id },
      );
    }

    const [incomingNetwork, outgoingNetwork] = await Promise.all([
      this.networks.currentNetwork(trx, request.prospective_leader_id),
      this.networks.currentNetwork(trx, outgoingLeaderId),
    ]);

    if (incomingNetwork === null || incomingNetwork !== outgoingNetwork) {
      // `assert_leadership_stays_in_network` enforces this and raises at COMMIT as a
      // raw `check_violation`, which `ApiExceptionFilter` renders `INTERNAL_ERROR`.
      // The constraint stays the enforcement — it sees a Network change this
      // transaction's locks did not serialize — and this is what makes the ordinary
      // case an answer.
      throw new InvariantViolationError(
        'The incoming leader and this Cell’s current leader are in different Networks. ' +
          'A Cell takes its Network from its leader, and a Network is homogeneous ' +
          '(SKILL.md sections 4 and 10).',
        { cell_id: cell.cell_id },
      );
    }

    if (
      !(await this.authorization.coversWith(
        trx,
        context.requester,
        context.requesterAuthority,
        Capability.CellManageLifecycle,
        { kind: 'person', personId: outgoingLeaderId },
      ))
    ) {
      throw new ScopeDeniedError(
        'This Cell is no longer within the authorized scope of the leader who requested the ' +
          'handover. Decline it; whoever now oversees the Cell may submit another ' +
          '(SKILL.md section 10).',
        {
          capability: Capability.CellManageLifecycle,
          subject: 'requester',
          requested_by: context.requester.accountId,
        },
      );
    }

    return outgoingLeaderId;
  }

  /**
   * On approving a new Cell, in a single transaction (SKILL.md section 10): the Cell
   * as `ACTIVE` with a server-assigned Cell ID, its category row, its schedule row and
   * the leadership assignment.
   *
   * The statement is shared with `CellsService.createDirectly` rather than repeated —
   * `insert-cell.ts` carries why all four rows must come from one expression.
   */
  private async approveNewCellWithin(
    trx: Transaction<Database>,
    request: PendingRequest,
    actor: Actor,
  ): Promise<AppliedApproval> {
    const created = await insertCellWithin(
      trx,
      {
        cellLeaderId: request.prospective_leader_id,
        category: request.category as CellCategory,
        dayOfWeek: request.day_of_week as number,
        timeOfDay: request.time_of_day as string,
      },
      actor.accountId,
    );

    await this.audit.writeWithin(trx, {
      actorId: actor.accountId,
      action: 'cell.created',
      targetType: 'cell',
      targetId: created.id,
      after: {
        cell_id: created.cellId,
        state: 'ACTIVE',
        cell_leader_id: request.prospective_leader_id,
        category: request.category,
        day_of_week: request.day_of_week,
        time_of_day: request.time_of_day,
        // The counterpart of `created_during_initial_encoding` on the direct path:
        // this Cell came through request-and-approve, and the entry says which.
        approved_request_id: request.id,
      },
    });

    // Section 11 makes this a fact of its own rather than a detail of the Cell: it is
    // what makes the person a current Cell Leader, and section 16 counts New Cell
    // Leaders by when a leadership assignment starts.
    await this.audit.writeWithin(trx, {
      actorId: actor.accountId,
      action: 'cell_leadership.opened',
      // The Cell, on section 21's rule for all three leadership actions, and for the
      // reason given at the sibling site in `cells.service.ts`: section 7 resolves a
      // leadership through the Cell, so the entry resolves by the rule written for
      // what it is about. The incoming leader is in `after`.
      targetType: 'cell',
      targetId: created.id,
      after: {
        cell_id: created.cellId,
        cell_uuid: created.id,
        cell_leader_id: request.prospective_leader_id,
      },
    });

    return {
      at: created.createdAt,
      cellId: created.cellId,
      cellUuid: created.id,
      outgoingLeaderId: null,
    };
  }

  /**
   * On approving a handover, in a single transaction (SKILL.md section 10): "the
   * outgoing leadership assignment ends and the incoming one opens at the same
   * instant".
   *
   * **One statement, because the two instants must be identical and not merely close.**
   * `assert_leadership_stays_in_network` refuses the pair unless the predecessor's
   * `ended_at` equals this row's `started_at` exactly, and its own comment names the
   * cause of the near-miss: an approval that reads the clock twice. Taking the incoming
   * row's `started_at` from the closing row's `RETURNING` makes them one value.
   *
   * `clock_timestamp()` rather than `now()`, which is transaction start: these rows are
   * written after a lock wait of up to three seconds, and stamping them with the
   * instant the request arrived would place the handover before writes it followed.
   *
   * Section 11's exactly-one-leader rule is a **deferred** constraint trigger, which is
   * what lets the pair through: it sees only the state this transaction ends in, and in
   * between the Cell momentarily has none.
   */
  private async handOverWithin(
    trx: Transaction<Database>,
    request: PendingRequest,
    decision: { outgoingLeaderId: string | null },
    actor: Actor,
  ): Promise<AppliedApproval> {
    const cellUuid = request.cell_id as string;

    const moved = await sql<{ started_at: Date }>`
      WITH closed AS (
        UPDATE cell_leaderships
           SET ended_at = clock_timestamp()
         WHERE cell_id = ${cellUuid}::uuid
           AND ended_at IS NULL
        RETURNING ended_at
      )
      INSERT INTO cell_leaderships (person_id, cell_id, started_at)
      SELECT ${request.prospective_leader_id}::uuid, ${cellUuid}::uuid, ended_at FROM closed
      RETURNING started_at
    `.execute(trx);

    const opened = moved.rows[0];

    if (!opened) {
      // Unreachable through any operation: migration 0009 gives an `ACTIVE` Cell
      // exactly one open leadership, and the Cell was confirmed `ACTIVE` under a
      // `FOR SHARE` above. Refused rather than left to the deferred trigger, which
      // would raise `check_violation` at COMMIT and render `INTERNAL_ERROR`.
      throw new InvariantViolationError(
        'That Cell had no open leadership assignment to hand over (SKILL.md section 11).',
        { request_id: request.id },
      );
    }

    const cell = await trx
      .selectFrom('cells')
      .select('cell_id')
      .where('id', '=', cellUuid)
      .executeTakeFirstOrThrow();

    // Section 21: "Cell leadership opened, ended, or changed, carrying the outgoing and
    // the incoming leader where each exists — a reader asking who led a Cell before a
    // handover must find it here". One entry rather than an `ended` and an `opened`,
    // because a handover is one action and section 21 names `changed` for it.
    await this.audit.writeWithin(trx, {
      actorId: actor.accountId,
      action: 'cell_leadership.changed',
      targetType: 'cell',
      targetId: cellUuid,
      before: { cell_leader_id: decision.outgoingLeaderId },
      after: {
        cell_leader_id: request.prospective_leader_id,
        cell_id: cell.cell_id,
        changed_at: opened.started_at.toISOString(),
      },
    });

    return {
      at: opened.started_at,
      cellId: cell.cell_id,
      cellUuid,
      outgoingLeaderId: decision.outgoingLeaderId,
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
