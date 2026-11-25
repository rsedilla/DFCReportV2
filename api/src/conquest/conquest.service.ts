import { Inject, Injectable } from '@nestjs/common';

import { AuthorizationService, type Actor } from '../auth/authorization/authorization.service';
import { Capability } from '../auth/authorization/capabilities';
import { CellsReadService } from '../cells/cells.read.service';
import { growthPage, growthPopulation, listPopulation } from '../common/growth/growth-list';
import { uniqueIds } from '../common/growth/growth-submit';
import { resolverOf } from '../common/merged-identity';
import { NotFoundError, ScopeDeniedError, ValidationFailedError } from '../common/errors/api-error';
import { canonicalId } from '../common/identifiers';
import { manilaDayOf } from '../common/time/manila';
import { databaseNow } from '../common/time/submission-window';
import { DATABASE, type Db } from '../database/database.module';
import { HierarchyService } from '../hierarchy/hierarchy.service';
import { PeopleReadService } from '../people/people.read.service';
import { composeName } from '../people/people.shared';
import { SuynlService } from '../suynl/suynl.service';

import { countedAt, earliestReached, overlap, period, type Period } from './conquest-derivation';

import type { ConquestBranchesDto, ConquestGoalName, ConquestListDto } from './dto/conquest.dto';

/** One goal for one person: when it was first reached, and where it stands now. */
interface Goal {
  reachedAt: Date | null;
  /** Today's count toward it; Open a cell has none. */
  now: number | null;
}

type Goals = Record<ConquestGoalName, Goal>;

const TARGETS = { WIN_3: 3, COMPLETION_OF_12: 12, RAISE_12_LEADERS: 12 } as const;

/**
 * The Conquest page, read-only (SKILL.md section 27; decisions 0283 to 0286).
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

  /**
   * **Win 3 for each person, as this tab derives it** (section 27, decision 0250), for the
   * school's SOL 1 requirement (section 29, decisions 0501 and 0514): whether it has been
   * reached, which stays reached, and nothing else. How many of their disciples stand at a third
   * SUYNL lesson is not handed out: the Registrar is told the rule and never the count, which
   * this tab shows to holders of `conquest.view_subtree` (owner ruling of 2026-11-25, decision
   * 0514 point 5). Read as things stand now, as a requirement is read once, at registration
   * (point 18). Keyed by the canonical id asked about; no scope narrows it, the school's guard
   * deciding who asks.
   */
  async win3Of(personIds: readonly string[]): Promise<Map<string, { reached: boolean }>> {
    const ids = uniqueIds(personIds.map((id) => canonicalId(id)));
    const now = await databaseNow(this.db);
    const goals = await this.goalsOf(ids, now);
    return new Map(
      ids.map((id) => [id, { reached: (goals.get(id)?.WIN_3?.reachedAt ?? null) !== null }]),
    );
  }

  /** `GET /api/v1/conquest/counts`: the four cards, as things stand now. */
  async counts(actor: Actor): Promise<Record<string, unknown>> {
    const { people: population } = await growthPopulation(
      this.deps,
      actor,
      Capability.ConquestViewSubtree,
    );
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
    const population = listPopulation(
      await growthPopulation(this.deps, actor, Capability.ConquestViewSubtree),
      query,
    );
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

  /**
   * `GET /api/v1/conquest/branches`: the Senior Pastors' tables (decision 0494). Without a
   * leader, one table per root of the Network asked, or of both, ordered Men's first: one row
   * per direct disciple of the root, the root's own row, the Network's total and *Others*, which
   * holds whoever in the Network the rows and the roots leave out, so the table adds up to the
   * total. With a leader, that leader's one table, their branch being the total.
   *
   * **Whole Church only**: a grant over a Network or a branch is refused, so a Network Admin
   * keeps the list. A branch is the leader and everyone beneath them in the tree as it stands
   * now, read as every Conquest figure is (decision 0278), and its counts are the current
   * people in it and those of them who have reached each goal.
   */
  async branches(actor: Actor, query: ConquestBranchesDto): Promise<Record<string, unknown>> {
    if ((await this.authorization.wideReachOf(actor, Capability.ConquestViewSubtree)) !== null) {
      throw new ScopeDeniedError('These tables are read across the whole church only.', {});
    }

    const now = await databaseNow(this.db);
    const reached = await this.reachedBy(null, now);
    const figures = async (people: ReadonlySet<string> | null) => {
      const count = (goal: ConquestGoalName) =>
        people === null
          ? reached[goal].size
          : [...reached[goal]].filter((id) => people.has(id)).length;
      return {
        people: await this.people.countCurrent(people),
        win_3: count('WIN_3'),
        open_a_cell: count('OPEN_A_CELL'),
        completion_of_12: count('COMPLETION_OF_12'),
        raise_12_leaders: count('RAISE_12_LEADERS'),
      };
    };
    const branchOf = async (personId: string) =>
      new Set((await this.hierarchy.subtreeOf(this.db, personId)).map(canonicalId));

    let owners: { personId: string; network: string | null }[];
    let total: Awaited<ReturnType<typeof figures>>;
    let network: 'MENS' | 'WOMENS' | null = null;

    if (query.leader_id !== undefined && query.network !== undefined) {
      // A leader's 12 is their branch whatever the Network; a network sent with it would be
      // accepted and ignored, which section 22 refuses.
      throw new ValidationFailedError('Send a leader or a network, not both.', {
        field: 'network',
      });
    }

    if (query.leader_id !== undefined) {
      const leaderId = canonicalId(query.leader_id);
      // A record merged into another is not somebody of their own (section 3, decision 0408).
      const found = keyed(await this.people.forDecisions([leaderId])).get(leaderId);
      if (found === undefined || found.mergedIntoId !== null) {
        throw new NotFoundError('That person is not recorded.', { field: 'leader_id' });
      }
      owners = [{ personId: leaderId, network: null }];
      total = await figures(await branchOf(leaderId));
    } else {
      network = query.network ?? null;
      owners = (await this.hierarchy.rootSeatsAsOf(this.db, now))
        .filter((seat) => network === null || seat.network === network)
        .sort((left, right) =>
          left.network === right.network ? 0 : left.network === 'MENS' ? -1 : 1,
        )
        .map((seat) => ({ personId: canonicalId(seat.personId), network: seat.network }));
      total = await figures(
        network === null
          ? null
          : new Set([...(await this.people.whoseNetworkIsNow(network))].map(canonicalId)),
      );
    }

    type Figures = Awaited<ReturnType<typeof figures>>;
    const tables: {
      owner: { personId: string; network: string | null };
      rows: { personId: string; branch: number; figures: Figures }[];
      own: Figures;
    }[] = [];
    for (const owner of owners) {
      const disciples = (await this.hierarchy.directChildrenOf(owner.personId)).map(canonicalId);
      const rows = [];
      for (const disciple of disciples) {
        const branch = await branchOf(disciple);
        rows.push({ personId: disciple, branch: branch.size, figures: await figures(branch) });
      }
      tables.push({ owner, rows, own: await figures(new Set([owner.personId])) });
    }

    const ids = tables.flatMap((table) => [
      table.owner.personId,
      ...table.rows.map((row) => row.personId),
    ]);
    const names = keyed(await this.people.namesOf(ids));
    const goals = await this.goalsOf(ids, now);
    const person = (id: string) => {
      const name = names.get(id);
      return {
        id,
        full_name: name?.fullName ?? null,
        first_name: name?.firstName ?? null,
        last_name: name?.lastName ?? null,
      };
    };
    const goalsOfPerson = (id: string) => {
      const own = goals.get(id) as Goals;
      return {
        win_3: shape(own.WIN_3),
        open_a_cell: shape(own.OPEN_A_CELL),
        completion_of_12: shape(own.COMPLETION_OF_12),
        raise_12_leaders: shape(own.RAISE_12_LEADERS),
      };
    };
    const byName = (left: string, right: string) => {
      const a = names.get(left);
      const b = names.get(right);
      return (
        (a?.firstName ?? '').localeCompare(b?.firstName ?? '') ||
        (a?.lastName ?? '').localeCompare(b?.lastName ?? '') ||
        left.localeCompare(right)
      );
    };

    // Whoever the rows and the owners leave out of the total, shown by the screen where not 0.
    const keys = [
      'people',
      'win_3',
      'open_a_cell',
      'completion_of_12',
      'raise_12_leaders',
    ] as const;
    const others = Object.fromEntries(
      keys.map((key) => [
        key,
        total[key] -
          tables.reduce(
            (sum, table) =>
              sum + table.own[key] + table.rows.reduce((inner, row) => inner + row.figures[key], 0),
            0,
          ),
      ]),
    );

    return {
      network,
      total,
      tables: tables.map((table) => ({
        root: person(table.owner.personId),
        network: table.owner.network,
        rows: [...table.rows]
          .sort((left, right) => byName(left.personId, right.personId))
          .map((row) => ({
            leader: person(row.personId),
            has_disciples: row.branch > 1,
            goals: goalsOfPerson(row.personId),
            ...row.figures,
          })),
        own: { goals: goalsOfPerson(table.owner.personId), ...table.own },
      })),
      others,
    };
  }

  /**
   * The current people in the population who have reached each goal, leaving out anyone
   * outside the pastoral tree, as the list does (decision 0339).
   */
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

    // Only somebody who has had a disciple or opened a Cell can have reached a goal. A record
    // merged into one in the population is reached too, its history counting for the record
    // kept (decision 0408).
    const pairs = await this.people.mergedPairsWithin(this.db);
    const resolve = resolverOf(pairs);
    const scope =
      population === null
        ? null
        : [
            ...population,
            ...pairs.absorbed.filter((_, index) => population.has(canonicalId(pairs.kept[index]))),
          ];
    const edges = await this.hierarchy.edgeHistoryOf(this.db, scope);
    const openers = [...(await this.cells.openingsOf(scope)).keys()];

    // Every leader and opener is inside the scope, so the edges just read are all theirs.
    const goals = await this.goalsOf(
      uniqueIds([...edges.map((edge) => edge.leaderId), ...openers].map(resolve)),
      now,
      edges,
      population === null,
    );
    const identities = keyed(await this.people.forDecisions([...goals.keys()]));
    const listed = population === null ? null : new Set([...population].map(canonicalId));
    const outside = await this.people.outsideTreeAt(this.db, now);

    for (const [personId, own] of goals) {
      const identity = identities.get(personId);
      if (identity === undefined || identity.isArchived || identity.mergedIntoId !== null) {
        continue;
      }
      if (outside.has(personId)) {
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

  /**
   * The four goals of each of these people, keyed by canonical id. `known` is every edge
   * under them already read by the caller, so the history is not read twice. `everyone`
   * reads the lessons, leaderships and openings of the whole church rather than sending
   * every disciple's id: rows nobody asked about are never looked up, and a list that long
   * costs more to send than the queries cost to run (checklist row perf-conquest).
   */
  private async goalsOf(
    personIds: readonly string[],
    now: Date,
    known?: Awaited<ReturnType<HierarchyService['edgeHistoryOf']>>,
    everyone = false,
  ): Promise<Map<string, Goals>> {
    const result = new Map<string, Goals>();
    if (personIds.length === 0) {
      return result;
    }

    // **A merged pair is one person** (section 3, decision 0408): every leader, disciple,
    // leadership and opening resolves to the record kept, so two records of one disciple are
    // one of the twelve, and the earlier of two dates stands.
    const pairs = await this.people.mergedPairsWithin(this.db);
    const resolve = (id: string) => canonicalId(resolverOf(pairs)(id));
    const absorbedOf = (ids: readonly string[]) => {
      const wanted = new Set(ids.map(canonicalId));
      return pairs.absorbed.filter((_, index) => wanted.has(canonicalId(pairs.kept[index])));
    };
    const records = [...personIds, ...absorbedOf(personIds)];

    const asked = new Set(personIds.map(resolve));
    const edges =
      known === undefined
        ? await this.hierarchy.edgeHistoryOf(this.db, records)
        : known.filter((edge) => asked.has(resolve(edge.leaderId)));
    const discipleIds = uniqueIds(edges.map((edge) => edge.personId));
    const disciples = everyone ? null : uniqueIds(discipleIds.map(resolve));
    const thirdLessons = keyed(await this.suynl.thirdLessonInstantsOf(disciples));
    const leading = new Map<string, Period[]>();
    for (const entry of await this.cells.leadershipPeriodsOf(
      everyone ? null : [...discipleIds, ...absorbedOf(discipleIds)],
    )) {
      const key = resolve(entry.personId);
      leading.set(key, [...(leading.get(key) ?? []), period(entry.startedAt, entry.endedAt)]);
    }
    const openings = new Map<string, Date>();
    for (const [personId, openedAt] of await this.cells.openingsOf(everyone ? null : records)) {
      const key = resolve(personId);
      const seen = openings.get(key);
      if (seen === undefined || openedAt < seen) {
        openings.set(key, openedAt);
      }
    }
    const byLeader = new Map<string, typeof edges>();
    for (const edge of edges) {
      const key = resolve(edge.leaderId);
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
        const disciple = resolve(edge.personId);
        if (disciple === key) {
          // One record of the pair once placed under the other carries no discipleship.
          continue;
        }
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
