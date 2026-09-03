import { Inject, Injectable } from '@nestjs/common';

import { type CellMeetingScopePort } from '../auth/authorization/cell-meeting-scope.port';
import { CellsReadService } from '../cells/cells.read.service';
import { isMonthOpen, reportingMonthOf } from '../common/time/submission-window';
import { DATABASE, type Db } from '../database/database.module';

import type { Database } from '../database/schema';
import type { Transaction } from 'kysely';

/**
 * `CELL_MEETING_SCOPE_PORT`. Where a Cell meeting sits in the pastoral tree, for the
 * guard (SKILL.md section 7; decisions 0186, 0187, 0188).
 *
 * **It exists because `auth` needs one question answered, not a table** — the same
 * reason `CellsReadService` exists one module over, re-derived rather than copied.
 * What the guard needs is a Person to resolve a scope against; what it must not
 * acquire is a dependency on the module that records attendance. So this class holds
 * one method, takes the connection and `cells`' read seam, and nothing else.
 *
 * **Deliberately not a method on `CellMeetingsService`.** That class carries the
 * submission rules, the audit writer and the idempotency service, and binding it to a
 * port would put all of that inside `auth`'s reachable surface for the sake of one
 * lookup. It is also the class this one must never grow into: a scope answer is not a
 * domain operation, and decision 0062 puts the guard's single target check here and
 * the rest of the work in the services.
 *
 * **The Cell half is asked of `cells`, and only the meeting half is answered here.**
 * `attendance` owns `cell_meetings`; `cells` owns `cells`, `cell_leaderships` and
 * `cell_schedules`. `attendance` already imports `CellsModule` and that direction is
 * not a cycle (section 2), so the lifecycle state, the current leader and the
 * leader-on-a-date all come from `CellsReadService` exactly as they did before this
 * port existed.
 */
@Injectable()
export class CellMeetingsScopeService implements CellMeetingScopePort {
  constructor(
    @Inject(DATABASE) private readonly db: Db,
    private readonly cells: CellsReadService,
  ) {}

  /**
   * `CellMeetingScopePort`. See the port for the rule; this is how it is answered.
   *
   * **The order of the three branches is the rule's own order and is not arbitrary.**
   * An ACTIVE Cell is decided before anything is read about the meeting, because
   * decision 0186 gives it the current leader whatever the meeting says — reading the
   * record first and preferring it would silently reverse that ruling, which is the
   * one mistake this method is placed to avoid. The window is decided before the
   * record for the same reason section 7 gives: once it shuts, the answer is nobody,
   * and a record that exists does not reopen it.
   *
   * **On the pool, because the guard runs outside any transaction.** A domain check
   * inside one resolves its own leader from the transaction it is already in.
   */
  async leaderForMeetingScope(cellId: string, on: string): Promise<string | null> {
    return this.leaderForMeetingScopeWithin(this.db, cellId, on);
  }

  /**
   * The same resolution, on a caller's executor.
   *
   * **It exists because a domain check must reach the answer the guard reached**, and
   * the guard's is taken on the pool outside any transaction. `CellMeetingsService`
   * checks `cell.correct_subtree` against the meeting inside its own transaction, and a
   * check resolving the meeting a *second* way is a check that can disagree with the
   * one that admitted the request — which is exactly the defect this method was added to
   * remove: `assertMayCorrect` resolved against the frozen leader unconditionally, so on
   * an `ACTIVE` Cell that had changed hands the current leader was refused a correction
   * section 7 gives them, and the former leader was refused by the guard. Neither could
   * correct it.
   *
   * The pair is `CellsReadService`'s `leaderForScope` / `leaderForScopeWithin` shape,
   * and for its reason: the port answers on the pool because the guard runs outside a
   * transaction, and a domain check inside one asks the `Within` form so it reads what
   * its own transaction can see.
   */
  async leaderForMeetingScopeWithin(
    executor: Db | Transaction<Database>,
    cellId: string,
    on: string,
  ): Promise<string | null> {
    const cell = await this.cells.cellById(executor, cellId);
    if (cell === null) {
      return null;
    }

    if (cell.state !== 'CLOSED') {
      return this.cells.leaderForScopeWithin(executor, cellId);
    }

    if (!(await isMonthOpen(executor, reportingMonthOf(on)))) {
      return null;
    }

    // **Decision 0188: the record carries the answer where one exists.** Keyed on the
    // scheduled date, which section 13 makes the meeting's identity and which is what
    // the path names — so a rescheduled meeting is found by the same key that
    // addresses it, and `actual_date` never enters the lookup.
    //
    // `responsible_leader_id` is `NOT NULL` on this table (migration 0011), so a row
    // that exists always answers and the `??` below cannot mask a null column. It is
    // written to guard against the row being absent, which `executeTakeFirst` reports
    // as `undefined`.
    const recorded = await executor
      .selectFrom('cell_meetings')
      .select('responsible_leader_id')
      .where('cell_id', '=', cellId)
      .where('scheduled_date', '=', on)
      .executeTakeFirst();

    if (recorded !== undefined) {
      return recorded.responsible_leader_id;
    }

    // No record yet, so there is nothing frozen to read and the scheduled date is the
    // only thing that can answer. This is the closed-Cell *recording* path — a leader
    // filing a meeting their Cell held before it closed — and it is unchanged by 0188.
    return this.cells.leaderOnDateWithin(executor, cellId, on);
  }
}
