import { Inject, Injectable } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';

import { AttendanceStandingService } from '../attendance/attendance-standing.service';
import { AuditService } from '../audit/audit.service';
import { EquippingAttendanceService } from './equipping-attendance.service';
import { AuthorizationService, type Actor } from '../auth/authorization/authorization.service';
import { CellsReadService } from '../cells/cells.read.service';
import { slotsClash } from '../cells/schedule-clash';
import {
  ApiError,
  ApiErrorCode,
  InvariantViolationError,
  NotFoundError,
  ScopeDeniedError,
  ValidationFailedError,
} from '../common/errors/api-error';
import {
  isLostLockWait,
  isUniqueViolation,
  violatedConstraint,
} from '../common/errors/postgres-errors';
import { canonicalId, isUuid } from '../common/identifiers';
import { resolverOf } from '../common/merged-identity';
import { manilaDayOf } from '../common/time/manila';
import { databaseNow } from '../common/time/submission-window';
import { IdempotencyService } from '../common/idempotency/idempotency.service';
import { DATABASE, type Db } from '../database/database.module';
import { lockPersonsWithin } from '../database/person-lock';
import { HierarchyService } from '../hierarchy/hierarchy.service';
import { PeopleReadService } from '../people/people.read.service';
import { ConquestService } from '../conquest/conquest.service';
import { SuynlService } from '../suynl/suynl.service';
import { EncounterSeasonsService } from '../training/encounter-seasons.service';
import { TrainingService } from '../training/training.service';
import { EQUIPPING_LEVELS } from './dto/equipping.dto';
import { expectedOn } from './equipping-attendance.service';
import { lockSolOpeningWithin } from './sol-opening';

import type { CurrentClaim } from '../common/idempotency/current-idempotency.decorator';
import type { Database, EquippingLevel, EquippingRequirement } from '../database/schema';
import type {
  CorrectClassDto,
  EquippingTermDto,
  ListRegistrationsDto,
  OpenClassDto,
  RegisterDto,
} from './dto/equipping.dto';
import { bySchoolName, schoolPerson } from './school-order';

import type { PersonCells } from '../cells/cells.read.service';

/** Section 12's and section 9's ladder: the fifth attendance and beyond is a Regular. */
const REGULAR_FROM = 5;
/**
 * SUYNL lessons 1 to 4 recorded, whatever else is (owner, 2026-11-18: "must have SUYNL lesson
 * 1 - 4 ticked regardless he or she is ticked 5 7 8 9"), replacing any five (decision 0499, point 6).
 */
const SUYNL_LESSONS_NEEDED = [1, 2, 3, 4] as const;
/** 14 by the first day of the Encounter weekend (point 11; owner 2026-11-19, replacing 15). */
export const ENCOUNTER_MINIMUM_AGE = 14;
/** Section 22: a collection's default page. */
const DEFAULT_PAGE = 50;

/** One requirement as read from the records (decision 0499, point 6). */
export interface RequirementCheck {
  code: EquippingRequirement;
  met: boolean;
  /** Words a screen shows beside it: the leader's name, a count, the last meeting. */
  detail: string;
}

type Status = 'REGISTERED' | 'REGISTERED_WITH_EXCEPTION' | 'ENROLLED' | 'CANCELLED';

/** Whole years from a birthday to a day, both `YYYY-MM-DD`. */
export function ageOn(birthDate: string, day: string): number {
  const [by, bm, bd] = birthDate.split('-').map(Number);
  const [y, m, d] = day.split('-').map(Number);
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}

/** The *Registration* list's key: last name, first name, Member ID, then the row (decision 0515). */
interface RegistrationCursor {
  last: string;
  first: string;
  member: string;
  id: string;
}

function encodeCursor(row: {
  last_name: string;
  first_name: string;
  member_id: string;
  id: string;
}): string {
  return Buffer.from(
    JSON.stringify([row.last_name, row.first_name, row.member_id, row.id]),
  ).toString('base64url');
}

/** A name part as a cursor carries it; `CURSOR_MAX_LENGTH` bounds the cursor as a whole. */
const isNamePart = (value: unknown): value is string => typeof value === 'string';

/** A cursor that cannot be resolved is refused (decision 0159). */
function decodeCursor(cursor: string | undefined): RegistrationCursor | null {
  if (cursor === undefined) {
    return null;
  }
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      Array.isArray(value) &&
      value.length === 4 &&
      isNamePart(value[0]) &&
      isNamePart(value[1]) &&
      isNamePart(value[2]) &&
      typeof value[3] === 'string' &&
      isUuid(value[3])
    ) {
      return { last: value[0], first: value[1], member: value[2], id: value[3] };
    }
  } catch {
    // Falls through to the refusal.
  }
  throw new ValidationFailedError('That page cursor is not one this list gave.', {
    field: 'cursor',
  });
}

/** Each level's name in words, for a refusal or a line on a screen. */
export const LEVEL_NAMES: Record<EquippingLevel, string> = {
  LIFE_CLASS: 'Life Class',
  SOL_1: 'SOL 1',
  SOL_2: 'SOL 2',
  SOL_3: 'SOL 3',
};

/**
 * **Who may guide a level: one level ahead** (decision 0501, point 4; decisions 0516 and 0517):
 * SOL 1 passed guides Life Class, SOL 2 passed guides SOL 1 or Life Class, and SOL 3 passed guides
 * any level below it, and SOL 3 itself with three Cell Leaders among their own disciples
 * (`GUIDE_CELL_LEADERS`). Lowest first.
 */
export function guidingPrograms(level: EquippingLevel): readonly ('SOL_1' | 'SOL_2' | 'SOL_3')[] {
  switch (level) {
    case 'LIFE_CLASS':
      return ['SOL_1', 'SOL_2', 'SOL_3'];
    case 'SOL_1':
      return ['SOL_2', 'SOL_3'];
    case 'SOL_2':
    case 'SOL_3':
      return ['SOL_3'];
  }
}

/**
 * **A SOL 3 Guide has three Cell Leaders under them** (owner, 2026-11-20, option A; decision
 * 0501, point 4): at least three of their own direct disciples each leading an `ACTIVE` Cell now.
 */
export const GUIDE_CELL_LEADERS = 3;

/** SOL 3's twelve: twelve direct disciples now, on open assignments (decision 0501, point 18). */
export const SOL_3_DISCIPLES = 12;

/**
 * How many Guides a SOL class needs for this many students of one sex (decision 0501, point 8):
 * up to 5 a Guide, as few Guides as possible.
 */
export function solGuidesFor(students: number): number {
  return students <= 0 ? 0 : Math.ceil(students / 5);
}

/** How many Guides a class of this level needs for this many students of one sex. */
export function guidesFor(level: EquippingLevel, students: number): number {
  return level === 'LIFE_CLASS' ? lifeClassGuidesFor(students) : solGuidesFor(students);
}

/**
 * How many Guides a Life Class needs for this many students of one sex (decision 0501, point 8):
 * the students divided by 3, the remainder dropped, at least one; the owner gave 1 or 2 students
 * one Guide and 5 two (3 and 2), never one Guide with 5.
 */
export function lifeClassGuidesFor(students: number): number {
  if (students <= 0) {
    return 0;
  }
  if (students <= 2) {
    return 1;
  }
  if (students === 5) {
    return 2;
  }
  return Math.floor(students / 3);
}

/**
 * The church's school: registration and enrollment for Life Class (SKILL.md section 29,
 * decision 0499).
 *
 * **Every route is Whole Church `equipping.manage`, or `equipping.coordinate` for the
 * Coordinator's** (decision 0501), decided by the guard before this runs, so nothing here
 * narrows by scope. What it reads of other modules it reads through their
 * services (section 2): a person and their birthday from `people`, their leader from
 * `hierarchy`, their Cell from `cells`, their attendance from `attendance`, their SUYNL
 * lessons from `suynl`, and the Encounter seasons from `training`. It writes only its own
 * three tables, and never deletes a row of them.
 */
/** One earlier try at a level (decision 0511): a grade posted *Not passed*. */
interface EarlierTry {
  termYear: number;
  termNumber: number;
  className: string;
  reason: string;
}

/**
 * The name of whoever leads the Cell a person attends now, or null when they attend none
 * (decision 0518).
 */
function cellLeaderName(
  cells: PersonCells | undefined,
  leaders: ReadonlyMap<string, { fullName: string }>,
): string | null {
  const leaderId = cells?.membership?.leaderId ?? null;
  return leaderId === null ? null : (leaders.get(leaderId)?.fullName ?? null);
}

/** How many tries came in terms before the given one: a term is one try (decision 0511). */
function triesBefore(
  tries: EarlierTry[] | undefined,
  term: { term_year: number; term_number: number },
): number {
  return new Set(
    (tries ?? [])
      .filter(
        (each) =>
          each.termYear < term.term_year ||
          (each.termYear === term.term_year && each.termNumber < term.term_number),
      )
      .map((each) => `${each.termYear}-${each.termNumber}`),
  ).size;
}

@Injectable()
export class EquippingService {
  constructor(
    @Inject(DATABASE) private readonly db: Db,
    private readonly people: PeopleReadService,
    private readonly hierarchy: HierarchyService,
    private readonly cells: CellsReadService,
    private readonly attendance: EquippingAttendanceService,
    private readonly standing: AttendanceStandingService,
    private readonly suynl: SuynlService,
    private readonly seasons: EncounterSeasonsService,
    private readonly training: TrainingService,
    private readonly audit: AuditService,
    private readonly idempotency: IdempotencyService,
    private readonly authorization: AuthorizationService,
    private readonly conquest: ConquestService,
  ) {}

  // ---------------------------------------------------------------------------
  // The level a Coordinator coordinates (decision 0514)
  // ---------------------------------------------------------------------------

  /**
   * **A Coordinator acts on their own levels only** (decision 0501, point 1; decision 0514): the
   * level is carried on the tick, so a route naming a level refuses one the actor does not
   * coordinate. The Admin coordinates every level.
   */
  async assertCoordinatesLevel(actor: Actor, level: EquippingLevel): Promise<void> {
    const levels = await this.authorization.coordinatedLevels(actor.accountId);
    if (levels !== 'ALL' && !levels.has(level)) {
      throw new ScopeDeniedError(`You do not coordinate ${LEVEL_NAMES[level]}.`, {
        field: 'level',
      });
    }
  }

  /** The levels the actor coordinates, in the school's order: every level for the Admin. */
  async coordinatedLevelsOf(actor: Actor): Promise<EquippingLevel[]> {
    const levels = await this.authorization.coordinatedLevels(actor.accountId);
    return EQUIPPING_LEVELS.filter((level) => levels === 'ALL' || levels.has(level));
  }

  /**
   * A class of a level the actor does not coordinate does not exist to them: answered `NOT_FOUND`,
   * as a class that does not exist is, so the refusal says nothing about another level's classes.
   */
  async assertCoordinatesClass(actor: Actor, classId: string): Promise<void> {
    const levels = await this.authorization.coordinatedLevels(actor.accountId);
    if (levels === 'ALL') {
      return;
    }
    const cls = await this.db
      .selectFrom('equipping_classes')
      .select('level')
      .where('id', '=', classId)
      .executeTakeFirst();
    if (cls === undefined || !levels.has(cls.level)) {
      throw new NotFoundError('No such class.');
    }
  }

  /** The same, for a route naming an enrollment: the level of its class. */
  async assertCoordinatesEnrollment(actor: Actor, enrollmentId: string): Promise<void> {
    const levels = await this.authorization.coordinatedLevels(actor.accountId);
    if (levels === 'ALL') {
      return;
    }
    const row = await this.db
      .selectFrom('equipping_enrollments as e')
      .innerJoin('equipping_classes as c', 'c.id', 'e.class_id')
      .select('c.level')
      .where('e.id', '=', enrollmentId)
      .executeTakeFirst();
    if (row === undefined || !levels.has(row.level)) {
      throw new NotFoundError('No such enrollment.');
    }
  }

  /**
   * The level's other Coordinators, by name, for the subtitle of the Coordinator's *Classes*
   * (decision 0514): "Life Class, which you coordinate with Teofilo Ramos."
   */
  async otherCoordinatorsOf(actor: Actor, level: EquippingLevel): Promise<string[]> {
    const ids = (await this.authorization.coordinatorsOf(level)).filter(
      (id) => canonicalId(id) !== canonicalId(actor.personId),
    );
    const people = await this.people.forDecisions(ids);
    return ids
      .map((id) => people.get(id)?.fullName ?? null)
      .filter((name): name is string => name !== null)
      .sort((a, b) => a.localeCompare(b));
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  /**
   * The record requirements for each person at a level, read as things stand now: Life Class's
   * four (decision 0499, point 6), or SOL 1's or SOL 2's two read from the records (decisions
   * 0514 and 0516), the third, the manual or the book, being the Registrar's tick on the form.
   */
  async requirementsOf(
    personIds: readonly string[],
    level: EquippingLevel = 'LIFE_CLASS',
  ): Promise<Map<string, RequirementCheck[]>> {
    if (level === 'SOL_1') {
      return this.sol1RequirementsOf(personIds);
    }
    if (level === 'SOL_2') {
      return this.sol2RequirementsOf(personIds);
    }
    if (level === 'SOL_3') {
      return this.sol3RequirementsOf(personIds);
    }
    const ids = [...new Set(personIds.map((id) => canonicalId(id)))];
    const [leaders, leaderNames, standing, lessons] = await Promise.all([
      this.hierarchy.directLeaderIdsOf(ids),
      this.people.directLeaderNamesOf(ids),
      this.standing.standingOf(ids),
      this.suynl.currentLessonsOf(ids),
    ]);

    return new Map(
      ids.map((id) => {
        const attended = standing.get(id) ?? {
          dccAttended: 0,
          cellAttended: 0,
          lastCellMeetingOn: null,
        };
        const held = new Set(lessons.get(id) ?? []);
        const missing = SUYNL_LESSONS_NEEDED.filter((lesson) => !held.has(lesson));
        const leaderName = leaderNames.get(id) ?? null;
        return [
          id,
          [
            {
              code: 'HAS_LEADER' as const,
              met: leaders.has(id),
              detail: leaders.has(id) ? (leaderName ?? 'Has a leader') : 'No leader yet',
            },
            {
              code: 'CELL_REGULAR' as const,
              met: attended.cellAttended >= REGULAR_FROM,
              detail:
                attended.cellAttended === 0
                  ? 'No Cell meeting attended yet'
                  : `${attended.cellAttended} ${attended.cellAttended === 1 ? 'meeting' : 'meetings'}` +
                    (attended.lastCellMeetingOn ? `, last on ${attended.lastCellMeetingOn}` : ''),
            },
            {
              code: 'DCC_REGULAR' as const,
              met: attended.dccAttended >= REGULAR_FROM,
              detail: `${attended.dccAttended} ${attended.dccAttended === 1 ? 'Sunday' : 'Sundays'} recorded`,
            },
            {
              code: 'SUYNL_LESSONS_1_TO_4' as const,
              met: missing.length === 0,
              detail:
                missing.length === 0
                  ? 'Lessons 1 to 4 recorded'
                  : `Lesson ${missing.join(', ')} not recorded yet`,
            },
          ],
        ];
      }),
    );
  }

  /**
   * **SOL 1's two record requirements** (decision 0501, point 18; decision 0514): Life Class
   * passed, by a posted grade of the school or a pass recorded before it (point 19), and Win 3
   * as Conquest derives it (section 27) **or three direct disciples now** (owner ruling of
   * 2026-11-25, decision 0514 point 5), counted on open pastoral assignments, which an archive or
   * a merge ends. Read once, at registration, and never again in the term.
   */
  private async sol1RequirementsOf(
    personIds: readonly string[],
  ): Promise<Map<string, RequirementCheck[]>> {
    const ids = [...new Set(personIds.map((id) => canonicalId(id)))];
    const [passed, wins, disciples, posted] = await Promise.all([
      this.training.holdersOfAny(ids, ['LIFE_CLASS']),
      this.conquest.win3Of(ids),
      this.hierarchy.discipleCountsOf(this.db, ids),
      ids.length === 0
        ? Promise.resolve([])
        : this.db
            // The grade as it stands, a change after posting included (decision 0513).
            .selectFrom('equipping_current_grades as g')
            .innerJoin('equipping_class_postings as p', 'p.id', 'g.posting_id')
            .innerJoin('equipping_classes as c', 'c.id', 'p.class_id')
            .innerJoin('equipping_enrollments as n', 'n.id', 'g.enrollment_id')
            .innerJoin('equipping_registrations as r', 'r.id', 'n.registration_id')
            .select(['r.person_id', 'c.name', 'r.term_year', 'r.term_number'])
            .where('g.grade', '=', 'PASSED')
            .where('r.level', '=', 'LIFE_CLASS')
            .where('r.person_id', 'in', ids)
            .orderBy('p.posted_at')
            .execute(),
    ]);
    const passedIn = new Map(
      posted.map((row) => [
        canonicalId(row.person_id),
        `Passed ${row.name}, Term ${row.term_number}, ${row.term_year}`,
      ]),
    );
    return new Map(
      ids.map((id) => {
        const win = wins.get(id)?.reached ?? false;
        const threeDisciples = (disciples.get(id) ?? 0) >= 3;
        return [
          id,
          [
            {
              code: 'LIFE_CLASS_PASSED' as const,
              met: passed.has(id),
              detail: passed.has(id)
                ? (passedIn.get(id) ?? 'Life Class passed')
                : 'Life Class not passed yet',
            },
            {
              code: 'WIN_3' as const,
              // Either way meets it, and neither count is shown (owner rulings of 2026-11-25,
              // decision 0514 point 5).
              met: win || threeDisciples,
              detail: win
                ? 'Win 3 reached'
                : threeDisciples
                  ? '3 disciples under them in DREAMS'
                  : 'needs Win 3, or 3 disciples under them in DREAMS',
            },
          ],
        ];
      }),
    );
  }

  /**
   * **SOL 2's two record requirements** (decision 0501, point 18; decision 0516): SOL 1 passed,
   * by a posted grade of the school or a pass recorded before it (point 19), both of which
   * Training holds, and the leadership of an `ACTIVE` Cell now (section 11's current Cell
   * Leader), which a Cell closed for any reason, `CREATED_IN_ERROR` included, does not give. Read
   * once, at registration, and never again in the term.
   */
  private async sol2RequirementsOf(
    personIds: readonly string[],
  ): Promise<Map<string, RequirementCheck[]>> {
    const ids = [...new Set(personIds.map((id) => canonicalId(id)))];
    const [passed, leaders, cells, posted] = await Promise.all([
      this.training.holdersOfAny(ids, ['SOL_1']),
      this.cells.currentCellLeaderIds(ids),
      this.cells.currentCellsOfMany(ids),
      ids.length === 0
        ? Promise.resolve([])
        : this.db
            // The grade as it stands, a change after posting included (decision 0513).
            .selectFrom('equipping_current_grades as g')
            .innerJoin('equipping_class_postings as p', 'p.id', 'g.posting_id')
            .innerJoin('equipping_classes as c', 'c.id', 'p.class_id')
            .innerJoin('equipping_enrollments as n', 'n.id', 'g.enrollment_id')
            .innerJoin('equipping_registrations as r', 'r.id', 'n.registration_id')
            .select(['r.person_id', 'c.name', 'r.term_year', 'r.term_number'])
            .where('g.grade', '=', 'PASSED')
            .where('r.level', '=', 'SOL_1')
            .where('r.person_id', 'in', ids)
            .orderBy('p.posted_at')
            .execute(),
    ]);
    const passedIn = new Map(
      posted.map((row) => [
        canonicalId(row.person_id),
        `Passed ${row.name}, Term ${row.term_number}, ${row.term_year}`,
      ]),
    );
    const leading = new Set([...leaders].map((id) => canonicalId(id)));
    return new Map(
      ids.map((id) => {
        const codes = (cells.get(id)?.leads ?? []).map((cell) => cell.cellId).sort();
        return [
          id,
          [
            {
              code: 'SOL_1_PASSED' as const,
              met: passed.has(id),
              detail: passed.has(id)
                ? (passedIn.get(id) ?? 'SOL 1 passed')
                : 'SOL 1 not passed yet',
            },
            {
              code: 'LEADS_A_CELL' as const,
              met: leading.has(id),
              detail: leading.has(id)
                ? codes.length > 0
                  ? `Leads ${codes.join(', ')}`
                  : 'Leads a Cell'
                : 'leads no Cell now',
            },
          ],
        ];
      }),
    );
  }

  /**
   * **SOL 3's three record requirements** (decision 0501, point 18; decision 0517): SOL 2 passed,
   * by a posted grade of the school or a pass recorded before it, both of which Training holds;
   * the leadership of an `ACTIVE` Cell now; and twelve direct disciples now, counted on open
   * pastoral assignments, which an archive or a merge ends, and never shown as a count (decision
   * 0514, point 5's reason). Read once, at registration, and never again in the term.
   */
  private async sol3RequirementsOf(
    personIds: readonly string[],
  ): Promise<Map<string, RequirementCheck[]>> {
    const ids = [...new Set(personIds.map((id) => canonicalId(id)))];
    const [passed, leaders, cells, disciples, posted] = await Promise.all([
      this.training.holdersOfAny(ids, ['SOL_2']),
      this.cells.currentCellLeaderIds(ids),
      this.cells.currentCellsOfMany(ids),
      this.hierarchy.discipleCountsOf(this.db, ids),
      ids.length === 0
        ? Promise.resolve([])
        : this.db
            // The grade as it stands, a change after posting included (decision 0513).
            .selectFrom('equipping_current_grades as g')
            .innerJoin('equipping_class_postings as p', 'p.id', 'g.posting_id')
            .innerJoin('equipping_classes as c', 'c.id', 'p.class_id')
            .innerJoin('equipping_enrollments as n', 'n.id', 'g.enrollment_id')
            .innerJoin('equipping_registrations as r', 'r.id', 'n.registration_id')
            .select(['r.person_id', 'c.name', 'r.term_year', 'r.term_number'])
            .where('g.grade', '=', 'PASSED')
            .where('r.level', '=', 'SOL_2')
            .where('r.person_id', 'in', ids)
            .orderBy('p.posted_at')
            .execute(),
    ]);
    const passedIn = new Map(
      posted.map((row) => [
        canonicalId(row.person_id),
        `Passed ${row.name}, Term ${row.term_number}, ${row.term_year}`,
      ]),
    );
    const leading = new Set([...leaders].map((id) => canonicalId(id)));
    return new Map(
      ids.map((id) => {
        const codes = (cells.get(id)?.leads ?? []).map((cell) => cell.cellId).sort();
        const twelve = (disciples.get(id) ?? 0) >= SOL_3_DISCIPLES;
        return [
          id,
          [
            {
              code: 'SOL_2_PASSED' as const,
              met: passed.has(id),
              detail: passed.has(id)
                ? (passedIn.get(id) ?? 'SOL 2 passed')
                : 'SOL 2 not passed yet',
            },
            {
              code: 'LEADS_A_CELL' as const,
              met: leading.has(id),
              detail: leading.has(id)
                ? codes.length > 0
                  ? `Leads ${codes.join(', ')}`
                  : 'Leads a Cell'
                : 'leads no Cell now',
            },
            {
              code: 'TWELVE_DISCIPLES' as const,
              met: twelve,
              detail: twelve
                ? `${SOL_3_DISCIPLES} disciples under them in DREAMS`
                : `needs ${SOL_3_DISCIPLES} disciples under them in DREAMS`,
            },
          ],
        ];
      }),
    );
  }

  /**
   * One person as the registration form shows them: who they are, their leader and Cell, their
   * birthday, and the four record requirements.
   */
  async candidate(
    personId: string,
    level: EquippingLevel = 'LIFE_CLASS',
  ): Promise<Record<string, unknown>> {
    const person = await this.people.forDecision(personId);
    if (!person || person.mergedIntoId !== null || (await this.isEquippingRecord(personId))) {
      throw new NotFoundError('No such person.');
    }
    const id = canonicalId(person.id);
    const [checks, cells, births, leaderNames, tries] = await Promise.all([
      this.requirementsOf([id], level),
      this.cells.currentCellsOfMany([id]),
      this.people.birthDatesOf([id]),
      this.people.directLeaderNamesOf([id]),
      this.earlierTriesOf([id], level),
    ]);
    // Joining a later class at Lesson 6 is Life Class's alone (decision 0512).
    const joins =
      level === 'LIFE_CLASS'
        ? ((await this.lesson6SourcesOf(this.db, [id], 'LIFE_CLASS', null)).get(id) ?? null)
        : null;
    const membership = cells.get(id)?.membership ?? null;
    const cellLeader =
      membership?.leaderId != null
        ? ((await this.people.forDecisions([membership.leaderId])).get(membership.leaderId)
            ?.fullName ?? null)
        : null;

    return {
      person: { id, member_id: person.memberId, full_name: person.fullName },
      archived: person.isArchived,
      leader_name: leaderNames.get(id) ?? null,
      in_a_cell: membership !== null,
      cell_leader_name: cellLeader,
      birth_date: births.get(id) ?? null,
      requirements: checks.get(id) ?? [],
      // *Took Life Class before* on the Register form (decision 0511), oldest first.
      earlier_tries: (tries.get(id) ?? []).map((each) => ({
        term_year: each.termYear,
        term_number: each.termNumber,
        class_name: each.className,
        reason: each.reason,
      })),
      // Joins a later class at Lesson 6, keeping lessons 1 to 4 from there (decision 0512).
      joins_at_lesson_6:
        joins === null
          ? null
          : {
              class_name: joins.className,
              term_year: joins.termYear,
              term_number: joins.termNumber,
            },
    };
  }

  /** The Encounter seasons a class may name, both halves (decision 0499, point 10). */
  async encounterSeasons(): Promise<Record<string, unknown>> {
    return { data: await this.seasons.allSeasons() };
  }

  /**
   * The person picker: current people by name, church-wide, four fields each (section 8).
   * `teachers` narrows it to who may teach a class, a current Cell Leader in the tree (point
   * 10), in SQL so a page is never spent on rows about to be dropped.
   */
  async search(
    term: string,
    limit: number,
    who: boolean | 'teachers' | 'guides' = false,
    level: EquippingLevel = 'LIFE_CLASS',
  ): Promise<Record<string, unknown>[]> {
    // A Registrar record is never somebody signed up for a class, for the Admin too (decision
    // 0499, point 13); `candidate` and `register` refuse it the same way.
    const restrictTo =
      who === true || who === 'teachers'
        ? await this.mayTeachWithin(this.db, null)
        : who === 'guides'
          ? await this.mayGuideWithin(this.db, null, level)
          : null;
    const { rows } = await this.people.searchByName(term, limit, null, restrictTo, {
      currentOnly: true,
      exclude: await this.people.equippingAccountPersons(),
    });
    const ids = rows.map((row) => row.id);
    const names = await this.people.directLeaderNamesOf(ids);
    const decided = await this.people.forDecisions(ids);
    // The Guide search says why each person qualifies (decision 0501, point 4): the highest
    // level they have passed.
    const passed =
      who === 'guides'
        ? await Promise.all(
            [...guidingPrograms(level)].reverse().map(async (passed) => ({
              level: passed,
              holders: await this.training.holdersOfAny(ids, [passed]),
            })),
          )
        : [];
    return rows.map((row) => {
      const highest = passed.find((each) => each.holders.has(canonicalId(row.id)));
      return {
        id: row.id,
        member_id: row.member_id,
        full_name: decided.get(row.id)?.fullName ?? `${row.first_name} ${row.last_name}`,
        direct_leader_name: names.get(row.id) ?? null,
        ...(who === 'guides'
          ? {
              qualifies: highest
                ? `Passed ${highest.level.replace('_', ' ')}` +
                  // A SOL 3 Guide's second condition, said too (decision 0501, point 4).
                  (level === 'SOL_3' ? `, with ${GUIDE_CELL_LEADERS} Cell Leaders under them` : '')
                : null,
            }
          : {}),
      };
    });
  }

  /**
   * How many are registered for each level in a term, a cancelled registration left out, for the
   * counts on the Level picker (decision 0514): *Life Class · 14*, *SOL 1 · 2*.
   */
  async registrationCounts(term: {
    term_year: number;
    term_number: number;
  }): Promise<Record<EquippingLevel, number>> {
    const rows = await this.db
      .selectFrom('equipping_registrations')
      .select(['level', sql<number>`count(*)::int`.as('n')])
      .where('term_year', '=', term.term_year)
      .where('term_number', '=', term.term_number)
      .where('cancelled_at', 'is', null)
      .groupBy('level')
      .execute();
    return Object.fromEntries(
      EQUIPPING_LEVELS.map((level) => [
        level,
        Number(rows.find((row) => row.level === level)?.n ?? 0),
      ]),
    ) as Record<EquippingLevel, number>;
  }

  /**
   * A term's registrations in last-name order, a page at a time (sections 22 and 29, decision
   * 0515): `persons` is joined onto this module's own table for the key, the one shape section 2
   * admits, so the database pages by it rather than this list being read whole.
   */
  async registrations(query: ListRegistrationsDto): Promise<Record<string, unknown>> {
    const limit = query.limit ?? DEFAULT_PAGE;
    const after = decodeCursor(query.cursor);

    const rows = await this.db
      .selectFrom('equipping_registrations as r')
      .leftJoin('equipping_enrollments as e', (join) =>
        join.onRef('e.registration_id', '=', 'r.id').on('e.ended_at', 'is', null),
      )
      .leftJoin('equipping_classes as c', 'c.id', 'e.class_id')
      .innerJoin('persons as p', 'p.id', 'r.person_id')
      .select([
        'r.id',
        'r.person_id',
        'p.last_name',
        'p.first_name',
        'p.member_id',
        'r.unmet',
        'r.exception_reason',
        'r.note',
        'r.registered_at',
        'r.cancelled_at',
        'r.cancel_reason',
        'e.id as enrollment_id',
        'c.id as class_id',
        'c.name as class_name',
      ])
      .where('r.level', '=', query.level)
      .where('r.term_year', '=', query.term_year)
      .where('r.term_number', '=', query.term_number)
      .$if(after !== null, (qb) =>
        qb.where((eb) =>
          eb(
            eb.refTuple('p.last_name', 'p.first_name', 'p.member_id', 'r.id'),
            '>',
            eb.tuple(
              sql<string>`${after!.last}`,
              sql<string>`${after!.first}`,
              sql<string>`${after!.member}`,
              sql<string>`${after!.id}::uuid`,
            ),
          ),
        ),
      )
      .orderBy('p.last_name')
      .orderBy('p.first_name')
      .orderBy('p.member_id')
      .orderBy('r.id')
      .limit(limit + 1)
      .execute();

    const page = rows.slice(0, limit);
    const ids = page.map((row) => row.person_id);
    const [people, leaderNames, births, tries, cells] = await Promise.all([
      this.people.forDecisions(ids),
      this.people.directLeaderNamesOf(ids),
      this.people.birthDatesOf(ids),
      this.earlierTriesOf(ids, query.level),
      this.cells.currentCellsOfMany(ids),
    ]);
    // The leader of the Cell each person is a member of now, for the list's *Cell Leader*
    // (decision 0518); a member of none who leads one is said to lead one.
    const cellLeaderIds = [
      ...new Set(
        [...cells.values()]
          .map((each) => each.membership?.leaderId ?? null)
          .filter((id): id is string => id !== null),
      ),
    ];
    const cellLeaders = await this.people.forDecisions(cellLeaderIds);

    return {
      data: page.map((row) => ({
        id: row.id,
        person: {
          ...schoolPerson(row.person_id, people),
          member_id: people.get(row.person_id)?.memberId ?? null,
        },
        leader_name: leaderNames.get(row.person_id) ?? null,
        cell_leader_name: cellLeaderName(cells.get(canonicalId(row.person_id)), cellLeaders),
        leads_a_cell: (cells.get(canonicalId(row.person_id))?.leads.length ?? 0) > 0,
        birthday_recorded: (births.get(row.person_id) ?? null) !== null,
        status: this.statusOf(row),
        unmet: row.unmet,
        exception_reason: row.exception_reason,
        note: row.note,
        class: row.class_id === null ? null : { id: row.class_id, name: row.class_name },
        enrollment_id: row.enrollment_id,
        registered_at: row.registered_at.toISOString(),
        cancel_reason: row.cancel_reason,
        // Which try this registration is (decision 0511): 1 and the tries in earlier terms.
        try_number: 1 + triesBefore(tries.get(canonicalId(row.person_id)), query),
      })),
      next_cursor: rows.length > limit ? encodeCursor(page[page.length - 1]) : null,
    };
  }

  /**
   * A term's classes, each with how many are enrolled. Not paged: a handful a term. A cancelled
   * class is left out (decision 0510, point 7): only the Coordinator's *Cancelled* lists one.
   */
  async classes(query: EquippingTermDto): Promise<Record<string, unknown>> {
    const rows = await this.classRows(query, false);
    return { data: await this.withTeachers(rows) };
  }

  private async classRows(query: EquippingTermDto, withCancelled: boolean) {
    return this.db
      .selectFrom('equipping_classes as c')
      .select((eb) => [
        'c.id',
        'c.name',
        'c.level',
        'c.day_of_week',
        'c.time_of_day',
        'c.place',
        'c.first_lesson_on',
        'c.teacher_person_id',
        'c.encounter_season_id',
        'c.run_by',
        eb
          .selectFrom('equipping_enrollments as e')
          .select(sql<number>`count(*)::int`.as('n'))
          .whereRef('e.class_id', '=', 'c.id')
          .where('e.ended_at', 'is', null)
          .as('enrolled'),
        'c.cancelled_at',
        'c.cancel_reason',
        eb
          .exists(
            eb
              .selectFrom('equipping_lessons as l')
              .select('l.id')
              .whereRef('l.class_id', '=', 'c.id'),
          )
          .as('lesson_saved'),
      ])
      .where('c.level', '=', query.level)
      .where('c.term_year', '=', query.term_year)
      .where('c.term_number', '=', query.term_number)
      .$if(!withCancelled, (qb) => qb.where('c.cancelled_at', 'is', null))
      .orderBy(sql`lower(c.name)`)
      .execute();
  }

  private async withTeachers(
    rows: Awaited<ReturnType<EquippingService['classRows']>>,
  ): Promise<Record<string, unknown>[]> {
    const teachers = await this.people.forDecisions(
      rows.flatMap((row) => (row.teacher_person_id === null ? [] : [row.teacher_person_id])),
    );
    return rows.map((row) => ({
      ...this.classShape(row),
      teacher:
        row.teacher_person_id === null
          ? null
          : {
              id: row.teacher_person_id,
              full_name: teachers.get(row.teacher_person_id)?.fullName ?? null,
            },
      enrolled: Number(row.enrolled ?? 0),
    }));
  }

  /**
   * A level's classes in a term as the Coordinator's *Classes* lists them (decision 0501,
   * point 22): each with its Teacher, or none yet, how many are enrolled, and whether it has
   * started. Guides and attendance join it with the steps that build them.
   */
  async coordinatorClasses(
    query: EquippingTermDto,
    actor: Actor,
  ): Promise<Record<string, unknown>> {
    const rows = await this.classRows(query, true);
    const shaped = await this.withTeachers(rows);
    const live = rows.filter((row) => row.cancelled_at === null);
    const today = await this.manilaToday();
    const staffing = await this.staffingOf(live.map((row) => row.id));
    // The lessons late, said in words on the Coordinator's *Attendance* (decision 0501, point 22),
    // each level by its own lessons: SOL's ten since its register is built (decision 0514).
    const problems = await this.attendance.lessonProblemsOf(
      live.map((row) => ({
        id: row.id,
        level: row.level,
        first_lesson_on: String(row.first_lesson_on),
      })),
    );
    return {
      // The level's other Coordinators, for the subtitle (decision 0514).
      other_coordinators: await this.otherCoordinatorsOf(actor, query.level),
      data: rows.map((row, index) => {
        const base = {
          ...shaped[index],
          // Whether *When and where* and *Cancel class* are still offered (decision 0510).
          lesson_saved: Boolean(row.lesson_saved),
        };
        if (row.cancelled_at !== null) {
          return {
            ...base,
            status: 'CANCELLED',
            cancelled_on: manilaDayOf(row.cancelled_at),
            cancel_reason: row.cancel_reason,
          };
        }
        return {
          ...base,
          status: String(row.first_lesson_on) > today ? 'NOT_STARTED' : 'RUNNING',
          guides: staffing.get(row.id) ?? { named: 0, short_men: 0, short_women: 0 },
          lessons: problems.get(row.id) ?? { late: [], not_recorded: [] },
        };
      }),
    };
  }

  /** Who is enrolled in one class, for the Coordinator's *Students* (decision 0501, point 22). */
  async coordinatorClassStudents(classId: string): Promise<Record<string, unknown>> {
    const cls = await this.db
      .selectFrom('equipping_classes')
      .select(['id', 'name'])
      .where('id', '=', classId)
      .executeTakeFirst();
    if (cls === undefined) {
      throw new NotFoundError('No such class.');
    }
    const enrolled = await this.db
      .selectFrom('equipping_enrollments as e')
      .innerJoin('equipping_registrations as r', 'r.id', 'e.registration_id')
      .select(['r.person_id', 'e.id as enrollment_id'])
      .where('e.class_id', '=', classId)
      .where('e.ended_at', 'is', null)
      .execute();
    const ids = enrolled.map((row) => row.person_id);
    const guides = await this.openGuidesOf(this.db, classId);
    const pairings = await this.openPairingsOf(this.db, classId);
    const cells = await this.cells.currentCellsOfMany(ids);
    const leaderIds = [...cells.values()].flatMap((c) =>
      c.membership?.leaderId ? [c.membership.leaderId] : [],
    );
    const [people, sexes] = await Promise.all([
      this.people.forDecisions([...ids, ...guides.map((g) => g.person_id), ...leaderIds]),
      this.people.sexesOf(ids),
    ]);
    const nameOf = (id: string) => people.get(id)?.fullName ?? null;
    const guideById = new Map(guides.map((g) => [g.id, g]));
    const enrollmentOf = new Map(
      enrolled.map((row) => [canonicalId(row.person_id), row.enrollment_id]),
    );
    return {
      class: { id: cls.id, name: cls.name },
      // The class's Guides, for *Swap Guide*, each with the sex of the students they follow up.
      guides: guides
        .map((g) => ({
          id: g.id,
          person: schoolPerson(g.person_id, people),
          sex: g.sex,
          // Archived since being named: keeps their students, takes no new ones (decision 0502).
          archived: g.archived,
        }))
        // Last-name order, as every school list (decision 0515).
        .sort(bySchoolName(people)),
      data: ids
        .map((id) => {
          const enrollmentId = enrollmentOf.get(canonicalId(id))!;
          const guide = guideById.get(pairings.get(enrollmentId) ?? '');
          const leaderId = cells.get(id)?.membership?.leaderId ?? null;
          return {
            enrollment_id: enrollmentId,
            person: schoolPerson(id, people),
            sex: sexes.get(canonicalId(id)) ?? null,
            // Shown to the Coordinator for every student, whatever branch (owner, 2026-11-20).
            cell_leader: leaderId === null ? null : { id: leaderId, full_name: nameOf(leaderId) },
            guide: guide ? { id: guide.id, full_name: nameOf(guide.person_id) } : null,
          };
        })
        .sort(bySchoolName(people)),
    };
  }

  /**
   * Whether a class fits a person's week (decision 0501, point 2): a clash with a Cell they
   * lead now under the two-hour rule (decision 0392). **It warns and never refuses** (owner,
   * 2026-11-20): the Coordinator knows whether that Cell has moved or has another facilitator.
   * It names that Cell's day and time (decision 0501, point 2, owner 2026-11-20), an accepted
   * disclosure of a piece with the Cell leader shown on a class's pages.
   *
   * **Asked of a class that exists and of somebody who may teach it**, never of a day and time
   * the caller chooses: the accepted disclosure is why a chosen Teacher clashes with a class,
   * and a free day and time would let a Coordinator read any leader's whole week, a probe at a
   * time. Somebody who may not teach is answered with no clash, as the search never offers them.
   */
  async teacherClash(
    actor: Actor,
    classId: string,
    personId: string,
  ): Promise<Record<string, unknown>> {
    const cls = await this.db
      .selectFrom('equipping_classes')
      .select(['day_of_week', 'time_of_day'])
      .where('id', '=', classId)
      .executeTakeFirst();
    if (cls === undefined) {
      throw new NotFoundError('No such class.');
    }
    const id = canonicalId(personId);
    const mayTeach = await this.mayTeachWithin(this.db, [id]);
    const clash = mayTeach.has(id)
      ? await this.clashOf(id, cls.day_of_week, String(cls.time_of_day))
      : null;
    // Whether they can record the class's attendance (decision 0503, owner ruling of
    // 2026-11-20): a Teacher with no working account cannot, which the Coordinator is warned of
    // and is free to save past.
    const account = mayTeach.has(id)
      ? ((await this.authorization.accountStatusOf(id)) ?? 'NONE')
      : null;
    // Every check is recorded, a clash or not, so the log shows who was asked about.
    await this.db.transaction().execute((trx) =>
      this.audit.writeWithin(trx, {
        actorId: actor.accountId,
        action: 'equipping_class.clash_checked',
        targetType: 'equipping_class',
        targetId: classId,
        after: { person_id: id, clash: clash !== null },
      }),
    );
    return { clash, account };
  }

  private async clashOf(
    personId: string,
    dayOfWeek: number,
    timeOfDay: string,
  ): Promise<{ day_of_week: number; time_of_day: string } | null> {
    const slots = await this.cells.slotsLedBy(personId);
    const hit = slots.find((slot) => slotsClash(slot, { dayOfWeek, timeOfDay }));
    return hit === undefined
      ? null
      : { day_of_week: hit.dayOfWeek, time_of_day: hit.timeOfDay.slice(0, 5) };
  }

  private async manilaToday(): Promise<string> {
    const row = await sql<{ d: string }>`
      SELECT to_char((now() AT TIME ZONE 'Asia/Manila')::date, 'YYYY-MM-DD') AS d`.execute(this.db);
    return row.rows[0].d;
  }

  /**
   * One class: its details, who is enrolled, and who is ready to enroll — registered for its
   * level and term, not cancelled, in no class — each with the two checks enrolling makes.
   */
  async classDetail(classId: string): Promise<Record<string, unknown>> {
    const cls = await this.db
      .selectFrom('equipping_classes')
      .selectAll()
      .where('id', '=', classId)
      .executeTakeFirst();
    if (cls === undefined) {
      throw new NotFoundError('No such class.');
    }
    // Reached only by an old link: Enrollment lists no cancelled class (decision 0510).
    this.assertNotCancelled(cls);

    const enrolled = await this.db
      .selectFrom('equipping_enrollments as e')
      .innerJoin('equipping_registrations as r', 'r.id', 'e.registration_id')
      .select(['e.id as enrollment_id', 'r.id as registration_id', 'r.person_id'])
      .where('e.class_id', '=', classId)
      .where('e.ended_at', 'is', null)
      .execute();

    const ready = await this.db
      .selectFrom('equipping_registrations as r')
      .select(['r.id', 'r.person_id', 'r.unmet'])
      .where('r.level', '=', cls.level)
      .where('r.term_year', '=', cls.term_year)
      .where('r.term_number', '=', cls.term_number)
      .where('r.cancelled_at', 'is', null)
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom('equipping_enrollments as e')
              .select('e.id')
              .whereRef('e.registration_id', '=', 'r.id')
              .where('e.ended_at', 'is', null),
          ),
        ),
      )
      // Graded Passed or Not passed, the registration is finished (decision 0513, point 16).
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom('equipping_enrollments as e')
              .innerJoin('equipping_current_grades as g', 'g.enrollment_id', 'e.id')
              .select('e.id')
              .whereRef('e.registration_id', '=', 'r.id')
              .where('g.grade', 'in', ['PASSED', 'NOT_PASSED']),
          ),
        ),
      )
      .orderBy('r.registered_at')
      .execute();

    const ids = [...enrolled.map((row) => row.person_id), ...ready.map((row) => row.person_id)];
    const [people, leaderNames, eligibility, tries] = await Promise.all([
      this.people.forDecisions(
        cls.teacher_person_id === null ? ids : [...ids, cls.teacher_person_id],
      ),
      this.people.directLeaderNamesOf(ids),
      this.eligibilityOf(
        ready.map((row) => row.person_id),
        cls.encounter_season_id,
      ),
      this.earlierTriesOf(
        ready.map((row) => row.person_id),
        cls.level,
      ),
    ]);
    const [joining, lesson6] = await Promise.all([
      this.lesson6SourcesOf(
        this.db,
        ready.map((row) => row.person_id),
        cls.level,
        cls,
      ),
      this.lesson6Within(this.db, classId),
    ]);
    const nameOf = (id: string) => people.get(id)?.fullName ?? null;

    return {
      class: {
        ...this.classShape(cls),
        level: cls.level,
        term_year: cls.term_year,
        term_number: cls.term_number,
        teacher:
          cls.teacher_person_id === null
            ? null
            : { id: cls.teacher_person_id, full_name: nameOf(cls.teacher_person_id) },
        encounter_weekends: eligibility.weekends,
        // Whether it takes a student at Lesson 6, and on which day that lesson is expected: Life
        // Class's alone (decision 0512); a SOL 1 class has none (decision 0514).
        lesson_6: cls.level === 'LIFE_CLASS' ? lesson6 : null,
      },
      enrolled: enrolled
        .map((row) => ({
          enrollment_id: row.enrollment_id,
          registration_id: row.registration_id,
          person: schoolPerson(row.person_id, people),
        }))
        // Last-name order, as every school list (decision 0515).
        .sort(bySchoolName(people)),
      ready: ready
        .map((row) => {
          const check = eligibility.byPerson.get(canonicalId(row.person_id))!;
          return {
            registration_id: row.id,
            person: schoolPerson(row.person_id, people),
            leader_name: leaderNames.get(row.person_id) ?? null,
            with_exception: row.unmet.length > 0,
            birthday_recorded: check.birthDate !== null,
            age_at_encounter: check.age,
            blocked: check.blocked,
            try_number: 1 + triesBefore(tries.get(canonicalId(row.person_id)), cls),
            joins_at_lesson_6: ((source) =>
              source === undefined
                ? null
                : {
                    class_name: source.className,
                    term_year: source.termYear,
                    term_number: source.termNumber,
                  })(joining.get(canonicalId(row.person_id))),
          };
        })
        .sort(bySchoolName(people)),
    };
  }

  // ---------------------------------------------------------------------------
  // Writes
  // ---------------------------------------------------------------------------

  /** `POST /equipping/registrations` (decision 0499, points 5 to 7). */
  async register(
    actor: Actor,
    body: RegisterDto,
    claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    // Two ticks since the owner withdrew the devotion tick on 2026-11-18 (decision 0499, point 6).
    // SOL has no Bible tick, and its manual or book warns rather than refuses (decisions 0514
    // and 0516).
    if (body.level === 'LIFE_CLASS') {
      for (const field of ['bible_confirmed', 'manual_confirmed'] as const) {
        if (body[field] !== true) {
          throw new ValidationFailedError(
            'A physical Bible and the Life Class Manual are each ticked before registering.',
            { field },
          );
        }
      }
    }

    const person = await this.people.forDecision(body.person_id);
    if (!person || person.mergedIntoId !== null) {
      throw new NotFoundError('No such person.');
    }
    if (person.isArchived) {
      throw new InvariantViolationError('That person is archived, so is not registered.', {
        person_id: body.person_id,
      });
    }
    const personId = canonicalId(person.id);

    const checks = (await this.requirementsOf([personId], body.level)).get(personId) ?? [];
    const unmet: EquippingRequirement[] = checks
      .filter((check) => !check.met)
      .map((check) => check.code);
    if (body.level === 'SOL_1' && !body.manual_confirmed) {
      unmet.push('SOL_1_MANUAL');
    }
    if (body.level === 'SOL_2' && !body.manual_confirmed) {
      unmet.push('SOL_2_BOOK');
    }
    if (body.level === 'SOL_3' && !body.manual_confirmed) {
      unmet.push('SOL_3_BOOK');
    }
    const reason = body.exception_reason?.trim() || null;
    if (unmet.length > 0 && reason === null) {
      throw new ValidationFailedError(
        'A requirement is not met, so say why they are registered anyway.',
        { field: 'exception_reason', unmet },
      );
    }

    // Before the transaction, so it holds one pool connection (section 24). A Registrar record
    // is made with its account and never becomes one later, so there is nothing to race.
    if (await this.isEquippingRecord(personId)) {
      throw new NotFoundError('No such person.');
    }

    return this.write(async (trx) => {
      // **The Person's lock, which archive and merge take too** (section 24, lock then decide):
      // without it a registration could commit for somebody archived or merged away at the same
      // moment, after the archive found nothing to close. Decided again under the lock.
      await lockPersonsWithin(trx, [personId]);
      const locked = await this.people.forDecisionWithin(trx, personId);
      if (!locked || locked.mergedIntoId !== null) {
        throw new NotFoundError('No such person.');
      }
      if (locked.isArchived) {
        throw new InvariantViolationError('That person is archived, so is not registered.', {
          person_id: personId,
        });
      }

      const row = await trx
        .insertInto('equipping_registrations')
        .values({
          person_id: personId,
          level: body.level,
          term_year: body.term_year,
          term_number: body.term_number,
          bible_confirmed: body.level === 'LIFE_CLASS',
          manual_confirmed: body.level === 'LIFE_CLASS' || body.manual_confirmed,
          unmet,
          // A reason is kept only where something was unmet; the row says nothing else.
          exception_reason: unmet.length > 0 ? reason : null,
          note: body.note?.trim() || null,
          registered_by: actor.accountId,
        })
        .returning(['id', 'registered_at'])
        .executeTakeFirstOrThrow();

      const response = {
        id: row.id,
        person: { id: personId, member_id: person.memberId, full_name: person.fullName },
        level: body.level,
        term_year: body.term_year,
        term_number: body.term_number,
        status: unmet.length > 0 ? 'REGISTERED_WITH_EXCEPTION' : 'REGISTERED',
        unmet,
        exception_reason: unmet.length > 0 ? reason : null,
        registered_at: row.registered_at.toISOString(),
      };

      await this.audit.writeWithin(trx, {
        actorId: actor.accountId,
        action: 'equipping_registration.created',
        targetType: 'person',
        targetId: personId,
        before: null,
        after: {
          registration_id: row.id,
          level: body.level,
          term: `${body.term_year}-${body.term_number}`,
          unmet,
          exception_reason: response.exception_reason,
        },
      });

      // Last statement in the transaction (CLAUDE.md, *Write endpoints*).
      await this.idempotency.completeWithin(trx, { ...claim, status: 201, body: response });
      return response;
    });
  }

  /** `POST /equipping/registrations/{id}/cancel`: refused while the person is in a class. */
  async cancel(
    actor: Actor,
    registrationId: string,
    reason: string,
    claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    return this.write(async (trx) => {
      const row = await trx
        .selectFrom('equipping_registrations')
        .select(['id', 'person_id', 'cancelled_at', 'unmet'])
        .where('id', '=', registrationId)
        .forUpdate()
        .executeTakeFirst();
      if (row === undefined) {
        throw new NotFoundError('No such registration.');
      }
      if (row.cancelled_at !== null) {
        throw new InvariantViolationError('That registration is already cancelled.', {
          registration_id: registrationId,
        });
      }
      const open = await trx
        .selectFrom('equipping_enrollments')
        .select('id')
        .where('registration_id', '=', registrationId)
        .where('ended_at', 'is', null)
        .executeTakeFirst();
      if (open !== undefined) {
        throw new InvariantViolationError(
          'They are in a class. Withdraw them from it first, then cancel the registration.',
          { registration_id: registrationId },
        );
      }

      await trx
        .updateTable('equipping_registrations')
        .set({
          cancelled_at: sql<Date>`now()`,
          cancelled_by: actor.accountId,
          cancel_reason: reason.trim(),
        })
        .where('id', '=', registrationId)
        .execute();

      await this.audit.writeWithin(trx, {
        actorId: actor.accountId,
        action: 'equipping_registration.cancelled',
        targetType: 'person',
        targetId: row.person_id,
        before: {
          registration_id: registrationId,
          status: row.unmet.length > 0 ? 'REGISTERED_WITH_EXCEPTION' : 'REGISTERED',
        },
        after: { registration_id: registrationId, status: 'CANCELLED', reason: reason.trim() },
      });

      const response = { id: registrationId, status: 'CANCELLED', cancel_reason: reason.trim() };
      await this.idempotency.completeWithin(trx, { ...claim, status: 200, body: response });
      return response;
    });
  }

  /** `POST /equipping/classes` (decision 0499, point 10). */
  async openClass(
    actor: Actor,
    body: OpenClassDto,
    claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    await this.assertCoordinatesLevel(actor, body.level);
    const teacher =
      body.teacher_person_id === undefined ? null : await this.teacherOf(body.teacher_person_id);
    // Life Class names its Encounter weekend; SOL has no Encounter (decision 0514).
    if (body.level === 'LIFE_CLASS') {
      const seasons = await this.seasons.allSeasons();
      if (!seasons.some((season) => season.id === body.encounter_season_id)) {
        throw new NotFoundError('No such Encounter season.');
      }
    } else if (body.encounter_season_id !== undefined) {
      throw new ValidationFailedError(`${LEVEL_NAMES[body.level]} has no Encounter weekend.`, {
        field: 'encounter_season_id',
      });
    }

    return this.write(async (trx) => {
      // Opening a SOL class makes its level the school's in Training (decision 0514, point 13;
      // decision 0516, point 1), after any leader's save of a SOL level already under way.
      if (body.level !== 'LIFE_CLASS') {
        await lockSolOpeningWithin(trx);
      }
      if (teacher !== null) {
        await this.assertMayTeachWithin(trx, teacher.id);
      }
      const row = await trx
        .insertInto('equipping_classes')
        .values({
          level: body.level,
          term_year: body.term_year,
          term_number: body.term_number,
          name: body.name.trim(),
          day_of_week: body.day_of_week,
          time_of_day: body.time_of_day,
          place: body.place?.trim() || null,
          first_lesson_on: body.first_lesson_on,
          teacher_person_id: teacher === null ? null : canonicalId(teacher.id),
          encounter_season_id: body.level === 'LIFE_CLASS' ? body.encounter_season_id! : null,
          created_by: actor.accountId,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      const response = {
        ...this.classShape(row),
        level: row.level,
        term_year: row.term_year,
        term_number: row.term_number,
        teacher:
          teacher === null ? null : { id: row.teacher_person_id, full_name: teacher.fullName },
        enrolled: 0,
        // A Teacher named on opening is checked against their week as on Edit (decision 0501).
        clash:
          teacher === null
            ? null
            : await this.clashOf(canonicalId(teacher.id), row.day_of_week, String(row.time_of_day)),
        // And whether they can record it, as on Edit (decision 0503).
        account:
          teacher === null
            ? null
            : ((await this.authorization.accountStatusOf(canonicalId(teacher.id))) ?? 'NONE'),
      };

      await this.audit.writeWithin(trx, {
        actorId: actor.accountId,
        action: 'equipping_class.created',
        targetType: 'equipping_class',
        targetId: row.id,
        before: null,
        after: {
          level: row.level,
          term: `${row.term_year}-${row.term_number}`,
          name: row.name,
          teacher_person_id: row.teacher_person_id,
        },
      });

      await this.idempotency.completeWithin(trx, { ...claim, status: 201, body: response });
      return response;
    });
  }

  /**
   * `POST /equipping/classes/{id}/teacher` (decision 0501, point 2): the Coordinator names or
   * changes a class's Teacher, who must be a current Cell Leader in the tree when named
   * (decision 0499, point 10). A clash with their own Cell is answered as a warning beside the
   * saved class, never a refusal (owner, 2026-11-20).
   */
  async setTeacher(
    actor: Actor,
    classId: string,
    teacherPersonId: string,
    claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    const teacher = await this.teacherOf(teacherPersonId);
    return this.write(async (trx) => {
      const cls = await trx
        .selectFrom('equipping_classes')
        .selectAll()
        .where('id', '=', classId)
        .forUpdate()
        .executeTakeFirst();
      if (cls === undefined) {
        throw new NotFoundError('No such class.');
      }
      this.assertNotCancelled(cls);
      await this.assertMayTeachWithin(trx, teacher.id);
      const id = canonicalId(teacher.id);
      if (cls.teacher_person_id !== id) {
        await trx
          .updateTable('equipping_classes')
          .set({ teacher_person_id: id })
          .where('id', '=', classId)
          .execute();
        await this.audit.writeWithin(trx, {
          actorId: actor.accountId,
          action: 'equipping_class.teacher_named',
          targetType: 'equipping_class',
          targetId: classId,
          before: { teacher_person_id: cls.teacher_person_id },
          after: { teacher_person_id: id },
        });
      }
      const response = {
        id: classId,
        teacher: { id, full_name: teacher.fullName },
        clash: await this.clashOf(id, cls.day_of_week, String(cls.time_of_day)),
      };
      await this.idempotency.completeWithin(trx, { ...claim, status: 200, body: response });
      return response;
    });
  }

  /**
   * `POST /equipping/classes/{id}/correction` (decision 0510, points 1 and 2): the Coordinator
   * corrects a class's day, time, place and first lesson until a lesson of it is saved. The
   * correction keeps the values it replaced, a save that changes nothing writes nothing, and the
   * Teacher's week is checked again, a clash warning and never refusing.
   */
  async correctClass(
    actor: Actor,
    classId: string,
    body: CorrectClassDto,
    claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    return this.write(async (trx) => {
      const cls = await trx
        .selectFrom('equipping_classes')
        .selectAll()
        .where('id', '=', classId)
        .forNoKeyUpdate()
        .executeTakeFirst();
      if (cls === undefined) {
        throw new NotFoundError('No such class.');
      }
      this.assertNotCancelled(cls);
      await this.assertNoLessonWithin(
        trx,
        cls,
        'so its day, time, place and first lesson no longer change',
      );

      const before = {
        day_of_week: cls.day_of_week,
        time_of_day: String(cls.time_of_day).slice(0, 5),
        place: cls.place,
        first_lesson_on: String(cls.first_lesson_on),
      };
      const after = {
        day_of_week: body.day_of_week,
        time_of_day: body.time_of_day,
        place: body.place?.trim() || null,
        first_lesson_on: body.first_lesson_on,
      };
      const changed =
        before.day_of_week !== after.day_of_week ||
        before.time_of_day !== after.time_of_day ||
        before.place !== after.place ||
        before.first_lesson_on !== after.first_lesson_on;

      if (changed) {
        // The record first: the database refuses the change without it (migration 0057).
        await trx
          .insertInto('equipping_class_corrections')
          .values({
            class_id: classId,
            day_of_week_before: before.day_of_week,
            day_of_week_after: after.day_of_week,
            time_of_day_before: before.time_of_day,
            time_of_day_after: after.time_of_day,
            place_before: before.place,
            place_after: after.place,
            first_lesson_on_before: before.first_lesson_on,
            first_lesson_on_after: after.first_lesson_on,
            corrected_by: actor.accountId,
          })
          .execute();
        await trx.updateTable('equipping_classes').set(after).where('id', '=', classId).execute();
        await this.audit.writeWithin(trx, {
          actorId: actor.accountId,
          action: 'equipping_class.corrected',
          targetType: 'equipping_class',
          targetId: classId,
          before,
          after,
        });
      }

      const response = {
        ...this.classShape({ ...cls, ...after }),
        corrected: changed,
        clash:
          cls.teacher_person_id === null
            ? null
            : await this.clashOf(cls.teacher_person_id, after.day_of_week, after.time_of_day),
      };
      await this.idempotency.completeWithin(trx, { ...claim, status: 200, body: response });
      return response;
    });
  }

  /**
   * `POST /equipping/classes/{id}/cancel` (decision 0510, points 3 to 6): a class is cancelled,
   * never deleted, and only while nobody is enrolled and no lesson is saved. It is final, and
   * the Guides still named on it are closed with it.
   */
  async cancelClass(
    actor: Actor,
    classId: string,
    reason: string,
    claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    return this.write(async (trx) => {
      // FOR NO KEY UPDATE, the mode an enrollment, a lesson save and a Guide take on the class,
      // so each waits behind this or this behind it, and the reads below see what it committed.
      const cls = await trx
        .selectFrom('equipping_classes')
        .select(['id', 'name', 'first_lesson_on', 'cancelled_at'])
        .where('id', '=', classId)
        .forNoKeyUpdate()
        .executeTakeFirst();
      if (cls === undefined) {
        throw new NotFoundError('No such class.');
      }
      if (cls.cancelled_at !== null) {
        throw new InvariantViolationError(`${cls.name} is already cancelled.`, {
          field: 'class_id',
        });
      }
      const enrolled = await trx
        .selectFrom('equipping_enrollments')
        .select(sql<number>`count(*)::int`.as('n'))
        .where('class_id', '=', classId)
        .where('ended_at', 'is', null)
        .executeTakeFirstOrThrow();
      const n = Number(enrolled.n);
      if (n > 0) {
        throw new InvariantViolationError(
          `${n} ${n === 1 ? 'student is' : 'students are'} enrolled in ${cls.name}. A class is cancelled only while it has no students.`,
          { field: 'class_id' },
        );
      }
      await this.assertNoLessonWithin(trx, cls, 'so it can no longer be cancelled');

      // The Guides still named are closed with it (point 6), never deleted; with no student
      // enrolled none has an open pairing, which removing one requires (migration 0052).
      const closed = await trx
        .updateTable('equipping_class_guides')
        .set({ removed_at: sql<Date>`now()`, removed_by: actor.accountId })
        .where('class_id', '=', classId)
        .where('removed_at', 'is', null)
        .returning('person_id')
        .execute();

      const row = await trx
        .updateTable('equipping_classes')
        .set({
          cancelled_at: sql<Date>`now()`,
          cancelled_by: actor.accountId,
          cancel_reason: reason.trim(),
        })
        .where('id', '=', classId)
        .returning('cancelled_at')
        .executeTakeFirstOrThrow();
      await this.audit.writeWithin(trx, {
        actorId: actor.accountId,
        action: 'equipping_class.cancelled',
        targetType: 'equipping_class',
        targetId: classId,
        // The status *Classes* showed it under, as `coordinatorClasses` derives it.
        before: {
          class_name: cls.name,
          // Read on the transaction's own connection and clock, not a second one from the pool.
          status:
            String(cls.first_lesson_on) > manilaDayOf(await databaseNow(trx))
              ? 'NOT_STARTED'
              : 'RUNNING',
        },
        after: {
          class_name: cls.name,
          status: 'CANCELLED',
          reason: reason.trim(),
          guides_removed: closed.map((guide) => guide.person_id),
        },
      });

      const response = {
        id: classId,
        status: 'CANCELLED',
        cancelled_on: manilaDayOf(row.cancelled_at as Date),
        cancel_reason: reason.trim(),
      };
      await this.idempotency.completeWithin(trx, { ...claim, status: 200, body: response });
      return response;
    });
  }

  /** A cancelled class is final (decision 0510, point 5). */
  private assertNotCancelled(cls: { name: string; cancelled_at: Date | null }): void {
    if (cls.cancelled_at !== null) {
      throw new InvariantViolationError(`${cls.name} was cancelled; nothing on it changes.`, {
        field: 'class_id',
      });
    }
  }

  private async assertNoLessonWithin(
    trx: Transaction<Database>,
    cls: { id: string; name: string },
    consequence: string,
  ): Promise<void> {
    const lesson = await trx
      .selectFrom('equipping_lessons')
      .select('lesson')
      .where('class_id', '=', cls.id)
      .orderBy('lesson')
      .executeTakeFirst();
    if (lesson !== undefined) {
      throw new InvariantViolationError(
        `Lesson ${lesson.lesson} of ${cls.name} is saved, ${consequence}.`,
        { field: 'class_id' },
      );
    }
  }

  /** The Teacher a request names: a current Person, never the Registrar record (point 13). */
  private async teacherOf(personId: string): Promise<{ id: string; fullName: string }> {
    const teacher = await this.people.forDecision(personId);
    if (!teacher || teacher.mergedIntoId !== null || (await this.isEquippingRecord(personId))) {
      throw new NotFoundError('No such person to be the Teacher.');
    }
    if (teacher.isArchived) {
      throw new InvariantViolationError('That person is archived, so cannot teach a class.', {
        field: 'teacher_person_id',
      });
    }
    return { id: teacher.id, fullName: teacher.fullName };
  }

  private async assertMayTeachWithin(trx: Transaction<Database>, personId: string): Promise<void> {
    const mayTeach = await this.mayTeachWithin(trx, [canonicalId(personId)]);
    if (!mayTeach.has(canonicalId(personId))) {
      throw new InvariantViolationError(
        'Only a current Cell Leader in the tree may teach a class.',
        {
          field: 'teacher_person_id',
        },
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Guides (decision 0501, points 4 and 8)
  // ---------------------------------------------------------------------------

  /**
   * `POST /equipping/classes/{id}/guides`: the Coordinator names a Guide, who must be one level
   * ahead and a member of the tree when named (owner, 2026-11-20, refused otherwise), and DREAMS
   * shares out the students who have no Guide yet.
   */
  async nameGuide(
    actor: Actor,
    classId: string,
    personId: string,
    claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    const person = await this.people.forDecision(personId);
    if (!person || person.mergedIntoId !== null || (await this.isEquippingRecord(personId))) {
      throw new NotFoundError('No such person to be a Guide.');
    }
    if (person.isArchived) {
      throw new InvariantViolationError('That person is archived, so cannot guide a class.', {
        field: 'person_id',
      });
    }
    return this.write(async (trx) => {
      const cls = await this.lockClassWithin(trx, classId);
      const id = canonicalId(person.id);
      const may = await this.mayGuideWithin(trx, [id], cls.level);
      if (!may.has(id)) {
        throw new InvariantViolationError(
          `A ${LEVEL_NAMES[cls.level]} Guide has passed ` +
            `${guidingPrograms(cls.level)[0].replace('_', ' ')}` +
            (cls.level === 'SOL_3'
              ? `, has ${GUIDE_CELL_LEADERS} of their own disciples each leading a Cell,`
              : '') +
            ' and is in the tree (SKILL.md section 29).',
          { field: 'person_id' },
        );
      }
      const already = await trx
        .selectFrom('equipping_class_guides')
        .select('id')
        .where('class_id', '=', classId)
        .where('person_id', '=', id)
        .where('removed_at', 'is', null)
        .executeTakeFirst();
      if (already) {
        throw new InvariantViolationError('They are already a Guide of this class.', {
          field: 'person_id',
        });
      }
      const guide = await trx
        .insertInto('equipping_class_guides')
        .values({ class_id: classId, person_id: id, named_by: actor.accountId })
        .returning('id')
        .executeTakeFirstOrThrow();
      await this.audit.writeWithin(trx, {
        actorId: actor.accountId,
        action: 'equipping_class.guide_named',
        targetType: 'equipping_class',
        targetId: classId,
        before: null,
        after: { guide_person_id: id },
      });
      await this.shareOutWithin(trx, actor, classId);
      const response = {
        class_id: classId,
        guide_id: guide.id,
        person: { id, full_name: person.fullName },
      };
      await this.idempotency.completeWithin(trx, { ...claim, status: 201, body: response });
      return response;
    });
  }

  /**
   * `POST /equipping/classes/{id}/guides/{guideId}/remove`: the Guide leaves the class, their
   * row kept, and their students are shared out among those left.
   */
  async removeGuide(
    actor: Actor,
    classId: string,
    guideId: string,
    claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    return this.write(async (trx) => {
      await this.lockClassWithin(trx, classId);
      const guide = await trx
        .selectFrom('equipping_class_guides')
        .select(['id', 'person_id'])
        .where('id', '=', guideId)
        .where('class_id', '=', classId)
        .where('removed_at', 'is', null)
        .executeTakeFirst();
      if (!guide) {
        throw new NotFoundError('No such Guide in this class.');
      }
      // **The students' enrollments are locked before their pairings**, the order a withdrawal,
      // a move or an archive takes (the enrollment, then its pairing by the trigger that ends
      // it), so a removal beside one of them waits rather than deadlocking. A pairing ended
      // meanwhile is then skipped by the update below.
      await trx
        .selectFrom('equipping_enrollments')
        .select('id')
        .where(
          'id',
          'in',
          trx
            .selectFrom('equipping_guide_students')
            .select('enrollment_id')
            .where('guide_id', '=', guideId)
            .where('ended_at', 'is', null),
        )
        .orderBy('id')
        .forShare()
        .execute();
      await trx
        .updateTable('equipping_guide_students')
        .set({ ended_at: sql<Date>`now()`, ended_by: actor.accountId, end_reason: 'GUIDE_REMOVED' })
        .where('guide_id', '=', guideId)
        .where('ended_at', 'is', null)
        .execute();
      await trx
        .updateTable('equipping_class_guides')
        .set({ removed_at: sql<Date>`now()`, removed_by: actor.accountId })
        .where('id', '=', guideId)
        .execute();
      await this.audit.writeWithin(trx, {
        actorId: actor.accountId,
        action: 'equipping_class.guide_removed',
        targetType: 'equipping_class',
        targetId: classId,
        before: { guide_person_id: guide.person_id },
        after: null,
      });
      await this.shareOutWithin(trx, actor, classId);
      const response = { class_id: classId, removed: guideId };
      await this.idempotency.completeWithin(trx, { ...claim, status: 200, body: response });
      return response;
    });
  }

  /**
   * `POST /equipping/enrollments/{id}/guide`: *Swap Guide*, to another Guide of the same class
   * who follows up students of the student's sex (decision 0501, point 8).
   */
  async swapGuide(
    actor: Actor,
    enrollmentId: string,
    guideId: string,
    claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    return this.write(async (trx) => {
      // **The class is locked before the enrollment**, the order naming and removing a Guide and
      // enrolling take (they lock the class, then sharing out reads each enrollment), so a swap
      // run beside one of them waits rather than deadlocking. An enrollment's class never
      // changes, so reading it before the lock is safe.
      const placed = await trx
        .selectFrom('equipping_enrollments')
        .select('class_id')
        .where('id', '=', enrollmentId)
        .executeTakeFirst();
      if (placed) {
        await this.lockClassWithin(trx, placed.class_id);
      }
      const enrollment = await this.openEnrollmentWithin(trx, enrollmentId);
      const guide = await trx
        .selectFrom('equipping_class_guides')
        .select(['id', 'person_id'])
        .where('id', '=', guideId)
        .where('class_id', '=', enrollment.class_id)
        .where('removed_at', 'is', null)
        .executeTakeFirst();
      if (!guide) {
        throw new NotFoundError('No such Guide in this class.');
      }
      const archived = await this.people.archivedAtWithin(trx, [guide.person_id], new Date());
      if (archived.size > 0) {
        throw new InvariantViolationError(
          'An archived Guide takes no new students (decision 0502).',
          { field: 'guide_id' },
        );
      }
      const sexes = await this.people.sexesOf([enrollment.person_id, guide.person_id]);
      if (
        sexes.get(canonicalId(enrollment.person_id)) !== sexes.get(canonicalId(guide.person_id))
      ) {
        throw new InvariantViolationError(
          'A Guide follows up students of their own sex (SKILL.md section 29).',
          { field: 'guide_id' },
        );
      }
      const current = await trx
        .selectFrom('equipping_guide_students as gs')
        .innerJoin('equipping_class_guides as g', 'g.id', 'gs.guide_id')
        .select(['gs.id', 'gs.guide_id', 'g.person_id'])
        .where('gs.enrollment_id', '=', enrollmentId)
        .where('gs.ended_at', 'is', null)
        .executeTakeFirst();
      if (current?.guide_id !== guideId) {
        if (current) {
          await trx
            .updateTable('equipping_guide_students')
            .set({ ended_at: sql<Date>`now()`, ended_by: actor.accountId, end_reason: 'SWAPPED' })
            .where('id', '=', current.id)
            .execute();
        }
        await trx
          .insertInto('equipping_guide_students')
          .values({ enrollment_id: enrollmentId, guide_id: guideId, started_by: actor.accountId })
          .execute();
        await this.audit.writeWithin(trx, {
          actorId: actor.accountId,
          action: 'equipping_enrollment.guide_changed',
          targetType: 'person',
          targetId: enrollment.person_id,
          // The Guides' Persons, as the naming and removal entries carry (section 21).
          before: { guide_person_id: current?.person_id ?? null },
          after: { guide_person_id: guide.person_id },
        });
      }
      const response = { enrollment_id: enrollmentId, guide_id: guideId };
      await this.idempotency.completeWithin(trx, { ...claim, status: 200, body: response });
      return response;
    });
  }

  /**
   * **Who may guide a level: one level ahead, in the tree** (owner, 2026-11-20): for Life Class,
   * a pass of SOL 1 or beyond, a pass from before the school included, and an open pastoral
   * assignment. `null` asks of the whole church, for the Guide search.
   */
  private async mayGuideWithin(
    executor: Db | Transaction<Database>,
    among: readonly string[] | null,
    level: EquippingLevel,
  ): Promise<Set<string>> {
    let passed = await this.training.holdersOfAny(among, guidingPrograms(level));
    if (level === 'SOL_3') {
      passed = await this.withCellLeadersUnderWithin(executor, passed);
    }
    const inTree = await this.hierarchy.withOpenAssignment([...passed], executor);
    const records = await this.people.equippingAccountPersons();
    return new Set([...inTree].filter((id) => !records.has(canonicalId(id))));
  }

  /**
   * Those of these people with at least `GUIDE_CELL_LEADERS` of their own direct disciples each
   * leading an `ACTIVE` Cell now (decision 0501, point 4): a SOL 3 Guide's second condition. Read
   * through `hierarchy` and `cells`, which own the two tables.
   */
  private async withCellLeadersUnderWithin(
    executor: Db | Transaction<Database>,
    among: ReadonlySet<string>,
  ): Promise<Set<string>> {
    const edges = await this.hierarchy.openDiscipleEdgesOf(executor, [...among]);
    const leading = await this.cells.currentCellLeaderIds(
      edges.map((edge) => edge.personId),
      executor,
    );
    const counts = new Map<string, number>();
    for (const edge of edges) {
      if (leading.has(edge.personId)) {
        const leader = canonicalId(edge.leaderId);
        counts.set(leader, (counts.get(leader) ?? 0) + 1);
      }
    }
    return new Set(
      [...among].filter((id) => (counts.get(canonicalId(id)) ?? 0) >= GUIDE_CELL_LEADERS),
    );
  }

  /** The class row, locked, so two writes sharing its students out never interleave. */
  private async lockClassWithin(
    trx: Transaction<Database>,
    classId: string,
  ): Promise<{ id: string; level: EquippingLevel }> {
    // FOR NO KEY UPDATE, not FOR UPDATE: it still serialises every write that shares students
    // out, but does not conflict with the KEY SHARE an enrollment's foreign-key check takes on
    // the class, so two enrollments into one class wait for each other rather than deadlocking.
    const cls = await trx
      .selectFrom('equipping_classes')
      .select(['id', 'name', 'level', 'cancelled_at'])
      .where('id', '=', classId)
      .forNoKeyUpdate()
      .executeTakeFirst();
    if (cls === undefined) {
      throw new NotFoundError('No such class.');
    }
    this.assertNotCancelled(cls);
    return { id: cls.id, level: cls.level };
  }

  /** A class's open Guides, each with their sex, in the order they were named. */
  private async openGuidesOf(
    executor: Db | Transaction<Database>,
    classId: string,
  ): Promise<{ id: string; person_id: string; sex: string | null; archived: boolean }[]> {
    const rows = await executor
      .selectFrom('equipping_class_guides')
      .select(['id', 'person_id'])
      .where('class_id', '=', classId)
      .where('removed_at', 'is', null)
      .orderBy('named_at')
      .orderBy('id')
      .execute();
    const ids = rows.map((row) => row.person_id);
    const [sexes, archived] = await Promise.all([
      this.people.sexesOf(ids),
      this.people.archivedAtWithin(executor, ids, new Date()),
    ]);
    return rows.map((row) => ({
      ...row,
      sex: sexes.get(canonicalId(row.person_id)) ?? null,
      archived: archived.has(row.person_id),
    }));
  }

  /** Each open enrollment of the class mapped to its open Guide's row. */
  private async openPairingsOf(
    executor: Db | Transaction<Database>,
    classId: string,
  ): Promise<Map<string, string>> {
    const rows = await executor
      .selectFrom('equipping_guide_students as gs')
      .innerJoin('equipping_enrollments as e', 'e.id', 'gs.enrollment_id')
      .select(['gs.enrollment_id', 'gs.guide_id'])
      .where('e.class_id', '=', classId)
      .where('e.ended_at', 'is', null)
      .where('gs.ended_at', 'is', null)
      .execute();
    return new Map(rows.map((row) => [row.enrollment_id, row.guide_id]));
  }

  /**
   * **DREAMS shares the students out among the Guides, by sex** (decision 0501, point 8): each
   * student with no Guide, in name order, joins the Guide of their sex who has the fewest, ties
   * going to the one named first. Naming a Guide takes nobody from another Guide (decision
   * 0501), so groups are even only among students shared out together; the Coordinator evens
   * the rest with *Swap*. An archived Guide takes no new students (decision 0502), and a student
   * with no Guide of their sex to take them stays without one.
   */
  private async shareOutWithin(
    trx: Transaction<Database>,
    actor: Actor,
    classId: string,
  ): Promise<void> {
    await this.lockClassWithin(trx, classId);
    const guides = await this.openGuidesOf(trx, classId);
    if (guides.length === 0) {
      return;
    }
    const enrolled = await trx
      .selectFrom('equipping_enrollments as e')
      .innerJoin('equipping_registrations as r', 'r.id', 'e.registration_id')
      .select(['e.id as enrollment_id', 'r.person_id'])
      .where('e.class_id', '=', classId)
      .where('e.ended_at', 'is', null)
      .execute();
    const pairings = await this.openPairingsOf(trx, classId);
    const load = new Map(guides.map((g) => [g.id, 0]));
    for (const guideId of pairings.values()) {
      load.set(guideId, (load.get(guideId) ?? 0) + 1);
    }
    const unpaired = enrolled.filter((row) => !pairings.has(row.enrollment_id));
    if (unpaired.length === 0) {
      return;
    }
    // Only the enrollments about to be paired are locked, FOR SHARE and in id order, so one being
    // ended at this moment (a move or a withdrawal, which do not lock this class) is waited for
    // and then left out, and two moves in opposite directions do not lock each other's whole
    // class. The WHERE is re-checked on the row as committed.
    const stillOpen = new Set(
      (
        await trx
          .selectFrom('equipping_enrollments')
          .select('id')
          .where(
            'id',
            'in',
            unpaired.map((row) => row.enrollment_id),
          )
          .where('ended_at', 'is', null)
          .orderBy('id')
          .forShare()
          .execute()
      ).map((row) => row.id),
    );
    const waiting = unpaired.filter((row) => stillOpen.has(row.enrollment_id));
    if (waiting.length === 0) {
      return;
    }
    const [people, sexes] = await Promise.all([
      this.people.forDecisions(waiting.map((row) => row.person_id)),
      this.people.sexesOf(waiting.map((row) => row.person_id)),
    ]);
    waiting.sort((a, b) =>
      (people.get(a.person_id)?.fullName ?? '').localeCompare(
        people.get(b.person_id)?.fullName ?? '',
      ),
    );
    for (const row of waiting) {
      const sex = sexes.get(canonicalId(row.person_id));
      const choices = guides.filter((g) => g.sex === sex && !g.archived);
      if (choices.length === 0) {
        continue;
      }
      const chosen = choices.reduce((best, g) =>
        (load.get(g.id) ?? 0) < (load.get(best.id) ?? 0) ? g : best,
      );
      await trx
        .insertInto('equipping_guide_students')
        .values({
          enrollment_id: row.enrollment_id,
          guide_id: chosen.id,
          started_by: actor.accountId,
        })
        .execute();
      load.set(chosen.id, (load.get(chosen.id) ?? 0) + 1);
    }
  }

  /**
   * How many Guides each class has and how many more each sex needs (decision 0501, point 8):
   * Life Class's 3 or 4 a Guide, counted for each sex apart, 1 or 2 students needing one and 5
   * two. An archived Guide is named and counts toward no more, taking no new students (decision
   * 0502). Read in four queries for the whole page rather than per class.
   */
  private async staffingOf(
    classIds: readonly string[],
  ): Promise<Map<string, { named: number; short_men: number; short_women: number }>> {
    const result = new Map<string, { named: number; short_men: number; short_women: number }>();
    if (classIds.length === 0) {
      return result;
    }
    const [levels, guides, enrolled] = await Promise.all([
      this.db
        .selectFrom('equipping_classes')
        .select(['id', 'level'])
        .where('id', 'in', [...classIds])
        .execute(),
      this.db
        .selectFrom('equipping_class_guides')
        .select(['class_id', 'person_id'])
        .where('class_id', 'in', [...classIds])
        .where('removed_at', 'is', null)
        .execute(),
      this.db
        .selectFrom('equipping_enrollments as e')
        .innerJoin('equipping_registrations as r', 'r.id', 'e.registration_id')
        .select(['e.class_id', 'r.person_id'])
        .where('e.class_id', 'in', [...classIds])
        .where('e.ended_at', 'is', null)
        .execute(),
    ]);
    const everyone = [...new Set([...guides, ...enrolled].map((row) => row.person_id))];
    const [sexes, archived] = await Promise.all([
      this.people.sexesOf(everyone),
      this.people.archivedAtWithin(
        this.db,
        guides.map((row) => row.person_id),
        new Date(),
      ),
    ]);
    const sexOf = (id: string) => sexes.get(canonicalId(id));
    const levelOf = new Map(levels.map((row) => [row.id, row.level]));
    for (const classId of classIds) {
      const ours = guides.filter((g) => g.class_id === classId);
      const students = enrolled.filter((e) => e.class_id === classId);
      const shortFor = (sex: string) =>
        Math.max(
          0,
          guidesFor(
            levelOf.get(classId) ?? 'LIFE_CLASS',
            students.filter((e) => sexOf(e.person_id) === sex).length,
          ) - ours.filter((g) => sexOf(g.person_id) === sex && !archived.has(g.person_id)).length,
        );
      result.set(classId, {
        named: ours.length,
        short_men: shortFor('MALE'),
        short_women: shortFor('FEMALE'),
      });
    }
    return result;
  }

  /**
   * `POST /equipping/classes/{id}/enrollments` (point 11): all of them or none. Each must be
   * registered for the class's level and term, not cancelled, in no class, with a birthday,
   * and 14 on their own Network's Encounter weekend.
   */
  async enroll(
    actor: Actor,
    classId: string,
    registrationIds: readonly string[],
    claim: CurrentClaim,
    startFromLesson1: readonly string[] = [],
  ): Promise<Record<string, unknown>> {
    return this.write(async (trx) => {
      const cls = await this.classWithin(trx, classId);
      const regs = await trx
        .selectFrom('equipping_registrations')
        .select(['id', 'person_id', 'level', 'term_year', 'term_number', 'cancelled_at'])
        .where('id', 'in', [...registrationIds])
        .orderBy('id')
        .forUpdate()
        .execute();
      if (regs.length !== registrationIds.length) {
        throw new NotFoundError('A registration in the list does not exist.');
      }

      const refusals: { registration_id: string; reason: string }[] = [];
      for (const reg of regs) {
        if (reg.cancelled_at !== null) {
          refusals.push({ registration_id: reg.id, reason: 'cancelled' });
        } else if (
          reg.level !== cls.level ||
          reg.term_year !== cls.term_year ||
          reg.term_number !== cls.term_number
        ) {
          refusals.push({ registration_id: reg.id, reason: 'another level or term' });
        }
      }
      const open = await trx
        .selectFrom('equipping_enrollments')
        .select('registration_id')
        .where('registration_id', 'in', [...registrationIds])
        .where('ended_at', 'is', null)
        .execute();
      for (const row of open) {
        refusals.push({ registration_id: row.registration_id, reason: 'already in a class' });
      }
      // **A graded registration is finished** (decision 0513, point 16): one graded Passed or Not
      // passed is not enrolled again; trying again is a new registration.
      const graded = await trx
        .selectFrom('equipping_enrollments as e')
        .innerJoin('equipping_current_grades as g', 'g.enrollment_id', 'e.id')
        .select('e.registration_id')
        .distinct()
        .where('e.registration_id', 'in', [...registrationIds])
        .where('g.grade', 'in', ['PASSED', 'NOT_PASSED'])
        .execute();
      for (const row of graded) {
        refusals.push({
          registration_id: row.registration_id,
          reason: 'already graded this term; to take it again they register for a later term',
        });
      }

      const eligibility = await this.eligibilityOf(
        regs.map((reg) => reg.person_id),
        cls.encounter_season_id,
      );
      for (const reg of regs) {
        const blocked = eligibility.byPerson.get(canonicalId(reg.person_id))!.blocked;
        if (blocked !== null) {
          refusals.push({ registration_id: reg.id, reason: blocked });
        }
      }

      // **Who joins at Lesson 6** (decision 0512): anybody whose latest posted grade at the level
      // says so, unless the Registrar starts them from Lesson 1, and only in a class whose
      // Lesson 6 has not been reached.
      const startOver = new Set(startFromLesson1.map((id) => canonicalId(id)));
      const sources = await this.lesson6SourcesOf(
        trx,
        regs.map((reg) => reg.person_id),
        cls.level,
        cls,
      );
      const carriedOf = new Map<string, string>();
      const lesson6 = await this.lesson6Within(trx, classId);
      for (const reg of regs) {
        const source = sources.get(canonicalId(reg.person_id));
        if (source === undefined || startOver.has(canonicalId(reg.id))) {
          continue;
        }
        if (!lesson6.open) {
          refusals.push({
            registration_id: reg.id,
            reason: `joins at Lesson 6, which ${cls.name} has passed; choose another class or start them from Lesson 1`,
          });
        } else {
          carriedOf.set(reg.id, source.enrollmentId);
        }
      }

      if (refusals.length > 0) {
        throw new InvariantViolationError(
          'Some of them cannot be enrolled in this class. Nobody was enrolled.',
          { refusals },
        );
      }

      const inserted = await trx
        .insertInto('equipping_enrollments')
        .values(
          regs.map((reg) => ({
            registration_id: reg.id,
            class_id: classId,
            started_by: actor.accountId,
            carried_from_enrollment_id: carriedOf.get(reg.id) ?? null,
          })),
        )
        .returning(['id', 'registration_id', 'carried_from_enrollment_id'])
        .execute();

      // A student enrolled after the class's Guides were named joins the Guide of their sex who
      // has the fewest (owner, 2026-11-20).
      await this.shareOutWithin(trx, actor, classId);

      for (const reg of regs) {
        await this.audit.writeWithin(trx, {
          actorId: actor.accountId,
          action: 'equipping_enrollment.created',
          targetType: 'person',
          targetId: reg.person_id,
          before: null,
          after: {
            registration_id: reg.id,
            class_id: classId,
            class_name: cls.name,
            joins_at_lesson_6: carriedOf.has(reg.id),
            carried_from_enrollment_id: carriedOf.get(reg.id) ?? null,
            started_from_lesson_1:
              sources.has(canonicalId(reg.person_id)) && startOver.has(canonicalId(reg.id)),
          },
        });
      }

      const response = {
        class_id: classId,
        enrolled: inserted.map((row) => ({
          enrollment_id: row.id,
          registration_id: row.registration_id,
          joins_at_lesson_6: row.carried_from_enrollment_id !== null,
        })),
      };
      await this.idempotency.completeWithin(trx, { ...claim, status: 201, body: response });
      return response;
    });
  }

  /** `POST /equipping/enrollments/{id}/move`: to another class of the same level and term. */
  async move(
    actor: Actor,
    enrollmentId: string,
    toClassId: string,
    claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    return this.write(async (trx) => {
      // **The classes first, in id order, then the enrollment** (section 24, decision 0508): a
      // lesson save, a make-up and a posting lock the class before they touch an enrollment.
      const placed = await trx
        .selectFrom('equipping_enrollments')
        .select('class_id')
        .where('id', '=', enrollmentId)
        .executeTakeFirst();
      const ids = [...new Set([toClassId, ...(placed ? [placed.class_id] : [])])].sort();
      const locked = new Map<string, Awaited<ReturnType<EquippingService['classWithin']>>>();
      for (const id of ids) {
        locked.set(id, await this.classWithin(trx, id));
      }
      const enrollment = await this.openEnrollmentWithin(trx, enrollmentId);
      if (enrollment.class_id === toClassId) {
        throw new InvariantViolationError('They are already in that class.', {
          field: 'class_id',
        });
      }
      const to = locked.get(toClassId)!;
      const from =
        locked.get(enrollment.class_id) ?? (await this.classWithin(trx, enrollment.class_id));
      if (
        to.level !== from.level ||
        to.term_year !== from.term_year ||
        to.term_number !== from.term_number
      ) {
        throw new InvariantViolationError(
          'A move is to another class of the same level and term.',
          { field: 'class_id' },
        );
      }
      const blocked = (
        await this.eligibilityOf([enrollment.person_id], to.encounter_season_id)
      ).byPerson.get(canonicalId(enrollment.person_id))!.blocked;
      if (blocked !== null) {
        throw new InvariantViolationError(`They cannot join that class: ${blocked}.`, {
          field: 'class_id',
        });
      }

      // A student joined at Lesson 6 keeps it with a move, under the same rule (decision 0512).
      const carried = (
        await trx
          .selectFrom('equipping_enrollments')
          .select('carried_from_enrollment_id')
          .where('id', '=', enrollmentId)
          .executeTakeFirstOrThrow()
      ).carried_from_enrollment_id;
      if (carried !== null && !(await this.lesson6Within(trx, toClassId)).open) {
        throw new InvariantViolationError(
          `They joined at Lesson 6, which ${to.name} has passed; choose another class.`,
          { field: 'class_id' },
        );
      }

      await trx
        .updateTable('equipping_enrollments')
        .set({ ended_at: sql<Date>`now()`, ended_by: actor.accountId, end_reason: 'MOVED' })
        .where('id', '=', enrollmentId)
        .execute();
      const row = await trx
        .insertInto('equipping_enrollments')
        .values({
          registration_id: enrollment.registration_id,
          class_id: toClassId,
          started_by: actor.accountId,
          carried_from_enrollment_id: carried,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      // Paired afresh in the class they move to (owner, 2026-11-20).
      await this.shareOutWithin(trx, actor, toClassId);

      await this.audit.writeWithin(trx, {
        actorId: actor.accountId,
        action: 'equipping_enrollment.ended',
        targetType: 'person',
        targetId: enrollment.person_id,
        before: { enrollment_id: enrollmentId, class_name: from.name },
        after: {
          end_reason: 'MOVED',
          enrollment_id: row.id,
          class_name: to.name,
          carried_from_enrollment_id: carried,
        },
      });

      const response = { enrollment_id: row.id, class_id: toClassId, moved_from: enrollmentId };
      await this.idempotency.completeWithin(trx, { ...claim, status: 200, body: response });
      return response;
    });
  }

  /** `POST /equipping/enrollments/{id}/withdraw`, with a reason. The row is kept. */
  async withdraw(
    actor: Actor,
    enrollmentId: string,
    reason: string,
    claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    return this.write(async (trx) => {
      // The class first, then the enrollment (section 24, decision 0508). A student a posting left
      // enrolled, still to attend the Encounter, may be withdrawn from the posted class.
      const placed = await trx
        .selectFrom('equipping_enrollments')
        .select('class_id')
        .where('id', '=', enrollmentId)
        .executeTakeFirst();
      if (placed === undefined) {
        throw new NotFoundError('No such enrollment.');
      }
      const cls = await this.classWithin(trx, placed.class_id, enrollmentId);
      const enrollment = await this.openEnrollmentWithin(trx, enrollmentId);
      await trx
        .updateTable('equipping_enrollments')
        .set({
          ended_at: sql<Date>`now()`,
          ended_by: actor.accountId,
          end_reason: 'WITHDRAWN',
          withdraw_note: reason.trim(),
        })
        .where('id', '=', enrollmentId)
        .execute();

      await this.audit.writeWithin(trx, {
        actorId: actor.accountId,
        action: 'equipping_enrollment.ended',
        targetType: 'person',
        targetId: enrollment.person_id,
        before: { enrollment_id: enrollmentId, class_name: cls.name },
        after: { end_reason: 'WITHDRAWN', reason: reason.trim() },
      });

      const response = { enrollment_id: enrollmentId, status: 'WITHDRAWN', reason: reason.trim() };
      await this.idempotency.completeWithin(trx, { ...claim, status: 200, body: response });
      return response;
    });
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * The two checks enrolling makes (point 11), for each person against a season: a birthday
   * recorded, and 14 on the first day of their own Network's Encounter weekend. `blocked` is
   * the reason in words, or null. **A SOL 1 class has no season, and neither check** (decision
   * 0514): SOL has no Encounter, so a birthday not recorded stops nobody enrolling in it.
   */
  private async eligibilityOf(
    personIds: readonly string[],
    seasonId: string | null,
  ): Promise<{
    weekends: { mens: string | null; womens: string | null };
    byPerson: Map<string, { birthDate: string | null; age: number | null; blocked: string | null }>;
  }> {
    const ids = [...new Set(personIds.map((id) => canonicalId(id)))];
    const [births, networks, seasons, decisions] = await Promise.all([
      this.people.birthDatesOf(ids),
      this.people.currentNetworksOf(ids),
      this.seasons.allSeasons(),
      this.people.forDecisions(ids),
    ]);
    const season = seasons.find((each) => each.id === seasonId) ?? null;
    const weekends = {
      mens: season?.mens_encounter_on ?? null,
      womens: season?.womens_encounter_on ?? null,
    };

    const byPerson = new Map<
      string,
      { birthDate: string | null; age: number | null; blocked: string | null }
    >();
    for (const id of ids) {
      const birthDate = births.get(id) ?? null;
      const network = networks.get(id) ?? null;
      const weekend =
        network === 'MENS' ? weekends.mens : network === 'WOMENS' ? weekends.womens : null;
      const age = birthDate !== null && weekend !== null ? ageOn(birthDate, weekend) : null;
      // **An archived or merged Person acquires no new live relationship** (sections 3 and 6),
      // so a registration made while they were current enrols or moves nobody once they are
      // not. Archiving closes their open registration (section 29), so this is the backstop.
      const decision = decisions.get(id);
      const blocked =
        decision === undefined || decision.mergedIntoId !== null
          ? 'merged into another record'
          : decision.isArchived
            ? 'archived'
            : seasonId === null
              ? null
              : birthDate === null
                ? 'no birthday recorded'
                : weekend === null
                  ? 'no Network, so no Encounter weekend'
                  : age! < ENCOUNTER_MINIMUM_AGE
                    ? `${age} on ${weekend}, under ${ENCOUNTER_MINIMUM_AGE} for the Encounter`
                    : null;
      byPerson.set(id, { birthDate, age, blocked });
    }
    return { weekends, byPerson };
  }

  private statusOf(row: {
    cancelled_at: Date | null;
    enrollment_id: string | null;
    unmet: EquippingRequirement[];
  }): Status {
    if (row.cancelled_at !== null) {
      return 'CANCELLED';
    }
    if (row.enrollment_id !== null) {
      return 'ENROLLED';
    }
    return row.unmet.length > 0 ? 'REGISTERED_WITH_EXCEPTION' : 'REGISTERED';
  }

  /**
   * **Whom a class takes at Lesson 6** (decision 0512, point 2): its Lesson 6, expected five
   * weeks after its first lesson, is today or later, and it has saved no lesson from 6 on.
   */
  private async lesson6Within(
    executor: Db | Transaction<Database>,
    classId: string,
  ): Promise<{ on: string; open: boolean }> {
    const cls = await executor
      .selectFrom('equipping_classes')
      .select('first_lesson_on')
      .where('id', '=', classId)
      .executeTakeFirstOrThrow();
    const on = expectedOn(String(cls.first_lesson_on), 6);
    const later = await executor
      .selectFrom('equipping_lessons')
      .select('id')
      .where('class_id', '=', classId)
      .where('lesson', '>=', 6)
      .executeTakeFirst();
    const today = manilaDayOf(await databaseNow(executor));
    return { on, open: later === undefined && on >= today };
  }

  /**
   * **Who joins at Lesson 6, and from where** (decision 0512, point 1): each person whose latest
   * posted grade at the level, in a term before `before`, says so, a merged record's grades
   * being the person's (decision 0408). The enrollment named is where lessons 1 to 4 were kept:
   * the graded one, or the one it carried from when it had joined at Lesson 6 itself.
   */
  private async lesson6SourcesOf(
    executor: Db | Transaction<Database>,
    personIds: readonly string[],
    level: EquippingLevel,
    before: { term_year: number; term_number: number } | null,
  ): Promise<
    Map<string, { enrollmentId: string; className: string; termYear: number; termNumber: number }>
  > {
    const result = new Map<
      string,
      { enrollmentId: string; className: string; termYear: number; termNumber: number }
    >();
    if (personIds.length === 0) {
      return result;
    }
    const pairs = await this.people.mergedPairsWithin(executor);
    const resolve = resolverOf(pairs);
    const wanted = new Set(personIds.map((id) => canonicalId(id)));
    const records = [
      ...wanted,
      ...pairs.absorbed.filter((_, index) => wanted.has(canonicalId(pairs.kept[index]))),
    ];
    // The grade as it stands now, a change after posting included (decision 0513).
    const rows = await executor
      .selectFrom('equipping_current_grades as g')
      .innerJoin('equipping_class_postings as p', 'p.id', 'g.posting_id')
      .innerJoin('equipping_enrollments as n', 'n.id', 'g.enrollment_id')
      .innerJoin('equipping_registrations as r', 'r.id', 'n.registration_id')
      .select([
        'r.person_id',
        'r.term_year',
        'r.term_number',
        'g.joins_at_lesson_6',
        'n.id as enrollment_id',
        'n.carried_from_enrollment_id',
      ])
      .where('r.level', '=', level)
      .where('r.person_id', 'in', records)
      .$if(before !== null, (qb) =>
        qb.where((eb) =>
          eb.or([
            eb('r.term_year', '<', before!.term_year),
            eb.and([
              eb('r.term_year', '=', before!.term_year),
              eb('r.term_number', '<', before!.term_number),
            ]),
          ]),
        ),
      )
      .orderBy('r.term_year', 'desc')
      .orderBy('r.term_number', 'desc')
      .orderBy('p.posted_at', 'desc')
      .execute();
    const latest = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      const key = canonicalId(resolve(row.person_id));
      if (!latest.has(key)) {
        latest.set(key, row);
      }
    }
    const joining = [...latest.entries()].filter(([, row]) => row.joins_at_lesson_6);
    if (joining.length === 0) {
      return result;
    }
    const keptIds = joining.map(([, row]) => row.carried_from_enrollment_id ?? row.enrollment_id);
    const kept = await executor
      .selectFrom('equipping_enrollments as e')
      .innerJoin('equipping_classes as c', 'c.id', 'e.class_id')
      .select(['e.id', 'c.name', 'c.term_year', 'c.term_number'])
      .where('e.id', 'in', keptIds)
      .execute();
    const keptById = new Map(kept.map((row) => [row.id, row]));
    for (const [key, row] of joining) {
      const where = keptById.get(row.carried_from_enrollment_id ?? row.enrollment_id)!;
      result.set(key, {
        enrollmentId: where.id,
        className: where.name,
        termYear: where.term_year,
        termNumber: where.term_number,
      });
    }
    return result;
  }

  /**
   * Each person's earlier tries at a level, oldest first (decision 0511, points 1, 5 and 8): the
   * grades posted *Not passed*, answered under each id asked about, a record merged away
   * included. Counting them by term is `triesBefore`'s and the form's.
   */
  private async earlierTriesOf(
    personIds: readonly string[],
    level: EquippingLevel,
  ): Promise<Map<string, EarlierTry[]>> {
    const result = new Map<string, EarlierTry[]>();
    if (personIds.length === 0) {
      return result;
    }
    const pairs = await this.people.mergedPairsWithin(this.db);
    const resolve = resolverOf(pairs);
    // Each id asked about stands for the person kept: a record merged away counts the kept
    // record's tries and every other record merged into it, as the kept record does.
    const kept = new Set(personIds.map((id) => canonicalId(resolve(id))));
    const records = [
      ...kept,
      ...pairs.absorbed.filter((_, index) => kept.has(canonicalId(pairs.kept[index]))),
    ];
    // A try is a grade that stands *Not passed* now, a change after posting included (0513).
    const rows = await this.db
      .selectFrom('equipping_current_grades as g')
      .innerJoin('equipping_class_postings as p', 'p.id', 'g.posting_id')
      .innerJoin('equipping_classes as c', 'c.id', 'p.class_id')
      .innerJoin('equipping_enrollments as n', 'n.id', 'g.enrollment_id')
      .innerJoin('equipping_registrations as r', 'r.id', 'n.registration_id')
      .select(['r.person_id', 'r.term_year', 'r.term_number', 'c.name', 'g.reason'])
      .where('g.grade', '=', 'NOT_PASSED')
      .where('r.level', '=', level)
      .where('r.person_id', 'in', records)
      .orderBy('r.term_year')
      .orderBy('r.term_number')
      .orderBy('p.posted_at')
      .execute();
    for (const row of rows) {
      const key = canonicalId(resolve(row.person_id));
      const list = result.get(key) ?? [];
      list.push({
        termYear: row.term_year,
        termNumber: row.term_number,
        className: row.name,
        reason: row.reason,
      });
      result.set(key, list);
    }
    // Answered under every id asked about, a record merged away included.
    for (const id of personIds) {
      const list = result.get(canonicalId(resolve(id)));
      if (list !== undefined) {
        result.set(canonicalId(id), list);
      }
    }
    return result;
  }

  private classShape(row: {
    id: string;
    name: string;
    day_of_week: number;
    time_of_day: string;
    place: string | null;
    first_lesson_on: unknown;
    encounter_season_id: string | null;
    run_by: string;
  }): Record<string, unknown> {
    return {
      id: row.id,
      name: row.name,
      day_of_week: row.day_of_week,
      time_of_day: String(row.time_of_day).slice(0, 5),
      place: row.place,
      first_lesson_on: String(row.first_lesson_on),
      encounter_season_id: row.encounter_season_id,
      run_by: row.run_by,
    };
  }

  private async classWithin(
    trx: Transaction<Database>,
    classId: string,
    notYetLeaving?: string,
  ): Promise<{
    id: string;
    name: string;
    level: EquippingLevel;
    term_year: number;
    term_number: number;
    encounter_season_id: string | null;
  }> {
    // Locked as a lesson save and a posting lock it, so a class is not posted under an
    // enrollment changing (decision 0508).
    const cls = await trx
      .selectFrom('equipping_classes')
      .select([
        'id',
        'name',
        'level',
        'term_year',
        'term_number',
        'encounter_season_id',
        'cancelled_at',
      ])
      .where('id', '=', classId)
      .forNoKeyUpdate()
      .executeTakeFirst();
    if (cls === undefined) {
      throw new NotFoundError('No such class.');
    }
    this.assertNotCancelled(cls);
    const posted = await trx
      .selectFrom('equipping_class_postings')
      .select('id')
      .where('class_id', '=', classId)
      .executeTakeFirst();
    if (posted !== undefined) {
      const notYet =
        notYetLeaving === undefined
          ? undefined
          : // The grade as it stands (decision 0513): a posted Not passed made Not yet leaves as
            // any Not yet may, and a posted Not yet made something else does not.
            await trx
              .selectFrom('equipping_current_grades')
              .select('final_grade_id')
              .where('enrollment_id', '=', notYetLeaving)
              .where('grade', '=', 'NOT_YET')
              .executeTakeFirst();
      if (notYet === undefined) {
        throw new InvariantViolationError(
          `${cls.name}'s grades have been posted; nobody joins or leaves it now.`,
          { field: 'class_id' },
        );
      }
    }
    return {
      id: cls.id,
      name: cls.name,
      level: cls.level,
      term_year: cls.term_year,
      term_number: cls.term_number,
      encounter_season_id: cls.encounter_season_id,
    };
  }

  /**
   * **A Registrar record does not exist to the school, for the Admin too** (decision 0499,
   * point 13): it is an account's record, never somebody signed up for a class. The picker
   * leaves it out, and the form and registering answer `NOT_FOUND`, as the picker's silence does.
   */
  private async isEquippingRecord(personId: string): Promise<boolean> {
    return (await this.people.equippingAccountPersons()).has(canonicalId(personId));
  }

  /**
   * **Who may teach a class: a current Cell Leader in the tree** (decision 0499, point 10,
   * owner 2026-11-18: "a teacher must be a cell leader in the tree structure"). A current
   * Cell Leader holds an open leadership of an `ACTIVE` Cell (section 11), and being in the
   * tree is holding an open pastoral assignment, a Network root's included (section 5). An
   * Registrar record and a Network Admin lead no Cell; an administrator outside the tree may
   * lead one and holds no assignment. None of them qualifies. `null` asks of the whole
   * church, for the Teacher search.
   */
  private async mayTeachWithin(
    executor: Db | Transaction<Database>,
    among: readonly string[] | null,
  ): Promise<Set<string>> {
    const leaders = await this.cells.currentCellLeaderIds(among, executor);
    return this.hierarchy.withOpenAssignment([...leaders], executor);
  }

  private async openEnrollmentWithin(
    trx: Transaction<Database>,
    enrollmentId: string,
  ): Promise<{ id: string; registration_id: string; class_id: string; person_id: string }> {
    // **The registration is locked before the enrollment**, which is the order an archive
    // takes them in (equipping/person-archive.adapter.ts): registration first, then its enrollments.
    // Locking the enrollment first let an archive waiting on the registration miss the
    // enrollment a move had just opened, and its cancel then failed the history check with a
    // 500 (third review). FOR NO KEY UPDATE, as the archive's, so the new enrollment's
    // foreign-key check on the registration is not blocked by this transaction's own lock.
    const owner = await trx
      .selectFrom('equipping_enrollments')
      .select('registration_id')
      .where('id', '=', enrollmentId)
      .executeTakeFirst();
    if (owner !== undefined) {
      await trx
        .selectFrom('equipping_registrations')
        .select('id')
        .where('id', '=', owner.registration_id)
        .forNoKeyUpdate()
        .execute();
    }
    const row = await trx
      .selectFrom('equipping_enrollments as e')
      .innerJoin('equipping_registrations as r', 'r.id', 'e.registration_id')
      .select(['e.id', 'e.registration_id', 'e.class_id', 'e.ended_at', 'r.person_id'])
      .where('e.id', '=', enrollmentId)
      .forUpdate('e')
      .executeTakeFirst();
    if (row === undefined) {
      throw new NotFoundError('No such enrollment.');
    }
    if (row.ended_at !== null) {
      throw new InvariantViolationError('That enrollment has already ended.', {
        enrollment_id: enrollmentId,
      });
    }
    return row;
  }

  /** One transaction, with the two unique indexes a person can meet answered by name. */
  private async write<T>(work: (trx: Transaction<Database>) => Promise<T>): Promise<T> {
    try {
      return await this.db.transaction().execute(work);
    } catch (error) {
      if (isLostLockWait(error)) {
        throw new ApiError(
          ApiErrorCode.RESOURCE_BUSY,
          'Somebody else is changing this class. Try again in a moment.',
          {},
        );
      }
      if (isUniqueViolation(error)) {
        const constraint = violatedConstraint(error);
        if (constraint === 'equipping_registrations_one_per_term') {
          throw new InvariantViolationError(
            'They are already registered for this level and term.',
            { field: 'person_id' },
          );
        }
        if (constraint === 'equipping_classes_one_name_per_term') {
          throw new InvariantViolationError('A class of that name is already open this term.', {
            field: 'name',
          });
        }
        if (constraint === 'equipping_enrollments_one_open') {
          throw new InvariantViolationError('Somebody in the list is already in a class.', {
            field: 'registration_ids',
          });
        }
      }
      // The database's own refusals of decision 0510, reached only past the checks above.
      const refused = violatedConstraint(error);
      // Decision 0513, point 16, reached only where a posting landed past the check above.
      if (refused === 'equipping_enrollment_graded_registration') {
        throw new InvariantViolationError(
          'Somebody in the list was graded on that registration; nobody was enrolled.',
          { field: 'registration_ids' },
        );
      }
      if (refused === 'equipping_class_cancelled') {
        throw new InvariantViolationError('That class was cancelled; nothing on it changes.', {
          field: 'class_id',
        });
      }
      if (
        refused === 'equipping_class_has_students' ||
        refused === 'equipping_class_lesson_saved'
      ) {
        throw new InvariantViolationError(
          'That class has a student or a saved lesson now, so this is no longer allowed.',
          { field: 'class_id' },
        );
      }
      throw error;
    }
  }
}
