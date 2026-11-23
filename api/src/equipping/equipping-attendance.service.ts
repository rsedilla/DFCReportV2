import { Inject, Injectable } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';

import { AuditService } from '../audit/audit.service';
import { Capability } from '../auth/authorization/capabilities';
import {
  AuthorizationService,
  holdsWholeChurch,
  type Actor,
} from '../auth/authorization/authorization.service';
import { CellsReadService } from '../cells/cells.read.service';
import {
  ApiError,
  ApiErrorCode,
  InvariantViolationError,
  NotFoundError,
  ScopeDeniedError,
  ValidationFailedError,
} from '../common/errors/api-error';
import { canonicalId } from '../common/identifiers';
import { compareRosterKeys } from '../common/roster-cursor';
import { IdempotencyService } from '../common/idempotency/idempotency.service';
import { manilaDayOf } from '../common/time/manila';
import { databaseNow, recordClosesAt, recordDueAt } from '../common/time/submission-window';
import { DATABASE, type Db } from '../database/database.module';
import { HierarchyService } from '../hierarchy/hierarchy.service';
import { PeopleReadService } from '../people/people.read.service';

import type { CurrentClaim } from '../common/idempotency/current-idempotency.decorator';
import type { Database } from '../database/schema';
import type { RecordMakeUpDto, SaveLessonDto } from './dto/equipping.dto';

/**
 * Life Class's weekly lessons: 1 to 4 and 6 to 9. Lesson 5 is the Encounter, whose enrollment
 * and attendance are the Registrar's (decision 0501, points 13 and 14).
 */
export const CLASS_LESSONS = [1, 2, 3, 4, 6, 7, 8, 9] as const;

/** Where a lesson stands, said on the Teacher's lesson row and the Coordinator's Classes. */
export type LessonState = 'SAVED' | 'NOT_YET' | 'TODAY' | 'TO_RECORD' | 'LATE' | 'NOT_RECORDED';

function plusDays(day: string, days: number): string {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, date + days)).toISOString().slice(0, 10);
}

/**
 * **The day a lesson is expected** (decision 0503): weekly from the class's first lesson, the
 * Encounter taking lesson 5's week, so lesson n falls n − 1 weeks after the first. The Teacher
 * may record it on another day the class met.
 */
export function expectedOn(firstLessonOn: string, lesson: number): string {
  return plusDays(firstLessonOn, (lesson - 1) * 7);
}

/**
 * Where an unrecorded lesson stands, by its expected day and the database's clock, on Cell
 * attendance's timing (decision 0501, point 11): due eight days after its week, late for three
 * weeks, then closed to everyone but the Admin.
 */
export function unrecordedState(expected: string, now: Date): LessonState {
  const today = manilaDayOf(now);
  if (expected > today) {
    return 'NOT_YET';
  }
  if (expected === today) {
    return 'TODAY';
  }
  if (now.getTime() >= recordClosesAt(expected).getTime()) {
    return 'NOT_RECORDED';
  }
  const due = recordDueAt(expected);
  return due !== null && now.getTime() >= due.getTime() ? 'LATE' : 'TO_RECORD';
}

interface ClassRow {
  id: string;
  name: string;
  day_of_week: number;
  time_of_day: string;
  place: string | null;
  first_lesson_on: string;
  teacher_person_id: string | null;
}

/** One lesson of one student's register, wherever it was marked (decision 0503). */
interface RegisterEntry {
  lesson: number;
  /** The lesson and enrollment a make-up of it is recorded against. */
  lessonId: string;
  enrollmentId: string;
  came: boolean;
  heldOn: string;
  madeUpOn: string | null;
  /** Held by this class before the student joined, with no mark for it anywhere: no absence. */
  beforeJoining: boolean;
  /**
   * The class of the earlier enrollment it was recorded under, for a student moved since, this
   * same class for one who left it and came back; null for the enrollment they are in now.
   */
  fromClass: { id: string; name: string } | null;
}

interface Standing {
  /** The class's Teacher, who records it (decision 0501, point 3). */
  teaches: boolean;
  /** Named a Guide of the class, who sees their own students and records nothing (point 4). */
  guideId: string | null;
  /** `equipping.class` at Whole Church, by default the Admin: any class, and a closed week. */
  wide: boolean;
  /** `equipping.coordinate` at Whole Church: sees the whole class (point 11). */
  coordinates: boolean;
}

/**
 * **A class's attendance and make-ups** (SKILL.md section 29, decisions 0501 and 0503).
 *
 * Every route takes the actor as its target under `equipping.class`, which every Leader holds
 * over themselves and the Admin at Whole Church; this service narrows it. **The Teacher records
 * their own class** while the lesson's week is open, and a make-up at any time; **a Guide sees
 * their own students** and records nothing; the Coordinator sees the whole class; **the Admin
 * may do all of it**, and alone corrects a week that has closed, giving a reason. It reads
 * people and Cells through their services (section 2) and writes only `equipping`'s tables.
 */
@Injectable()
export class EquippingAttendanceService {
  constructor(
    @Inject(DATABASE) private readonly db: Db,
    private readonly people: PeopleReadService,
    private readonly cells: CellsReadService,
    private readonly authorization: AuthorizationService,
    private readonly hierarchy: HierarchyService,
    private readonly audit: AuditService,
    private readonly idempotency: IdempotencyService,
  ) {}

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  /** `GET /equipping/my-classes`: the classes the actor teaches or guides (decision 0501, point 21). */
  async myClasses(actor: Actor): Promise<Record<string, unknown>> {
    const rows = await this.db
      .selectFrom('equipping_classes as c')
      .leftJoin('equipping_class_guides as g', (join) =>
        join
          .onRef('g.class_id', '=', 'c.id')
          .on('g.person_id', '=', actor.personId)
          .on('g.removed_at', 'is', null),
      )
      .select([
        'c.id',
        'c.name',
        'c.day_of_week',
        'c.time_of_day',
        'c.first_lesson_on',
        'c.teacher_person_id',
        'g.id as guide_id',
      ])
      .where((eb) =>
        eb.or([eb('c.teacher_person_id', '=', actor.personId), eb('g.id', 'is not', null)]),
      )
      .orderBy('c.first_lesson_on', 'desc')
      .orderBy('c.name')
      .execute();
    return {
      data: rows.map((row) => ({
        id: row.id,
        name: row.name,
        day_of_week: row.day_of_week,
        time_of_day: String(row.time_of_day).slice(0, 5),
        first_lesson_on: String(row.first_lesson_on),
        role:
          row.teacher_person_id !== null &&
          canonicalId(row.teacher_person_id) === canonicalId(actor.personId)
            ? 'TEACHER'
            : 'GUIDE',
      })),
    };
  }

  /**
   * `GET /equipping/my-people`: **the reader's people in the school** (decision 0501, points 5
   * and 21; decision 0504), each enrolled person their People access reaches, the reader
   * themself left out, with their class, Teacher, Guide and register, read only. Each is placed
   * under the one of the reader's twelve they are reached through, or marked one of the twelve;
   * a person the reader's branch does not reach, which only a grant wider than the branch can
   * give, is placed under nobody. Enrolled means an enrollment that has not ended.
   */
  async myPeople(actor: Actor): Promise<Record<string, unknown>> {
    const scope = await this.authorization.scopeMembership(actor, Capability.PeopleViewSubtree);
    const enrolled = (
      await this.db
        .selectFrom('equipping_enrollments as e')
        .innerJoin('equipping_registrations as r', 'r.id', 'e.registration_id')
        .innerJoin('equipping_classes as c', 'c.id', 'e.class_id')
        .leftJoin('equipping_guide_students as gs', (join) =>
          join.onRef('gs.enrollment_id', '=', 'e.id').on('gs.ended_at', 'is', null),
        )
        .leftJoin('equipping_class_guides as g', 'g.id', 'gs.guide_id')
        .select([
          'e.id as enrollment_id',
          'e.registration_id',
          'e.started_at',
          'r.person_id',
          'c.id as class_id',
          'c.name as class_name',
          'c.level',
          'c.teacher_person_id',
          'g.person_id as guide_person_id',
        ])
        .where('e.ended_at', 'is', null)
        .execute()
    ).filter(
      (row) =>
        canonicalId(row.person_id) !== canonicalId(actor.personId) &&
        (scope.kind === 'WHOLE_CHURCH' || scope.personIds.has(canonicalId(row.person_id))),
    );
    if (enrolled.length === 0) {
      return { data: [] };
    }

    // Who each person is reached through: walking up the reader's own branch to the one of
    // their twelve it passes.
    const leaderOf = new Map(
      (await this.hierarchy.subtreeEdgesOf(actor.personId)).map(
        (edge) => [canonicalId(edge.personId), canonicalId(edge.leaderId)] as const,
      ),
    );
    const me = canonicalId(actor.personId);
    const throughOf = (personId: string): { inBranch: boolean; top: string | null } => {
      let at = canonicalId(personId);
      for (let step = 0; step <= leaderOf.size; step++) {
        const leader = leaderOf.get(at);
        if (leader === undefined) {
          return { inBranch: false, top: null };
        }
        if (leader === me) {
          return { inBranch: true, top: at === canonicalId(personId) ? null : at };
        }
        at = leader;
      }
      return { inBranch: false, top: null };
    };

    const byClass = new Map<string, typeof enrolled>();
    for (const row of enrolled) {
      byClass.set(row.class_id, [...(byClass.get(row.class_id) ?? []), row]);
    }
    const registers = new Map<string, Map<number, RegisterEntry>>();
    for (const [classId, rows] of byClass) {
      for (const [id, register] of await this.registersOf(this.db, classId, rows)) {
        registers.set(id, register);
      }
    }

    const placed = enrolled.map((row) => ({ row, ...throughOf(row.person_id) }));
    const names = await this.people.forDecisions([
      ...enrolled.map((row) => row.person_id),
      ...enrolled.flatMap((row) => (row.teacher_person_id ? [row.teacher_person_id] : [])),
      ...enrolled.flatMap((row) => (row.guide_person_id ? [row.guide_person_id] : [])),
      ...placed.flatMap((p) => (p.top ? [p.top] : [])),
    ]);
    const person = (id: string | null) =>
      id === null ? null : { id, full_name: names.get(id)?.fullName ?? null };

    // Grouped as the screen shows them, the twelve first, then each of the twelve's people under
    // that leader, the leaders in order, then anyone else; inside each, first name, surname, then
    // Member ID, the title never compared (decisions 0359 and 0271).
    const keyOf = (personId: string) => {
      const identity = names.get(personId);
      return {
        firstName: identity?.firstName ?? '',
        lastName: identity?.lastName ?? '',
        memberId: identity?.memberId ?? '',
      };
    };
    const encounters = await this.encounterOf(
      this.db,
      enrolled.map((row) => row.person_id),
    );
    return {
      data: [...placed]
        .sort((a, b) => {
          const rank = (p: (typeof placed)[number]) => (p.inBranch ? (p.top === null ? 0 : 1) : 2);
          return (
            rank(a) - rank(b) ||
            (a.top !== null && b.top !== null
              ? compareRosterKeys(keyOf(a.top), keyOf(b.top))
              : 0) ||
            (a.top ?? '').localeCompare(b.top ?? '') ||
            compareRosterKeys(keyOf(a.row.person_id), keyOf(b.row.person_id))
          );
        })
        .map(({ row, inBranch, top }) => {
          const register = registers.get(row.enrollment_id) ?? new Map<number, RegisterEntry>();
          return {
            enrollment_id: row.enrollment_id,
            person: person(row.person_id),
            level: row.level,
            // One of the reader's twelve; or reached through one of them, named; or neither.
            twelve: inBranch && top === null,
            through: top === null ? null : person(top),
            class: { id: row.class_id, name: row.class_name },
            teacher: person(row.teacher_person_id),
            guide: person(row.guide_person_id),
            joined_on: manilaDayOf(row.started_at),
            encounter: encounters.get(canonicalId(row.person_id)) ?? null,
            marks: CLASS_LESSONS.flatMap((n) => {
              const entry = register.get(n);
              return entry
                ? [
                    {
                      lesson: n,
                      came: entry.came,
                      made_up_on: entry.madeUpOn,
                      held_on: entry.heldOn,
                      before_joining: entry.beforeJoining,
                      from_class: entry.fromClass,
                    },
                  ]
                : [];
            }),
          };
        }),
    };
  }

  /**
   * `GET /equipping/classes/{id}/attendance`: the lesson row, the register and the make-ups still
   * owed (decision 0501, points 10 to 12). A Guide's copy holds their own students alone.
   */
  async classAttendance(actor: Actor, classId: string): Promise<Record<string, unknown>> {
    const cls = await this.classOf(this.db, classId);
    const standing = await this.standingOf(this.db, actor, cls);
    const seesAll = standing.teaches || standing.wide || standing.coordinates;
    if (!seesAll && standing.guideId === null) {
      throw new ScopeDeniedError('You do not teach or guide this class.');
    }

    let enrolled = await this.db
      .selectFrom('equipping_enrollments as e')
      .innerJoin('equipping_registrations as r', 'r.id', 'e.registration_id')
      .leftJoin('equipping_guide_students as gs', (join) =>
        join.onRef('gs.enrollment_id', '=', 'e.id').on('gs.ended_at', 'is', null),
      )
      .leftJoin('equipping_class_guides as g', 'g.id', 'gs.guide_id')
      .select([
        'e.id as enrollment_id',
        'e.registration_id',
        'e.started_at',
        'r.person_id',
        'g.id as guide_id',
        'g.person_id as guide_person_id',
      ])
      .where('e.class_id', '=', classId)
      .where('e.ended_at', 'is', null)
      .execute();
    if (!seesAll) {
      enrolled = enrolled.filter((row) => row.guide_id === standing.guideId);
    }

    const lessons = await this.db
      .selectFrom('equipping_lessons')
      .select(['id', 'lesson', 'held_on', 'version'])
      .where('class_id', '=', classId)
      .execute();
    const registers = await this.registersOf(this.db, classId, enrolled);

    const personIds = enrolled.map((row) => row.person_id);
    const cellsOf = await this.cells.currentCellsOfMany(personIds);
    const leaderIds = [...cellsOf.values()].flatMap((c) =>
      c.membership?.leaderId ? [c.membership.leaderId] : [],
    );
    const guidePersons = enrolled.flatMap((row) =>
      row.guide_person_id ? [row.guide_person_id] : [],
    );
    const names = await this.people.forDecisions([...personIds, ...leaderIds, ...guidePersons]);
    const nameOf = (id: string | null) => (id === null ? null : (names.get(id)?.fullName ?? null));

    const now = await databaseNow(this.db);
    const encounters = await this.encounterOf(this.db, personIds);
    const byNumber = new Map(lessons.map((row) => [row.lesson, row]));
    const lessonRow = CLASS_LESSONS.map((n) => {
      const saved = byNumber.get(n);
      const expected = expectedOn(cls.first_lesson_on, n);
      return {
        lesson: n,
        expected_on: expected,
        held_on: saved ? String(saved.held_on) : null,
        version: saved?.version ?? null,
        state: saved ? 'SAVED' : unrecordedState(expected, now),
        // Whether the Teacher may still change it: its week is open (decision 0501, point 11).
        open: now.getTime() < recordClosesAt(saved ? String(saved.held_on) : expected).getTime(),
        closes_at: recordClosesAt(saved ? String(saved.held_on) : expected).toISOString(),
      };
    });

    const students = enrolled
      .map((row) => {
        const leaderId = cellsOf.get(row.person_id)?.membership?.leaderId ?? null;
        const register = registers.get(row.enrollment_id)!;
        return {
          enrollment_id: row.enrollment_id,
          person: { id: row.person_id, full_name: nameOf(row.person_id) },
          cell_leader: leaderId ? { id: leaderId, full_name: nameOf(leaderId) } : null,
          guide: row.guide_person_id
            ? { id: row.guide_person_id, full_name: nameOf(row.guide_person_id) }
            : null,
          joined_on: manilaDayOf(row.started_at),
          encounter: encounters.get(canonicalId(row.person_id)) ?? null,
          marks: CLASS_LESSONS.flatMap((n) => {
            const entry = register.get(n);
            return entry
              ? [
                  {
                    lesson: n,
                    came: entry.came,
                    made_up_on: entry.madeUpOn,
                    held_on: entry.heldOn,
                    before_joining: entry.beforeJoining,
                    from_class: entry.fromClass,
                  },
                ]
              : [];
          }),
        };
      })
      // First-name order, as every list of people (decision 0359).
      .sort((a, b) => (a.person.full_name ?? '').localeCompare(b.person.full_name ?? ''));

    const owed = students.flatMap((student) =>
      student.marks
        .filter((mark) => !mark.came && mark.made_up_on === null)
        .map((mark) => ({
          enrollment_id: student.enrollment_id,
          person: student.person,
          cell_leader: student.cell_leader,
          lesson: mark.lesson,
          held_on: mark.held_on,
          before_joining: mark.before_joining,
        })),
    );

    return {
      class: {
        id: cls.id,
        name: cls.name,
        day_of_week: cls.day_of_week,
        time_of_day: String(cls.time_of_day).slice(0, 5),
        place: cls.place,
        first_lesson_on: cls.first_lesson_on,
      },
      role: standing.teaches
        ? 'TEACHER'
        : standing.wide
          ? 'ADMIN'
          : standing.coordinates
            ? 'COORDINATOR'
            : 'GUIDE',
      may_record: standing.teaches || standing.wide,
      may_correct_closed: standing.wide,
      lessons: lessonRow,
      students,
      owed,
    };
  }

  /**
   * Which unrecorded lessons of each class are late, and which closed with nothing recorded, for
   * the Coordinator's *Attendance* column (decision 0501, point 22): *L1 not recorded · L3 late*.
   */
  async lessonProblemsOf(
    classes: readonly { id: string; first_lesson_on: string }[],
  ): Promise<Map<string, { late: number[]; not_recorded: number[] }>> {
    const result = new Map<string, { late: number[]; not_recorded: number[] }>();
    if (classes.length === 0) {
      return result;
    }
    const saved = await this.db
      .selectFrom('equipping_lessons')
      .select(['class_id', 'lesson'])
      .where(
        'class_id',
        'in',
        classes.map((c) => c.id),
      )
      .execute();
    const done = new Set(saved.map((row) => `${row.class_id}:${row.lesson}`));
    const now = await databaseNow(this.db);
    for (const cls of classes) {
      const states = CLASS_LESSONS.filter((n) => !done.has(`${cls.id}:${n}`)).map((n) => ({
        n,
        state: unrecordedState(expectedOn(cls.first_lesson_on, n), now),
      }));
      result.set(cls.id, {
        late: states.filter((s) => s.state === 'LATE').map((s) => s.n),
        not_recorded: states.filter((s) => s.state === 'NOT_RECORDED').map((s) => s.n),
      });
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // Writes
  // ---------------------------------------------------------------------------

  /**
   * `POST /equipping/classes/{id}/lessons/{lesson}`: who came (decision 0501, point 10), anyone
   * enrolled and not listed saved Absent. The first save records the lesson; a later save
   * corrects it, each changed mark closed and a new one opened (principle 12). A save that
   * changes nothing writes nothing.
   */
  async saveLesson(
    actor: Actor,
    classId: string,
    lesson: number,
    body: SaveLessonDto,
    claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    if (!(CLASS_LESSONS as readonly number[]).includes(lesson)) {
      throw new ValidationFailedError(
        'A class records lessons 1 to 4 and 6 to 9; lesson 5 is the Encounter, the Registrar’s.',
        { field: 'lesson' },
      );
    }
    return this.db.transaction().execute(async (trx) => {
      const cls = await this.lockClassWithin(trx, classId);
      const standing = await this.standingOf(trx, actor, cls);
      if (!standing.teaches && !standing.wide) {
        throw new ScopeDeniedError(
          'Only the class’s Teacher records its attendance (SKILL.md section 29).',
        );
      }
      const now = await databaseNow(trx);
      const today = manilaDayOf(now);
      if (body.held_on > today) {
        throw new ValidationFailedError('A lesson is recorded on or after the day it was held.', {
          field: 'held_on',
        });
      }
      if (body.held_on < cls.first_lesson_on) {
        throw new ValidationFailedError('A lesson is held on or after the class’s first lesson.', {
          field: 'held_on',
        });
      }

      const existing = await trx
        .selectFrom('equipping_lessons')
        .select(['id', 'held_on', 'version'])
        .where('class_id', '=', classId)
        .where('lesson', '=', lesson)
        .forUpdate()
        .executeTakeFirst();
      if (existing && body.version !== existing.version) {
        throw new ApiError(
          ApiErrorCode.VERSION_CONFLICT,
          'This lesson was saved since you opened it. Reload to see what was saved.',
          { lesson, current_version: existing.version },
        );
      }

      // Both weeks open, the one it stood in and the one it moves to (decision 0503, point 1). A
      // lesson never recorded stands in its expected date's week, so dating it today does not
      // reopen a week that has closed.
      const open = (day: string) => now.getTime() < recordClosesAt(day).getTime();
      const stoodIn = existing ? String(existing.held_on) : expectedOn(cls.first_lesson_on, lesson);
      const weeksOpen = open(body.held_on) && open(stoodIn);
      if (!weeksOpen && !standing.wide) {
        throw new ApiError(
          ApiErrorCode.PERIOD_CLOSED,
          'This lesson’s week has closed. Only the Admin corrects it, with a reason.',
          { lesson },
        );
      }
      if (!weeksOpen && body.correction_reason === undefined) {
        throw new ValidationFailedError('A closed week is corrected with a reason.', {
          field: 'correction_reason',
        });
      }
      if (weeksOpen && body.correction_reason !== undefined) {
        throw new InvariantViolationError(
          'This lesson’s week is still open, so it needs no reason. Save without one.',
          { field: 'correction_reason' },
        );
      }

      const enrolled = await trx
        .selectFrom('equipping_enrollments as e')
        .innerJoin('equipping_registrations as r', 'r.id', 'e.registration_id')
        .select(['e.id', 'e.registration_id', 'r.person_id', 'e.started_at'])
        .where('e.class_id', '=', classId)
        .where('e.ended_at', 'is', null)
        // One order, so a body refused for two reasons is always refused for the same one.
        .orderBy('e.id')
        .execute();
      // Joined after the day the lesson was held: not saved Absent, and owed it as a make-up
      // rather than an absence (decision 0503, owner ruling of 2026-11-20).
      const joinedAfter = (row: { started_at: Date }) => manilaDayOf(row.started_at) > body.held_on;
      const enrolledIds = new Set(enrolled.map((row) => canonicalId(row.id)));
      const came = new Set(body.came.map((id) => canonicalId(id)));
      for (const id of came) {
        if (!enrolledIds.has(id)) {
          throw new ValidationFailedError('Somebody ticked is not enrolled in this class.', {
            field: 'came',
          });
        }
      }

      // A make-up falls after the lesson it makes up (decision 0503, point 2), so a date may not
      // move past one already recorded.
      const dateMoved = existing !== undefined && String(existing.held_on) !== body.held_on;
      if (existing && dateMoved) {
        const earlier = await trx
          .selectFrom('equipping_make_ups')
          .select('made_up_on')
          .where('lesson_id', '=', existing.id)
          .where('superseded_at', 'is', null)
          .where('made_up_on', '<', body.held_on)
          .executeTakeFirst();
        if (earlier) {
          throw new InvariantViolationError(
            'A make-up of this lesson is dated before that day. Correct the make-up first.',
            { field: 'held_on' },
          );
        }
      }

      let lessonId: string;
      let version: number;
      if (!existing) {
        const inserted = await trx
          .insertInto('equipping_lessons')
          .values({
            class_id: classId,
            lesson,
            held_on: body.held_on,
            recorded_by: actor.accountId,
          })
          .returning(['id', 'version'])
          .executeTakeFirstOrThrow();
        lessonId = inserted.id;
        version = inserted.version;
      } else {
        lessonId = existing.id;
        version = existing.version;
      }

      const current = await trx
        .selectFrom('equipping_marks')
        .select(['id', 'enrollment_id', 'came'])
        .where('lesson_id', '=', lessonId)
        .where('superseded_at', 'is', null)
        .execute();
      const currentOf = new Map(current.map((row) => [canonicalId(row.enrollment_id), row]));
      // **One class at a time** (owner, 2026-11-21): a save writes marks in its own class and
      // nowhere else. A moved student's register reads this class's mark for a lesson first and
      // the class they moved from only where this class has none (`registersOf`), so what an
      // earlier class recorded is never closed or reopened from here.
      //
      // Recorded for this lesson in a class they moved from: came there, that mark stands and is
      // not repeated here; absent there, or made up there as a lesson held before they joined, it
      // stands unless they are ticked here, whose mark then reads first (decision 0503, point 5).
      // Read from the register, so the save and the screen take the same earlier class.
      const registers = await this.registersOf(
        trx,
        classId,
        enrolled.map((row) => ({
          enrollment_id: row.id,
          registration_id: row.registration_id,
          started_at: row.started_at,
        })),
      );
      const carried = new Map(
        enrolled.flatMap((row) => {
          const entry = registers.get(row.id)?.get(lesson);
          return entry && entry.enrollmentId !== row.id
            ? [[canonicalId(row.id), entry] as const]
            : [];
        }),
      );
      const changed: { person_id: string; came: boolean; before: boolean | null }[] = [];
      // Marks a date corrected to before the student joined removed (owner, 2026-11-21).
      const unmarked: { person_id: string; came: boolean }[] = [];
      // Make-ups closed because the student is now marked as having come, kept for the audit entry.
      const makeUpsClosed: { person_id: string; made_up_on: string }[] = [];
      const marked: typeof enrolled = [];
      for (const row of enrolled) {
        const want = came.has(canonicalId(row.id));
        const was = currentOf.get(canonicalId(row.id));
        const fromBefore = was ? undefined : carried.get(canonicalId(row.id));
        // Came there, or absent there and not ticked here: the earlier mark stands.
        const elsewhere = fromBefore !== undefined && (fromBefore.came || !want);
        // **A date corrected to before a student joined removes their mark here**: closed and
        // kept, the lesson is one held before they joined, and any earlier class's mark for it
        // reads again (owner, 2026-11-21).
        if (was && joinedAfter(row) && !want) {
          await trx
            .updateTable('equipping_marks')
            .set({ superseded_at: sql<Date>`now()`, superseded_by: actor.accountId })
            .where('id', '=', was.id)
            .execute();
          unmarked.push({ person_id: row.person_id, came: was.came });
          continue;
        }
        if (joinedAfter(row) || elsewhere) {
          if (want) {
            throw new ValidationFailedError(
              elsewhere
                ? 'Somebody ticked already came to this lesson in a class they were in before.'
                : 'Somebody ticked joined the class after this lesson; they make it up instead.',
              { field: 'came' },
            );
          }
          continue;
        }
        marked.push(row);
        if (was && was.came === want) {
          continue;
        }
        if (was) {
          await trx
            .updateTable('equipping_marks')
            .set({ superseded_at: sql<Date>`now()`, superseded_by: actor.accountId })
            .where('id', '=', was.id)
            .execute();
        }
        // Marked as having come: a make-up of this lesson here no longer stands, whether it made
        // up an absence or a lesson the date had placed before they joined.
        if (want) {
          const closedMakeUps = await trx
            .updateTable('equipping_make_ups')
            .set({ superseded_at: sql<Date>`now()`, superseded_by: actor.accountId })
            .where('lesson_id', '=', lessonId)
            .where('enrollment_id', '=', row.id)
            .where('superseded_at', 'is', null)
            .returning('made_up_on')
            .execute();
          for (const closedMakeUp of closedMakeUps) {
            makeUpsClosed.push({
              person_id: row.person_id,
              made_up_on: String(closedMakeUp.made_up_on),
            });
          }
        }
        await trx
          .insertInto('equipping_marks')
          .values({
            lesson_id: lessonId,
            enrollment_id: row.id,
            came: want,
            recorded_by: actor.accountId,
            // The Admin's reason for a closed week, kept on every mark it writes, a first one
            // included (principle 12).
            correction_reason: body.correction_reason ?? null,
          })
          .execute();
        changed.push({ person_id: row.person_id, came: want, before: was ? was.came : null });
      }

      // A date changed keeps the date it changed, as a mark keeps the mark (principle 12).
      if (existing && dateMoved) {
        await trx
          .insertInto('equipping_lesson_date_changes')
          .values({
            lesson_id: lessonId,
            held_on_before: String(existing.held_on),
            held_on_after: body.held_on,
            changed_by: actor.accountId,
            reason: body.correction_reason ?? null,
          })
          .execute();
      }
      const corrected = dateMoved || changed.length > 0 || unmarked.length > 0;
      if (existing && corrected) {
        const updated = await trx
          .updateTable('equipping_lessons')
          .set({
            held_on: body.held_on,
            recorded_by: actor.accountId,
            recorded_at: sql<Date>`now()`,
            version: sql<number>`version + 1`,
          })
          .where('id', '=', lessonId)
          .returning('version')
          .executeTakeFirstOrThrow();
        version = updated.version;
      }

      if (!existing) {
        await this.audit.writeWithin(trx, {
          actorId: actor.accountId,
          action: 'equipping_lesson.recorded',
          targetType: 'equipping_class',
          targetId: classId,
          before: null,
          after: {
            lesson,
            held_on: body.held_on,
            came: changed.filter((c) => c.came).map((c) => c.person_id),
            absent: changed.filter((c) => !c.came).map((c) => c.person_id),
            ...(makeUpsClosed.length > 0 ? { make_ups_closed: makeUpsClosed } : {}),
            ...(body.correction_reason !== undefined ? { reason: body.correction_reason } : {}),
          },
        });
      } else if (corrected) {
        await this.audit.writeWithin(trx, {
          actorId: actor.accountId,
          action: 'equipping_lesson.corrected',
          targetType: 'equipping_class',
          targetId: classId,
          before: {
            lesson,
            held_on: String(existing.held_on),
            marks: [
              ...changed.map((c) => ({ person_id: c.person_id, came: c.before })),
              // Marks the corrected date removed, their values here and none after.
              ...unmarked,
            ],
          },
          after: {
            lesson,
            held_on: body.held_on,
            marks: changed.map((c) => ({ person_id: c.person_id, came: c.came })),
            ...(unmarked.length > 0 ? { marks_removed: unmarked.map((u) => u.person_id) } : {}),
            ...(makeUpsClosed.length > 0 ? { make_ups_closed: makeUpsClosed } : {}),
            ...(body.correction_reason !== undefined ? { reason: body.correction_reason } : {}),
          },
        });
      }

      const response = {
        class_id: classId,
        lesson,
        held_on: body.held_on,
        version,
        came: marked.filter((row) => came.has(canonicalId(row.id))).length,
        absent: marked.filter((row) => !came.has(canonicalId(row.id))).length,
      };
      await this.idempotency.completeWithin(trx, { ...claim, status: 200, body: response });
      return response;
    });
  }

  /**
   * `POST /equipping/classes/{id}/make-ups`: a missed lesson made up, recorded as M with its date
   * (decision 0501, point 12). The Teacher may record one at any time until the term's final
   * grades are posted, which nothing posts yet; a later date for the same make-up corrects it.
   */
  async recordMakeUp(
    actor: Actor,
    classId: string,
    body: RecordMakeUpDto,
    claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    return this.db.transaction().execute(async (trx) => {
      const cls = await this.lockClassWithin(trx, classId);
      const standing = await this.standingOf(trx, actor, cls);
      if (!standing.teaches && !standing.wide) {
        throw new ScopeDeniedError(
          'Only the class’s Teacher records a make-up (SKILL.md section 29).',
        );
      }
      const student = await trx
        .selectFrom('equipping_enrollments as e')
        .innerJoin('equipping_registrations as r', 'r.id', 'e.registration_id')
        .select(['e.id', 'e.registration_id', 'e.started_at', 'r.person_id'])
        .where('e.id', '=', body.enrollment_id)
        .where('e.class_id', '=', classId)
        .where('e.ended_at', 'is', null)
        .executeTakeFirst();
      if (!student) {
        throw new NotFoundError('No such student in this class.', { field: 'enrollment_id' });
      }
      // The lesson as the student's register reads it: missed here, missed in a class they moved
      // from, or held here before they joined (decision 0503). The make-up is recorded against
      // the lesson and enrollment it was missed under.
      const registers = await this.registersOf(trx, classId, [
        {
          enrollment_id: student.id,
          registration_id: student.registration_id,
          started_at: student.started_at,
        },
      ]);
      const target = registers.get(student.id)!.get(body.lesson);
      if (!target) {
        throw new NotFoundError('That lesson has not been recorded yet.', { field: 'lesson' });
      }
      if (target.came) {
        throw new InvariantViolationError('A make-up is of a lesson the student missed.', {
          field: 'lesson',
        });
      }
      // The lesson missed, held FOR SHARE before its date is checked: for a moved student it is
      // another class's, whose lock this save does not hold, so its date could otherwise move
      // under the check and reach the trigger as a 500 (decision 0158).
      const missed = await trx
        .selectFrom('equipping_lessons')
        .select('held_on')
        .where('id', '=', target.lessonId)
        .forShare()
        .executeTakeFirstOrThrow();
      const missedOn = String(missed.held_on);
      const today = manilaDayOf(await databaseNow(trx));
      if (body.made_up_on > today || body.made_up_on < missedOn) {
        throw new ValidationFailedError('A make-up falls between the missed lesson and today.', {
          field: 'made_up_on',
        });
      }
      const lesson = { id: target.lessonId };
      const was = await trx
        .selectFrom('equipping_make_ups')
        .select(['id', 'made_up_on'])
        .where('lesson_id', '=', target.lessonId)
        .where('enrollment_id', '=', target.enrollmentId)
        .where('superseded_at', 'is', null)
        .forUpdate()
        .executeTakeFirst();
      if (!was || String(was.made_up_on) !== body.made_up_on) {
        // **A carried make-up stands as its class recorded it** (owner, 2026-11-21). One made in
        // an earlier class for a lesson held before the student joined it keeps reading as made up
        // even after that class moves the lesson to on or after the day they joined; it is then no
        // longer a lesson held before they joined, so it is not changed from here.
        if (target.beforeJoining && target.enrollmentId !== student.id) {
          const earlier = await trx
            .selectFrom('equipping_enrollments')
            .select('started_at')
            .where('id', '=', target.enrollmentId)
            .executeTakeFirstOrThrow();
          if (missedOn >= manilaDayOf(earlier.started_at)) {
            throw new InvariantViolationError(
              'This make-up stands as the class it was recorded in left it: that class has since moved the lesson to on or after the day the student joined it, so it is not changed from here.',
              { field: 'lesson' },
            );
          }
        }
        if (was) {
          await trx
            .updateTable('equipping_make_ups')
            .set({ superseded_at: sql<Date>`now()`, superseded_by: actor.accountId })
            .where('id', '=', was.id)
            .execute();
        }
        await trx
          .insertInto('equipping_make_ups')
          .values({
            lesson_id: lesson.id,
            enrollment_id: target.enrollmentId,
            made_up_on: body.made_up_on,
            recorded_by: actor.accountId,
          })
          .execute();
        // The class the lesson was missed in, which is an earlier one for a moved student.
        const missedIn = target.fromClass?.id ?? classId;
        await this.audit.writeWithin(trx, {
          actorId: actor.accountId,
          action: 'equipping_make_up.recorded',
          targetType: 'person',
          targetId: student.person_id,
          before: was
            ? { class_id: missedIn, lesson: body.lesson, made_up_on: String(was.made_up_on) }
            : null,
          after: {
            class_id: missedIn,
            lesson: body.lesson,
            made_up_on: body.made_up_on,
            ...(target.beforeJoining ? { before_joining: true } : {}),
          },
        });
      }
      const response = {
        class_id: classId,
        enrollment_id: student.id,
        lesson: body.lesson,
        made_up_on: body.made_up_on,
      };
      await this.idempotency.completeWithin(trx, { ...claim, status: 201, body: response });
      return response;
    });
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * **Each student's register, lesson by lesson** (decision 0503, owner rulings of 2026-11-20).
   * A mark hangs on the enrollment it was saved under, and a move opens a new enrollment on the
   * same registration, so a moved student's marks are read from every class the registration
   * has been in, the enrollment they are in now first and then the earlier ones latest first
   * (section 29: what is recorded carries with a move), a make-up of a lesson held before they
   * joined an earlier class carried with them as well (owner, 2026-11-21). A lesson
   * this class held before the student joined, with no mark for it anywhere, is *before
   * joining*: owed as a make-up and not an absence. Keyed by enrollment, then lesson number.
   */
  async registersOf(
    executor: Db | Transaction<Database>,
    classId: string,
    rows: readonly { enrollment_id: string; registration_id: string; started_at: Date }[],
  ): Promise<Map<string, Map<number, RegisterEntry>>> {
    const result = new Map<string, Map<number, RegisterEntry>>();
    if (rows.length === 0) {
      return result;
    }
    const all = await executor
      .selectFrom('equipping_enrollments as e')
      .innerJoin('equipping_classes as c', 'c.id', 'e.class_id')
      .select(['e.id', 'e.registration_id', 'e.class_id', 'e.started_at', 'c.name'])
      .where(
        'e.registration_id',
        'in',
        rows.map((row) => row.registration_id),
      )
      .execute();
    const classIds = [...new Set(all.map((row) => row.class_id))];
    const enrollmentIds = all.map((row) => row.id);
    const [lessons, marks, makeUps] = await Promise.all([
      executor
        .selectFrom('equipping_lessons')
        .select(['id', 'class_id', 'lesson', 'held_on'])
        .where('class_id', 'in', classIds)
        .execute(),
      executor
        .selectFrom('equipping_marks')
        .select(['lesson_id', 'enrollment_id', 'came'])
        .where('enrollment_id', 'in', enrollmentIds)
        .where('superseded_at', 'is', null)
        .execute(),
      executor
        .selectFrom('equipping_make_ups')
        .select(['lesson_id', 'enrollment_id', 'made_up_on'])
        .where('enrollment_id', 'in', enrollmentIds)
        .where('superseded_at', 'is', null)
        .execute(),
    ]);
    const lessonById = new Map(lessons.map((row) => [row.id, row]));
    const madeUpOf = new Map(
      makeUps.map((row) => [`${row.lesson_id}:${row.enrollment_id}`, String(row.made_up_on)]),
    );
    const enrollmentById = new Map(all.map((row) => [row.id, row]));

    const markKeys = new Set(marks.map((row) => `${row.lesson_id}:${row.enrollment_id}`));

    for (const row of rows) {
      const joinedOn = manilaDayOf(row.started_at);
      const register = new Map<number, RegisterEntry>();
      const here: RegisterEntry[] = [];
      const elsewhere: { entry: RegisterEntry; startedAt: number; enrollmentId: string }[] = [];
      // Only the enrollment the student is in now is *here*. An earlier enrollment is earlier
      // even when it was in this same class, a student back in a class they left included.
      const place = (enrollmentId: string, entry: RegisterEntry) => {
        const enrollment = enrollmentById.get(enrollmentId)!;
        if (enrollmentId === row.enrollment_id) {
          here.push(entry);
        } else {
          elsewhere.push({
            entry,
            startedAt: enrollment.started_at.getTime(),
            enrollmentId,
          });
        }
      };
      // Named for every earlier enrollment, this same class included, so the screen never takes
      // a record from a stint the student has left for one saved under the enrollment they are
      // in now.
      const fromClassOf = (enrollmentId: string) => {
        const enrollment = enrollmentById.get(enrollmentId)!;
        return { id: enrollment.class_id, name: enrollment.name };
      };
      for (const mark of marks) {
        const enrollment = enrollmentById.get(mark.enrollment_id)!;
        if (enrollment.registration_id !== row.registration_id) {
          continue;
        }
        const lesson = lessonById.get(mark.lesson_id)!;
        place(mark.enrollment_id, {
          lesson: lesson.lesson,
          lessonId: lesson.id,
          enrollmentId: mark.enrollment_id,
          came: mark.came,
          heldOn: String(lesson.held_on),
          madeUpOn: madeUpOf.get(`${lesson.id}:${mark.enrollment_id}`) ?? null,
          beforeJoining: false,
          fromClass:
            mark.enrollment_id === row.enrollment_id ? null : fromClassOf(mark.enrollment_id),
        });
      }
      // **A make-up of a lesson held before they joined carries with a move** (owner,
      // 2026-11-21): recorded in an earlier class with no mark behind it, it reads in the new
      // class as made up, and is not owed again.
      for (const makeUp of makeUps) {
        const enrollment = enrollmentById.get(makeUp.enrollment_id)!;
        if (
          enrollment.registration_id !== row.registration_id ||
          makeUp.enrollment_id === row.enrollment_id ||
          markKeys.has(`${makeUp.lesson_id}:${makeUp.enrollment_id}`)
        ) {
          continue;
        }
        const lesson = lessonById.get(makeUp.lesson_id)!;
        place(makeUp.enrollment_id, {
          lesson: lesson.lesson,
          lessonId: lesson.id,
          enrollmentId: makeUp.enrollment_id,
          came: false,
          heldOn: String(lesson.held_on),
          madeUpOn: String(makeUp.made_up_on),
          beforeJoining: true,
          fromClass: fromClassOf(makeUp.enrollment_id),
        });
      }
      // The latest enrollment first among the earlier ones, so a lesson recorded in two earlier
      // classes reads the one they moved from last. The same order as the save reads it.
      elsewhere.sort(
        (a, b) => b.startedAt - a.startedAt || a.enrollmentId.localeCompare(b.enrollmentId),
      );
      for (const entry of [...here, ...elsewhere.map((e) => e.entry)]) {
        if (!register.has(entry.lesson)) {
          register.set(entry.lesson, entry);
        }
      }
      for (const lesson of lessons) {
        if (
          lesson.class_id === classId &&
          !register.has(lesson.lesson) &&
          String(lesson.held_on) < joinedOn
        ) {
          register.set(lesson.lesson, {
            lesson: lesson.lesson,
            lessonId: lesson.id,
            enrollmentId: row.enrollment_id,
            came: false,
            heldOn: String(lesson.held_on),
            madeUpOn: madeUpOf.get(`${lesson.id}:${row.enrollment_id}`) ?? null,
            beforeJoining: true,
            fromClass: null,
          });
        }
      }
      result.set(row.enrollment_id, register);
    }
    return result;
  }

  /**
   * **The register's ENC column** (decision 0501, point 14; decision 0507), for each person:
   * `CAME` once they attended an Encounter, else `ENROLLED` while a weekend they are enrolled
   * in has no attendance recorded, else `MISSED` when they were enrolled and did not come. A
   * person never enrolled in one has no entry.
   */
  async encounterOf(
    executor: Db | Transaction<Database>,
    personIds: readonly string[],
  ): Promise<Map<string, 'CAME' | 'ENROLLED' | 'MISSED'>> {
    const result = new Map<string, 'CAME' | 'ENROLLED' | 'MISSED'>();
    if (personIds.length === 0) {
      return result;
    }
    const rows = await executor
      .selectFrom('equipping_encounter_enrollments as ee')
      .leftJoin('equipping_encounter_attendance as a', (join) =>
        join.onRef('a.encounter_enrollment_id', '=', 'ee.id').on('a.superseded_at', 'is', null),
      )
      .select(['ee.person_id', 'a.came'])
      .where('ee.person_id', 'in', [...personIds])
      .execute();
    const rank = { CAME: 3, ENROLLED: 2, MISSED: 1 } as const;
    for (const row of rows) {
      const state = row.came === true ? 'CAME' : row.came === false ? 'MISSED' : 'ENROLLED';
      const id = canonicalId(row.person_id);
      const was = result.get(id);
      if (was === undefined || rank[state] > rank[was]) {
        result.set(id, state);
      }
    }
    return result;
  }

  private async classOf(executor: Db | Transaction<Database>, classId: string): Promise<ClassRow> {
    const cls = await executor
      .selectFrom('equipping_classes')
      .select([
        'id',
        'name',
        'day_of_week',
        'time_of_day',
        'place',
        'first_lesson_on',
        'teacher_person_id',
      ])
      .where('id', '=', classId)
      .executeTakeFirst();
    if (cls === undefined) {
      throw new NotFoundError('No such class.');
    }
    return {
      ...cls,
      first_lesson_on: String(cls.first_lesson_on),
      time_of_day: String(cls.time_of_day),
    };
  }

  /**
   * The class, locked FOR NO KEY UPDATE, the mode the Guides take (decision 0502), so a save
   * waits behind a Teacher change or a share-out rather than beside it.
   */
  private async lockClassWithin(trx: Transaction<Database>, classId: string): Promise<ClassRow> {
    const cls = await trx
      .selectFrom('equipping_classes')
      .select([
        'id',
        'name',
        'day_of_week',
        'time_of_day',
        'place',
        'first_lesson_on',
        'teacher_person_id',
      ])
      .where('id', '=', classId)
      .forNoKeyUpdate()
      .executeTakeFirst();
    if (cls === undefined) {
      throw new NotFoundError('No such class.');
    }
    return {
      ...cls,
      first_lesson_on: String(cls.first_lesson_on),
      time_of_day: String(cls.time_of_day),
    };
  }

  private async standingOf(
    executor: Db | Transaction<Database>,
    actor: Actor,
    cls: ClassRow,
  ): Promise<Standing> {
    const [authority, guide] = await Promise.all([
      this.authorization.authorityFor(actor.accountId),
      executor
        .selectFrom('equipping_class_guides')
        .select('id')
        .where('class_id', '=', cls.id)
        .where('person_id', '=', actor.personId)
        .where('removed_at', 'is', null)
        .executeTakeFirst(),
    ]);
    return {
      teaches:
        cls.teacher_person_id !== null &&
        canonicalId(cls.teacher_person_id) === canonicalId(actor.personId),
      guideId: guide?.id ?? null,
      wide: holdsWholeChurch(authority, Capability.EquippingClass),
      coordinates: holdsWholeChurch(authority, Capability.EquippingCoordinate),
    };
  }
}
