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
import { SuynlService } from '../suynl/suynl.service';
import { EncounterSeasonsService } from '../training/encounter-seasons.service';
import { TrainingService } from '../training/training.service';

import type { CurrentClaim } from '../common/idempotency/current-idempotency.decorator';
import type { Database, EquippingLevel, EquippingRequirement } from '../database/schema';
import type {
  CorrectClassDto,
  EquippingTermDto,
  ListRegistrationsDto,
  OpenClassDto,
  RegisterDto,
} from './dto/equipping.dto';

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

function encodeCursor(row: { registered_at: Date; id: string }): string {
  return Buffer.from(JSON.stringify([row.registered_at.toISOString(), row.id])).toString(
    'base64url',
  );
}

/** Exactly what `toISOString` writes, so a forged key cannot carry text to the query. */
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** A cursor that cannot be resolved is refused (decision 0159). */
function decodeCursor(cursor: string | undefined): { at: string; id: string } | null {
  if (cursor === undefined) {
    return null;
  }
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      Array.isArray(value) &&
      value.length === 2 &&
      typeof value[0] === 'string' &&
      ISO_INSTANT.test(value[0]) &&
      !Number.isNaN(Date.parse(value[0])) &&
      typeof value[1] === 'string' &&
      isUuid(value[1])
    ) {
      return { at: value[0], id: value[1] };
    }
  } catch {
    // Falls through to the refusal.
  }
  throw new ValidationFailedError('That page cursor is not one this list gave.', {
    field: 'cursor',
  });
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

/** How many of a person's tries came in terms before the given one (decision 0511). */
function triesBefore(
  tries: EarlierTry[] | undefined,
  term: { term_year: number; term_number: number },
): number {
  return (tries ?? []).filter(
    (each) =>
      each.termYear < term.term_year ||
      (each.termYear === term.term_year && each.termNumber < term.term_number),
  ).length;
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
  ) {}

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  /** The four record requirements for each person (point 6), read as things stand now. */
  async requirementsOf(personIds: readonly string[]): Promise<Map<string, RequirementCheck[]>> {
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
   * One person as the registration form shows them: who they are, their leader and Cell, their
   * birthday, and the four record requirements.
   */
  async candidate(personId: string): Promise<Record<string, unknown>> {
    const person = await this.people.forDecision(personId);
    if (!person || person.mergedIntoId !== null || (await this.isEquippingRecord(personId))) {
      throw new NotFoundError('No such person.');
    }
    const id = canonicalId(person.id);
    const [checks, cells, births, leaderNames, tries] = await Promise.all([
      this.requirementsOf([id]),
      this.cells.currentCellsOfMany([id]),
      this.people.birthDatesOf([id]),
      this.people.directLeaderNamesOf([id]),
      this.earlierTriesOf([id], 'LIFE_CLASS'),
    ]);
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
  ): Promise<Record<string, unknown>[]> {
    // A Registrar record is never somebody signed up for a class, for the Admin too (decision
    // 0499, point 13); `candidate` and `register` refuse it the same way.
    const restrictTo =
      who === true || who === 'teachers'
        ? await this.mayTeachWithin(this.db, null)
        : who === 'guides'
          ? await this.mayGuideWithin(this.db, null, 'LIFE_CLASS')
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
            (['SOL_3', 'SOL_2', 'SOL_1'] as const).map(async (level) => ({
              level,
              holders: await this.training.holdersOfAny(ids, [level]),
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
          ? { qualifies: highest ? `Passed ${highest.level.replace('_', ' ')}` : null }
          : {}),
      };
    });
  }

  /** A term's registrations, newest first, a page at a time (section 22). */
  async registrations(query: ListRegistrationsDto): Promise<Record<string, unknown>> {
    const limit = query.limit ?? DEFAULT_PAGE;
    const after = decodeCursor(query.cursor);

    const rows = await this.db
      .selectFrom('equipping_registrations as r')
      .leftJoin('equipping_enrollments as e', (join) =>
        join.onRef('e.registration_id', '=', 'r.id').on('e.ended_at', 'is', null),
      )
      .leftJoin('equipping_classes as c', 'c.id', 'e.class_id')
      .select([
        'r.id',
        'r.person_id',
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
            eb.refTuple('r.registered_at', 'r.id'),
            '<',
            eb.tuple(sql<Date>`${after!.at}::timestamptz`, sql<string>`${after!.id}::uuid`),
          ),
        ),
      )
      .orderBy('r.registered_at', 'desc')
      .orderBy('r.id', 'desc')
      .limit(limit + 1)
      .execute();

    const page = rows.slice(0, limit);
    const ids = page.map((row) => row.person_id);
    const [people, leaderNames, births, tries] = await Promise.all([
      this.people.forDecisions(ids),
      this.people.directLeaderNamesOf(ids),
      this.people.birthDatesOf(ids),
      this.earlierTriesOf(ids, query.level),
    ]);

    return {
      data: page.map((row) => ({
        id: row.id,
        person: {
          id: row.person_id,
          member_id: people.get(row.person_id)?.memberId ?? null,
          full_name: people.get(row.person_id)?.fullName ?? null,
        },
        leader_name: leaderNames.get(row.person_id) ?? null,
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
  async coordinatorClasses(query: EquippingTermDto): Promise<Record<string, unknown>> {
    const rows = await this.classRows(query, true);
    const shaped = await this.withTeachers(rows);
    const live = rows.filter((row) => row.cancelled_at === null);
    const today = await this.manilaToday();
    const staffing = await this.staffingOf(live.map((row) => row.id));
    // The lessons late, said in words on the Coordinator's *Attendance* (decision 0501, point 22).
    const problems = await this.attendance.lessonProblemsOf(
      live.map((row) => ({ id: row.id, first_lesson_on: String(row.first_lesson_on) })),
    );
    return {
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
      guides: guides.map((g) => ({
        id: g.id,
        person: { id: g.person_id, full_name: nameOf(g.person_id) },
        sex: g.sex,
        // Archived since being named: keeps their students, takes no new ones (decision 0502).
        archived: g.archived,
      })),
      data: ids
        .map((id) => {
          const enrollmentId = enrollmentOf.get(canonicalId(id))!;
          const guide = guideById.get(pairings.get(enrollmentId) ?? '');
          const leaderId = cells.get(id)?.membership?.leaderId ?? null;
          return {
            enrollment_id: enrollmentId,
            person: { id, full_name: nameOf(id) },
            sex: sexes.get(canonicalId(id)) ?? null,
            // Shown to the Coordinator for every student, whatever branch (owner, 2026-11-20).
            cell_leader: leaderId === null ? null : { id: leaderId, full_name: nameOf(leaderId) },
            guide: guide ? { id: guide.id, full_name: nameOf(guide.person_id) } : null,
          };
        })
        .sort((a, b) => (a.person.full_name ?? '').localeCompare(b.person.full_name ?? '')),
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
      },
      enrolled: enrolled
        .map((row) => ({
          enrollment_id: row.enrollment_id,
          registration_id: row.registration_id,
          person: { id: row.person_id, full_name: nameOf(row.person_id) },
        }))
        .sort((a, b) => (a.person.full_name ?? '').localeCompare(b.person.full_name ?? '')),
      ready: ready.map((row) => {
        const check = eligibility.byPerson.get(canonicalId(row.person_id))!;
        return {
          registration_id: row.id,
          person: { id: row.person_id, full_name: nameOf(row.person_id) },
          leader_name: leaderNames.get(row.person_id) ?? null,
          with_exception: row.unmet.length > 0,
          birthday_recorded: check.birthDate !== null,
          age_at_encounter: check.age,
          blocked: check.blocked,
          try_number: 1 + triesBefore(tries.get(canonicalId(row.person_id)), cls),
        };
      }),
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
    for (const field of ['bible_confirmed', 'manual_confirmed'] as const) {
      if (body[field] !== true) {
        throw new ValidationFailedError(
          'A physical Bible and the Life Class Manual are each ticked before registering.',
          { field },
        );
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

    const checks = (await this.requirementsOf([personId])).get(personId) ?? [];
    const unmet = checks.filter((check) => !check.met).map((check) => check.code);
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
          bible_confirmed: true,
          manual_confirmed: true,
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
    const teacher =
      body.teacher_person_id === undefined ? null : await this.teacherOf(body.teacher_person_id);
    const seasons = await this.seasons.allSeasons();
    if (!seasons.some((season) => season.id === body.encounter_season_id)) {
      throw new NotFoundError('No such Encounter season.');
    }

    return this.write(async (trx) => {
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
          encounter_season_id: body.encounter_season_id,
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
          'A Life Class Guide has passed SOL 1 and is in the tree (SKILL.md section 29).',
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
    const programs = level === 'LIFE_CLASS' ? (['SOL_1', 'SOL_2', 'SOL_3'] as const) : [];
    const passed = await this.training.holdersOfAny(among, programs);
    const inTree = await this.hierarchy.withOpenAssignment([...passed], executor);
    const records = await this.people.equippingAccountPersons();
    return new Set([...inTree].filter((id) => !records.has(canonicalId(id))));
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
    const [guides, enrolled] = await Promise.all([
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
    for (const classId of classIds) {
      const ours = guides.filter((g) => g.class_id === classId);
      const students = enrolled.filter((e) => e.class_id === classId);
      const shortFor = (sex: string) =>
        Math.max(
          0,
          lifeClassGuidesFor(students.filter((e) => sexOf(e.person_id) === sex).length) -
            ours.filter((g) => sexOf(g.person_id) === sex && !archived.has(g.person_id)).length,
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
          })),
        )
        .returning(['id', 'registration_id'])
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
          after: { registration_id: reg.id, class_id: classId, class_name: cls.name },
        });
      }

      const response = {
        class_id: classId,
        enrolled: inserted.map((row) => ({
          enrollment_id: row.id,
          registration_id: row.registration_id,
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
        after: { end_reason: 'MOVED', enrollment_id: row.id, class_name: to.name },
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
   * the reason in words, or null.
   */
  private async eligibilityOf(
    personIds: readonly string[],
    seasonId: string,
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
   * Each person's earlier tries at a level (decision 0511): the grades posted *Not passed* for
   * them, oldest first, keyed by the record kept, a merged record's tries being the person's
   * (decision 0408). *Not yet*, a withdrawal, a move and a cancelled registration are not tries.
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
    const wanted = new Set(personIds.map((id) => canonicalId(id)));
    const records = [
      ...wanted,
      ...pairs.absorbed.filter((_, index) => wanted.has(canonicalId(pairs.kept[index]))),
    ];
    const rows = await this.db
      .selectFrom('equipping_final_grades as g')
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
    return result;
  }

  private classShape(row: {
    id: string;
    name: string;
    day_of_week: number;
    time_of_day: string;
    place: string | null;
    first_lesson_on: unknown;
    encounter_season_id: string;
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
    encounter_season_id: string;
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
          : await trx
              .selectFrom('equipping_final_grades')
              .select('id')
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
