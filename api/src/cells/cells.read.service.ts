import { Inject, Injectable } from '@nestjs/common';

import { DATABASE, type Db } from '../database/database.module';

import type { Database } from '../database/schema';
import type { Transaction } from 'kysely';

/**
 * The reads other modules need of `cells`, and nothing wider.
 *
 * **It exists because `auth` needs one question answered, not a table.** Section 6
 * provisions a `LEADER` account together with the Cell leadership that qualifies
 * it, and section 11 defines that qualification exactly: "a person is a current
 * Cell Leader when they have at least one active Cell leadership assignment on an
 * `ACTIVE` Cell". Section 2 gives `cell_leaderships` and `cells` to this module, so
 * `auth` asks rather than joins.
 *
 * The seam is `AuthorizationModule`'s, re-derived rather than copied: what `auth`
 * needs is a question, and importing a module of creation and closure operations to
 * ask it would put the whole of `cells` into `auth`'s surface. The graph runs
 * `auth -> cells -> {people, networks, authorization, admin/settings, audit}` with
 * nothing pointing back, because this module never imports `auth`.
 */
@Injectable()
export class CellsReadService {
  constructor(@Inject(DATABASE) private readonly db: Db) {}

  /**
   * `CellScopePort`. The Person a Cell's scope resolves through (SKILL.md section
   * 7): its current leader, falling back to its last leader where the Cell is
   * closed.
   *
   * **The fallback is section 7's, with section 7's reason**: a closed Cell keeps
   * its history and its roster visible to the leader who led it (sections 10 and
   * 15), and resolving through a current leader it no longer has would take that
   * away exactly when the record becomes historical. Migration 0009 makes a CLOSED
   * Cell hold no open leadership, so the fallback is the only thing that answers
   * for one.
   *
   * **What implements the fallback is the absence of a filter, not the ordering** —
   * and two earlier versions of this sentence each credited a sort key. There is no
   * `ended_at IS NULL` here, which is why a closed Cell resolves at all; adding one
   * is the mutation that reddens the closed-Cell case.
   *
   * Of the three keys, `started_at DESC` does the work: leadership is contiguous
   * (migration 0009), so the latest-starting row is the open one on an `ACTIVE` Cell
   * and the last leader on a `CLOSED` one. `ended_at DESC NULLS FIRST` decides only
   * where two rows share a `started_at` — the pair a section 5 correction leaves,
   * closing a row at its own start and opening the right one at the same instant —
   * and picks the one still in force. `id DESC` decides only where both dates match.
   *
   * **The keys are in that order in the SQL, and for two versions they were not.**
   * The query read `ended_at DESC NULLS FIRST` first while this paragraph described
   * `started_at` as primary — no divergence in any state migration 0009 permits, but
   * a paragraph a future reader would reorder keys against, saying the reverse of the
   * query beneath it. Migration 0009's own predecessor query
   * (`assert_leadership_stays_in_network`) uses these three in this order, so the
   * two now agree in the code as well as in the reasoning.
   *
   * On the pool, because the guard runs outside any transaction. A domain check
   * inside one asks `leaderForScopeWithin` instead.
   */
  async leaderForScope(cellId: string): Promise<string | null> {
    return this.leaderForScopeWithin(this.db, cellId);
  }

  async leaderForScopeWithin(
    executor: Db | Transaction<Database>,
    cellId: string,
  ): Promise<string | null> {
    const row = await executor
      .selectFrom('cell_leaderships')
      .select('person_id')
      .where('cell_id', '=', cellId)
      .orderBy('started_at', 'desc')
      .orderBy('ended_at', (ob) => ob.desc().nullsFirst())
      .orderBy('id', 'desc')
      .executeTakeFirst();

    return row?.person_id ?? null;
  }

  /**
   * Whether this Person is a current Cell Leader (SKILL.md section 11).
   *
   * **Both halves, and the second cannot be shown to matter — which is stated here
   * rather than left for somebody to discover by deleting it.** Section 11 defines
   * the qualification as an active leadership assignment *on an `ACTIVE` Cell*, so
   * the join follows the section. But migration 0009 refuses a CLOSED Cell that
   * still holds an open assignment, so the state where the two disagree is
   * unreachable through any operation: no test can redden against dropping the
   * `cells.state` filter, and a first attempt at one pinned neither half, because
   * closing a Cell ends its leadership and either condition then sufficed alone.
   *
   * It is kept for a reason that survives being unfalsifiable. The rule making the
   * two agree is a **constraint trigger**, and `pg_restore --disable-triggers`
   * skips one — the argument this repository has already made twice, for the Senior
   * Pastor slot and the Network root seat. After a restore the two can disagree,
   * and this join is what would refuse an account for a leader whose Cell is
   * closed. Writing the conjunction section 11 states costs one line and does not
   * depend on a trigger having run.
   *
   * The open-assignment half **is** pinned, by a handover: the Cell stays `ACTIVE`
   * and the outgoing assignment closes, which is the state that separates them.
   *
   * Takes an executor rather than fixing one, the pattern `HierarchyService` and
   * `SettingsService` use: provisioning asks inside its own transaction, where a
   * pooled read would answer from the state the request arrived with and would ask
   * a bounded pool for a second connection (section 24).
   */
  async isCurrentCellLeaderWithin(
    executor: Db | Transaction<Database>,
    personId: string,
  ): Promise<boolean> {
    const row = await executor
      .selectFrom('cell_leaderships')
      .innerJoin('cells', 'cells.id', 'cell_leaderships.cell_id')
      .select('cell_leaderships.id')
      .where('cell_leaderships.person_id', '=', personId)
      .where('cell_leaderships.ended_at', 'is', null)
      .where('cells.state', '=', 'ACTIVE')
      .executeTakeFirst();

    return row !== undefined;
  }
}
