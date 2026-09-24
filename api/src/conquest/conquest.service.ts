import { Inject, Injectable } from '@nestjs/common';

import { AuthorizationService, type Actor } from '../auth/authorization/authorization.service';
import { Capability } from '../auth/authorization/capabilities';
import { CellsReadService } from '../cells/cells.read.service';
import { growthPage, growthPopulation } from '../common/growth/growth-list';
import { canonicalId } from '../common/identifiers';
import { manilaDayOf } from '../common/time/manila';
import { databaseNow } from '../common/time/submission-window';
import { DATABASE, type Db } from '../database/database.module';
import { HierarchyService } from '../hierarchy/hierarchy.service';
import { PeopleReadService } from '../people/people.read.service';
import { composeName } from '../people/people.shared';
import { SuynlService } from '../suynl/suynl.service';

import { countedAt, earliestReached, overlap, period, type Period } from './conquest-derivation';

import type { ConquestGoalName, ConquestListDto } from './dto/conquest.dto';

/** One goal for one person: when it was first reached, and where it stands now. */
interface Goal {
  reachedAt: Date | null;
  /** Today's count toward it; Open a cell has none. */
  now: number | null;
}

type Goals = Record<ConquestGoalName, Goal>;

const TARGETS = { WIN_3: 3, COMPLETION_OF_12: 12, RAISE_12_LEADERS: 12 } as const;

/**
 * The Conquest tab, read-only (SKILL.md section 27; decisions 0283 to 0286).
 *
 * **All four goals are derived, and nothing is stored.** `hierarchy` gives the dated
 * discipling edges, `cells` the Cell leaderships and openings, `suynl` each person's third
 * lesson, and this module composes them (section 2). Confirmations of goals reached before
 * encoding have no route yet, so none is read.
 */
@Injectable()
export class ConquestService {
  constructor(
    @Inject(DATABASE) private readonly db: Db,
    private readonly hierarchy: HierarchyService,
    private readonly cells: CellsReadService,
    private readonly suynl: SuynlService,
    private readonly people: PeopleReadService,
    private readonly authorization: AuthorizationService,
  ) {}

  private get deps() {
    return { authorization: this.authorization, hierarchy: this.hierarchy, people: this.people };
  }

  /** `GET /api/v1/conquest/counts`: the four cards, as things stand now. */
  async counts(actor: Actor): Promise<Record<string, unknown>> {
    const population = await growthPopulation(this.deps, actor, Capability.ConquestViewSubtree);
    const now = await databaseNow(this.db);
    const reached = await this.reachedBy(population, now);

    return {
      people: await this.people.countCurrent(population),
      win_3: reached.WIN_3.size,
      open_a_cell: reached.OPEN_A_CELL.size,
      completion_of_12: reached.COMPLETION_OF_12.size,
      raise_12_leaders: reached.RAISE_12_LEADERS.size,
    };
  }

  /** `GET /api/v1/conquest/people`: the tab's list, one page. */
  async list(actor: Actor, query: ConquestListDto): Promise<Record<string, unknown>> {
    const now = await databaseNow(this.db);
    const population = await growthPopulation(this.deps, actor, Capability.ConquestViewSubtree);
    const include =
      query.goal === undefined ? undefined : (await this.reachedBy(population, now))[query.goal];

    const { rows, nextCursor } = await growthPage(
      this.deps,
      this.db,
      actor,
      population,
      query,
      { include },
      now,
    );

    const goals = await this.goalsOf(
      rows.map((row) => row.id),
      now,
    );

    return {
      data: rows.map((row) => {
        const own = goals.get(canonicalId(row.id)) as Goals;

        return {
          person_id: row.id,
          member_id: row.member_id,
          full_name: composeName(row),
          goals: {
            win_3: shape(own.WIN_3),
            open_a_cell: shape(own.OPEN_A_CELL),
            completion_of_12: shape(own.COMPLETION_OF_12),
            raise_12_leaders: shape(own.RAISE_12_LEADERS),
          },
        };
      }),
      next_cursor: nextCursor,
    };
  }

  /** The current people in the population who have reached each goal. */
  private async reachedBy(
    population: ReadonlySet<string> | null,
    now: Date,
  ): Promise<Record<ConquestGoalName, ReadonlySet<string>>> {
    const empty = {
      WIN_3: new Set<string>(),
      OPEN_A_CELL: new Set<string>(),
      COMPLETION_OF_12: new Set<string>(),
      RAISE_12_LEADERS: new Set<string>(),
    };

    if (population !== null && population.size === 0) {
      return empty;
    }

    // Only somebody who has had a disciple or opened a Cell can have reached a goal.
    const scope = population === null ? null : [...population];
    const leaders = (await this.hierarchy.edgeHistoryOf(this.db, scope)).map(
      (edge) => edge.leaderId,
    );
    const openers = [...(await this.cells.openingsOf(scope)).keys()];

    const goals = await this.goalsOf(unique([...leaders, ...openers]), now);
    const identities = keyed(await this.people.forDecisions([...goals.keys()]));
    const listed = population === null ? null : new Set([...population].map(canonicalId));

    for (const [personId, own] of goals) {
      const identity = identities.get(personId);
      if (identity === undefined || identity.isArchived || identity.mergedIntoId !== null) {
        continue;
      }
      if (listed !== null && !listed.has(personId)) {
        continue;
      }
      for (const goal of Object.keys(empty) as ConquestGoalName[]) {
        if (own[goal].reachedAt !== null) {
          empty[goal].add(personId);
        }
      }
    }

    return empty;
  }

  /** The four goals of each of these people, keyed by canonical id. */
  private async goalsOf(personIds: readonly string[], now: Date): Promise<Map<string, Goals>> {
    const result = new Map<string, Goals>();
    if (personIds.length === 0) {
      return result;
    }

    const edges = await this.hierarchy.edgeHistoryOf(this.db, personIds);
    const disciples = unique(edges.map((edge) => edge.personId));
    const thirdLessons = keyed(await this.suynl.thirdLessonInstantsOf(disciples));
    const leading = new Map<string, Period[]>();
    for (const entry of await this.cells.leadershipPeriodsOf(disciples)) {
      const key = canonicalId(entry.personId);
      leading.set(key, [...(leading.get(key) ?? []), period(entry.startedAt, entry.endedAt)]);
    }
    const openings = keyed(await this.cells.openingsOf(personIds));
    const byLeader = new Map<string, typeof edges>();
    for (const edge of edges) {
      const key = canonicalId(edge.leaderId);
      byLeader.set(key, [...(byLeader.get(key) ?? []), edge]);
    }
    const at = now.getTime();

    for (const personId of personIds) {
      const key = canonicalId(personId);
      const own = byLeader.get(key) ?? [];

      const completion = new Map<string, Period[]>();
      const win = new Map<string, Period[]>();
      const raise = new Map<string, Period[]>();

      for (const edge of own) {
        const disciple = canonicalId(edge.personId);
        const held = period(edge.startedAt, edge.endedAt);
        add(completion, disciple, [held]);

        const third = thirdLessons.get(disciple);
        if (third !== undefined) {
          add(win, disciple, [overlap(held, period(third, null))]);
        }

        add(
          raise,
          disciple,
          (leading.get(disciple) ?? []).map((leadership) => overlap(held, leadership)),
        );
      }

      result.set(key, {
        WIN_3: dated(win, TARGETS.WIN_3, at),
        OPEN_A_CELL: { reachedAt: notAfter(openings.get(key) ?? null, at), now: null },
        COMPLETION_OF_12: dated(completion, TARGETS.COMPLETION_OF_12, at),
        RAISE_12_LEADERS: dated(raise, TARGETS.RAISE_12_LEADERS, at),
      });
    }

    return result;
  }
}

function dated(periods: ReadonlyMap<string, readonly Period[]>, target: number, at: number): Goal {
  const reached = earliestReached(periods, target);
  return {
    // `now` is read before the other statements, so a row committed while they run is
    // left out rather than dated after the moment the request asks about.
    reachedAt: reached === null || reached > at ? null : new Date(reached),
    now: countedAt(periods, at),
  };
}

function notAfter(instant: Date | null, at: number): Date | null {
  return instant === null || instant.getTime() > at ? null : instant;
}

function shape(goal: Goal): Record<string, unknown> {
  return {
    reached_on: goal.reachedAt === null ? null : manilaDayOf(goal.reachedAt),
    ...(goal.now === null ? {} : { now: goal.now }),
  };
}

function add(target: Map<string, Period[]>, key: string, periods: (Period | null)[]): void {
  const present = periods.filter((entry): entry is Period => entry !== null);
  if (present.length > 0) {
    target.set(key, [...(target.get(key) ?? []), ...present]);
  }
}

function keyed<T>(map: ReadonlyMap<string, T>): Map<string, T> {
  return new Map([...map].map(([key, value]) => [canonicalId(key), value]));
}

function unique(ids: readonly string[]): string[] {
  return [...new Map(ids.map((id) => [canonicalId(id), id])).values()];
}
