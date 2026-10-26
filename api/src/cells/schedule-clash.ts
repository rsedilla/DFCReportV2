import { sql } from 'kysely';

import {
  type Actor,
  type ActorAuthority,
  type AuthorizationService,
} from '../auth/authorization/authorization.service';
import { Capability } from '../auth/authorization/capabilities';
import { InvariantViolationError } from '../common/errors/api-error';
import { sameId } from '../common/identifiers';

import type { Db } from '../database/database.module';
import type { CellCategory, Database } from '../database/schema';
import type { Transaction } from 'kysely';

/**
 * The least distance between the starts of two Cells one person leads (SKILL.md section
 * 10, decision 0392). Two hours exactly is allowed.
 */
export const MINIMUM_GAP_SECONDS = 2 * 60 * 60;

const SECONDS_IN_A_WEEK = 7 * 24 * 60 * 60;

/** A day of the week (ISO, 1 is Monday) and a Manila wall-clock time, as a schedule holds them. */
export interface Slot {
  dayOfWeek: number;
  timeOfDay: string;
}

/** What a slot clashes with, as the refusal names it. */
export interface Clash {
  /** `CELL` for a running Cell, `REQUEST` for a pending new-Cell request or restart. */
  source: 'CELL' | 'REQUEST';
  /** The `CELL-000000` handle, for a Cell or a pending handover; null for a new-Cell request. */
  cell_id: string | null;
  category: CellCategory | null;
  day_of_week: number;
  time_of_day: string;
}

/**
 * Seconds from Monday 00:00 (section 20's Manila wall clock), so that distance can wrap. In
 * seconds rather than minutes, because a time may carry them and 12:00:59 to 14:00 is less
 * than two hours.
 */
function secondOfWeek(slot: Slot): number {
  const [hours = 0, minutes = 0, seconds = 0] = slot.timeOfDay.split(':').map(Number);
  return (slot.dayOfWeek - 1) * 24 * 60 * 60 + hours * 60 * 60 + minutes * 60 + seconds;
}

/** How far apart two starts are, the shorter way around the week, in seconds. */
function secondsApart(a: Slot, b: Slot): number {
  const apart = Math.abs(secondOfWeek(a) - secondOfWeek(b));
  return Math.min(apart, SECONDS_IN_A_WEEK - apart);
}

/**
 * Whether two starts are less than two hours apart, measured around the week, so Saturday
 * 23:00 and Sunday 00:30 clash, and so do Sunday 23:30 and Monday 00:30 (decision 0392).
 */
export function slotsClash(a: Slot, b: Slot): boolean {
  return secondsApart(a, b) < MINIMUM_GAP_SECONDS;
}

/** `HH:MM`, or `HH:MM:SS` where the seconds are not zero, so a gap read to the second shows. */
function hhmm(timeOfDay: string): string {
  const seconds = timeOfDay.slice(6, 8);
  return seconds === '' || seconds === '00' ? timeOfDay.slice(0, 5) : timeOfDay.slice(0, 8);
}

/**
 * Every schedule row of a Cell that is not over: the one in force and a change waiting for
 * next month (section 10, Schedule changes). A zero-length row, a pending change corrected
 * by a second one, was never in force and is left out.
 */
export async function slotsOfCellWithin(
  executor: Db | Transaction<Database>,
  cellId: string,
): Promise<Slot[]> {
  const rows = await executor
    .selectFrom('cell_schedules')
    .select(['day_of_week', 'time_of_day'])
    .where('cell_id', '=', cellId)
    .where((eb) =>
      eb.or([eb('ended_at', 'is', null), eb('ended_at', '>', sql<Date>`clock_timestamp()`)]),
    )
    .where((eb) => eb.or([eb('ended_at', 'is', null), eb('ended_at', '>', eb.ref('started_at'))]))
    .execute();

  return rows.map((row) => ({ dayOfWeek: row.day_of_week, timeOfDay: row.time_of_day }));
}

/** Who decides whether a clash may be named to the asker (decision 0392, section 8). */
interface Visibility {
  /** The leader of the Cell it names, for a running Cell or a handover; null for a new Cell. */
  cellLeaderId: string | null;
  /** The account that sent it, for a pending request. */
  requestedBy: string | null;
}

/**
 * Whether the asker may be told what a clash is (decision 0392). A Cell, or a pending handover
 * of one, is named where the asker's `cell.view_subtree` covers its current leader; a pending
 * new-Cell request where the asker sent it or approves Cells church-wide. Anything else is said
 * to exist and never named, because section 8 withholds a Cell outside the reader's scope.
 */
export type ClashViewer = (clash: Visibility & { leaderId: string }) => Promise<boolean>;

/** The ordinary viewer, the asker's own grants deciding. */
export function clashViewerFor(
  authorization: AuthorizationService,
  executor: Db | Transaction<Database>,
  actor: Actor,
  authority: ActorAuthority,
): ClashViewer {
  return async ({ cellLeaderId, requestedBy }) => {
    if (cellLeaderId !== null) {
      return authorization.coversWith(executor, actor, authority, Capability.CellViewSubtree, {
        kind: 'person',
        personId: cellLeaderId,
      });
    }
    if (requestedBy !== null && sameId(requestedBy, actor.accountId)) {
      return true;
    }
    // Church-wide only: a ticked approver's queue leaves out requests it may not decide
    // (decision 0352), so reach over the leader is not enough to have seen this one.
    return authorization.coversWith(executor, actor, authority, Capability.CellApproveLeadership, {
      kind: 'church',
    });
  };
}

/**
 * What the leader is already committed to: their `ACTIVE` Cells by every schedule row not
 * over, and their `PENDING` requests, a new Cell or restart by the day and time it asks for
 * and a handover by the Cell's schedule (decision 0392).
 *
 * `exceptCellId` leaves out the Cell being changed or handed over, and `exceptRequestId` the
 * request being approved, so neither is compared with itself.
 */
async function commitmentsOfWithin(
  trx: Transaction<Database>,
  leaderId: string,
  except: { cellId?: string | null; requestId?: string | null },
): Promise<Array<Clash & Slot & Visibility>> {
  const cellRows = await trx
    .selectFrom('cell_leaderships as l')
    .innerJoin('cells as c', 'c.id', 'l.cell_id')
    .innerJoin('cell_schedules as s', 's.cell_id', 'c.id')
    .leftJoin('cell_categories as k', (join) =>
      join.onRef('k.cell_id', '=', 'c.id').on('k.ended_at', 'is', null),
    )
    .select(['c.id as uuid', 'c.cell_id', 'k.category', 's.day_of_week', 's.time_of_day'])
    .where('l.person_id', '=', leaderId)
    .where('l.ended_at', 'is', null)
    .where('c.state', '=', 'ACTIVE')
    .where((eb) =>
      eb.or([eb('s.ended_at', 'is', null), eb('s.ended_at', '>', sql<Date>`clock_timestamp()`)]),
    )
    .where((eb) =>
      eb.or([eb('s.ended_at', 'is', null), eb('s.ended_at', '>', eb.ref('s.started_at'))]),
    )
    .execute();

  const requestRows = await trx
    .selectFrom('cell_leadership_requests as r')
    .leftJoin('cells as c', 'c.id', 'r.cell_id')
    .leftJoin('cell_schedules as s', (join) =>
      join
        .onRef('s.cell_id', '=', 'r.cell_id')
        .on((eb) =>
          eb.or([
            eb('s.ended_at', 'is', null),
            eb('s.ended_at', '>', sql<Date>`clock_timestamp()`),
          ]),
        )
        .on((eb) =>
          eb.or([eb('s.ended_at', 'is', null), eb('s.ended_at', '>', eb.ref('s.started_at'))]),
        ),
    )
    .leftJoin('cell_categories as k', (join) =>
      join.onRef('k.cell_id', '=', 'r.cell_id').on('k.ended_at', 'is', null),
    )
    // A handover's Cell, by whom it is led now, which is what decides who may see it.
    .leftJoin('cell_leaderships as cl', (join) =>
      join.onRef('cl.cell_id', '=', 'r.cell_id').on('cl.ended_at', 'is', null),
    )
    .select([
      'r.id',
      'r.kind',
      'r.requested_by',
      'cl.person_id as cell_leader_id',
      'r.cell_id as uuid',
      'c.cell_id',
      'r.category as requested_category',
      'k.category as cell_category',
      'r.day_of_week as requested_day',
      'r.time_of_day as requested_time',
      's.day_of_week as cell_day',
      's.time_of_day as cell_time',
    ])
    .where('r.prospective_leader_id', '=', leaderId)
    .where('r.state', '=', 'PENDING')
    .execute();

  const commitments: Array<Clash & Slot & Visibility> = [];

  for (const row of cellRows) {
    if (except.cellId && sameId(row.uuid, except.cellId)) {
      continue;
    }
    const time = hhmm(row.time_of_day);
    commitments.push({
      source: 'CELL',
      cell_id: row.cell_id,
      category: row.category,
      day_of_week: row.day_of_week,
      time_of_day: time,
      dayOfWeek: row.day_of_week,
      timeOfDay: row.time_of_day,
      cellLeaderId: leaderId,
      requestedBy: null,
    });
  }

  for (const row of requestRows) {
    if (except.requestId && sameId(row.id, except.requestId)) {
      continue;
    }
    if (row.kind === 'NEW_CELL') {
      if (row.requested_day === null || row.requested_time === null) {
        continue;
      }
      const time = hhmm(row.requested_time);
      commitments.push({
        source: 'REQUEST',
        cell_id: null,
        category: row.requested_category,
        day_of_week: row.requested_day,
        time_of_day: time,
        dayOfWeek: row.requested_day,
        timeOfDay: row.requested_time,
        cellLeaderId: null,
        requestedBy: row.requested_by,
      });
    } else {
      if (
        (except.cellId && row.uuid !== null && sameId(row.uuid, except.cellId)) ||
        row.cell_day === null ||
        row.cell_time === null
      ) {
        continue;
      }
      const time = hhmm(row.cell_time);
      commitments.push({
        source: 'REQUEST',
        cell_id: row.cell_id,
        category: row.cell_category,
        day_of_week: row.cell_day,
        time_of_day: time,
        dayOfWeek: row.cell_day,
        timeOfDay: row.cell_time,
        cellLeaderId: row.cell_leader_id,
        requestedBy: row.requested_by,
      });
    }
  }

  return commitments;
}

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const CATEGORY_NAMES: Record<CellCategory, string> = {
  YOUTH: 'Youth',
  YOUNG_PRO: 'Young Pro',
  COUPLE: 'Couple',
};

/** "Young Pro · Saturday 19:00 (CELL-000004)", or "a requested Couple Cell · Saturday 20:00". */
function describe(clash: Clash): string {
  const when = `${DAY_NAMES[clash.day_of_week - 1]} ${clash.time_of_day}`;
  const what = clash.category === null ? 'Cell' : CATEGORY_NAMES[clash.category];
  return clash.source === 'REQUEST' && clash.cell_id === null
    ? `a requested ${what} Cell · ${when}`
    : `${what} · ${when}${clash.cell_id === null ? '' : ` (${clash.cell_id})`}`;
}

/**
 * Refuses a write that would give one leader two Cells starting less than two hours apart
 * (SKILL.md section 10, decision 0392).
 *
 * **The caller holds the leader's person lock** (`lockPersonsWithin`), taken before any
 * `cells` row lock as section 5 orders them, so two writes for one leader are decided one
 * after the other and cannot both pass on a state neither can see.
 *
 * `slots` is what the leader would take on: a new Cell's day and time, a changed Cell's new
 * ones, or every schedule row of a Cell handed to them.
 */
export async function assertNoScheduleClashWithin(
  trx: Transaction<Database>,
  params: {
    leaderId: string;
    slots: readonly Slot[];
    exceptCellId?: string | null;
    exceptRequestId?: string | null;
    /** Who is asking, so that only what they may see is named (decision 0392). */
    viewer: ClashViewer;
  },
): Promise<void> {
  const commitments = await commitmentsOfWithin(trx, params.leaderId, {
    cellId: params.exceptCellId,
    requestId: params.exceptRequestId,
  });

  const clashes = commitments.filter((commitment) =>
    params.slots.some((slot) => slotsClash(slot, commitment)),
  );

  if (clashes.length === 0) {
    return;
  }

  const named: Clash[] = [];
  let unnamed = false;
  for (const clash of clashes) {
    if (await params.viewer({ ...clash, leaderId: params.leaderId })) {
      const { source, cell_id, category, day_of_week, time_of_day } = clash;
      named.push({ source, cell_id, category, day_of_week, time_of_day });
    } else {
      unnamed = true;
    }
  }

  // What the asker may not see is said to exist, once, and never which or how many.
  const what =
    named.length === 0
      ? 'a Cell Group, or a request for one, starting less than 2 hours from this time'
      : named.map(describe).join(' and ') +
        (unnamed ? ', and another Cell Group or request starting less than 2 hours from this' : '');

  throw new InvariantViolationError(
    `This leader already has ${what}. A leader's Cell Groups must start at least 2 hours apart.`,
    { leader_id: params.leaderId, clashes: named, others: unnamed },
  );
}

/** One leader's Cells that start less than two hours apart, for Admin's list (decision 0392). */
export interface LeaderClash {
  leaderId: string;
  /** The least distance, in whole minutes, between any two of these Cells' starts. */
  closestMinutes: number;
  cells: Array<{
    uuid: string;
    cell_id: string;
    category: CellCategory | null;
    day_of_week: number;
    time_of_day: string;
  }>;
}

/**
 * Every leader with two `ACTIVE` Cells starting less than two hours apart, by the schedule
 * rows in force now (decision 0392). Pending requests are not listed: they are refused at
 * approval rather than shown as something to fix.
 */
export async function scheduleClashesWithin(executor: Db): Promise<LeaderClash[]> {
  const rows = await executor
    .selectFrom('cell_leaderships as l')
    .innerJoin('cells as c', 'c.id', 'l.cell_id')
    .innerJoin('cell_schedules as s', 's.cell_id', 'c.id')
    .leftJoin('cell_categories as k', (join) =>
      join.onRef('k.cell_id', '=', 'c.id').on('k.ended_at', 'is', null),
    )
    .select([
      'l.person_id as leader_id',
      'c.id as uuid',
      'c.cell_id',
      'k.category',
      's.day_of_week',
      's.time_of_day',
    ])
    .where('l.ended_at', 'is', null)
    .where('c.state', '=', 'ACTIVE')
    .where('s.started_at', '<=', sql<Date>`clock_timestamp()`)
    .where((eb) =>
      eb.or([eb('s.ended_at', 'is', null), eb('s.ended_at', '>', sql<Date>`clock_timestamp()`)]),
    )
    .orderBy('c.cell_id')
    .execute();

  const byLeader = new Map<string, typeof rows>();
  for (const row of rows) {
    byLeader.set(row.leader_id, [...(byLeader.get(row.leader_id) ?? []), row]);
  }

  const result: LeaderClash[] = [];
  for (const [leaderId, cells] of byLeader) {
    const involved = new Set<string>();
    let closest = Number.POSITIVE_INFINITY;
    for (let i = 0; i < cells.length; i += 1) {
      for (let j = i + 1; j < cells.length; j += 1) {
        const a = { dayOfWeek: cells[i].day_of_week, timeOfDay: cells[i].time_of_day };
        const b = { dayOfWeek: cells[j].day_of_week, timeOfDay: cells[j].time_of_day };
        if (slotsClash(a, b)) {
          involved.add(cells[i].uuid);
          involved.add(cells[j].uuid);
          closest = Math.min(closest, Math.floor(secondsApart(a, b) / 60));
        }
      }
    }
    if (involved.size > 0) {
      result.push({
        leaderId,
        closestMinutes: closest,
        cells: cells
          .filter((cell) => involved.has(cell.uuid))
          .map((cell) => ({
            uuid: cell.uuid,
            cell_id: cell.cell_id,
            category: cell.category,
            day_of_week: cell.day_of_week,
            time_of_day: hhmm(cell.time_of_day),
          })),
      });
    }
  }

  return result;
}
