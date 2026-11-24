import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';

import { AuditService } from '../audit/audit.service';
import { Capability } from '../auth/authorization/capabilities';
import {
  AuthorizationService,
  holdsWholeChurch,
  type Actor,
} from '../auth/authorization/authorization.service';
import {
  ApiError,
  ApiErrorCode,
  InvariantViolationError,
  NotFoundError,
} from '../common/errors/api-error';
import { canonicalId } from '../common/identifiers';
import { IdempotencyService } from '../common/idempotency/idempotency.service';
import { isUniqueViolation, violatedConstraint } from '../common/errors/postgres-errors';
import { manilaDayOf } from '../common/time/manila';
import { DATABASE, type Db } from '../database/database.module';
import { HierarchyService } from '../hierarchy/hierarchy.service';
import { PeopleReadService } from '../people/people.read.service';
import { TrainingService } from '../training/training.service';

import { CLASS_LESSONS, EquippingAttendanceService } from './equipping-attendance.service';

import type { CurrentClaim } from '../common/idempotency/current-idempotency.decorator';
import type { Database } from '../database/schema';
import type { EquippingTermDto } from './dto/equipping.dto';

/** The register's nine columns: lessons 1 to 4, the Encounter as 5, then 6 to 9. */
const COLUMNS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

/** At most three absences in the whole of Life Class, each made up (0501, point 13). */
const ABSENCES_ALLOWED = 3;
/** Lessons 1 to 4 keep their own limit of two (0501, point 13). */
const EARLY_ABSENCES_ALLOWED = 2;

export type Grade = 'PASSED' | 'NOT_PASSED' | 'NOT_YET';
type Sign = 'CAME' | 'MADE_UP' | 'ABSENT' | 'BEFORE_JOINING' | 'NONE';
type Phase = 'NOT_READY' | 'WAITING_COORDINATOR' | 'WAITING_ADMIN' | 'READY' | 'POSTED';

interface StudentGrade {
  enrollment_id: string;
  person_id: string;
  grade: Grade;
  reason: string;
  lessons_kept: number;
  lessons_made_up: number;
  /** Joins a later class at Lesson 6 (decision 0512), recorded with the grade. */
  joins_at_lesson_6: boolean;
  signs: Sign[];
}

interface CheckRow {
  id: string;
  checked_by: string;
  checker_person_id: string | null;
  by_admin: boolean;
  checked_at: Date;
  fingerprint: string;
}

/**
 * **A class's final grades** (SKILL.md section 29, decisions 0501 and 0508).
 *
 * The grade is worked out from the register, never typed (0501, point 15): *Passed* once every
 * lesson is done with at most three absences, each made up, and the Encounter attended; *Not
 * passed* with the reason; *Not yet* for a student who has still to attend the Encounter, who
 * passes after a later one (decision 0508). The Coordinator marks the class checked, the Admin
 * checking any student who is that Coordinator's own disciple (point 16); a check stands only
 * while the grades are exactly as checked. The Registrar posts a checked class, which records each
 * grade as it stood and ends the enrollments that finished. Reads people and the tree through
 * their services (section 2) and writes only `equipping`'s tables.
 */
@Injectable()
export class EquippingGradesService {
  constructor(
    @Inject(DATABASE) private readonly db: Db,
    private readonly people: PeopleReadService,
    private readonly hierarchy: HierarchyService,
    private readonly authorization: AuthorizationService,
    private readonly attendance: EquippingAttendanceService,
    private readonly training: TrainingService,
    private readonly audit: AuditService,
    private readonly idempotency: IdempotencyService,
  ) {}

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  /** `GET /equipping/final-grades`: the term's classes, each with where it stands. */
  async classes(query: EquippingTermDto): Promise<Record<string, unknown>> {
    const rows = await this.db
      .selectFrom('equipping_classes')
      .select(['id', 'name', 'day_of_week', 'time_of_day'])
      .where('level', '=', query.level)
      .where('term_year', '=', query.term_year)
      .where('term_number', '=', query.term_number)
      // A cancelled class never had a lesson, so has nothing to post (decision 0510).
      .where('cancelled_at', 'is', null)
      .orderBy('name')
      .execute();
    const data = [];
    for (const row of rows) {
      const standing = await this.standingWithin(this.db, row.id);
      data.push({
        id: row.id,
        name: row.name,
        day_of_week: row.day_of_week,
        time_of_day: String(row.time_of_day).slice(0, 5),
        status: await this.statusOf(standing),
      });
    }
    return { data };
  }

  /**
   * One class's grades, for the Registrar or the Coordinator. `actor` marks which students are
   * the reader's own disciples, whom the Admin checks instead (0501, point 16).
   */
  async classGrades(actor: Actor, classId: string): Promise<Record<string, unknown>> {
    const standing = await this.standingWithin(this.db, classId);
    const leaders = await this.hierarchy.directLeaderIdsOf(
      standing.students.map((s) => s.person_id),
    );
    const names = await this.people.forDecisions(standing.students.map((s) => s.person_id));
    const authority = await this.authorization.authorityFor(actor.accountId);
    const admin = holdsWholeChurch(authority, Capability.EquippingClass);
    const mine = (personId: string) =>
      !admin &&
      actor.personId !== null &&
      canonicalId(leaders.get(personId) ?? '') === canonicalId(actor.personId);
    return {
      class: standing.class,
      status: await this.statusOf(standing),
      may_check: standing.posting === null && standing.missing.length === 0,
      checks_as: admin ? 'ADMIN' : 'COORDINATOR',
      // What *Mark as checked* sends back, so a register changed since it was read is refused.
      fingerprint: standing.fingerprint,
      students: standing.students
        .map((s) => ({
          enrollment_id: s.enrollment_id,
          person: { id: s.person_id, full_name: names.get(s.person_id)?.fullName ?? null },
          grade: s.grade,
          reason: s.reason,
          lessons_kept: s.lessons_kept,
          lessons_made_up: s.lessons_made_up,
          lessons: s.signs,
          your_disciple: mine(s.person_id),
        }))
        .sort((a, b) => (a.person.full_name ?? '').localeCompare(b.person.full_name ?? '')),
    };
  }

  // ---------------------------------------------------------------------------
  // Writes
  // ---------------------------------------------------------------------------

  /** `POST /equipping/coordinate/classes/{id}/check`: *Mark as checked* (0501, point 16). */
  async check(
    actor: Actor,
    classId: string,
    readFingerprint: string | null,
    claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    return this.db.transaction().execute(async (trx) => {
      await this.lockClassWithin(trx, classId);
      const standing = await this.standingWithin(trx, classId);
      if (standing.posting !== null) {
        throw new InvariantViolationError('This class has been posted.', { field: 'id' });
      }
      if (standing.missing.length > 0) {
        throw new InvariantViolationError(
          `Not every lesson is recorded yet: ${joinLessons(standing.missing)}.`,
          { field: 'id' },
        );
      }
      // **A check certifies the register the Coordinator read** (0501, point 16): one changed
      // since is refused, as a stale copy is elsewhere (section 22).
      if (standing.fingerprint !== readFingerprint) {
        throw new ApiError(
          ApiErrorCode.VERSION_CONFLICT,
          'The grades changed since you opened them. Reload to see them as they are now.',
          { field: 'fingerprint' },
        );
      }
      const authority = await this.authorization.authorityFor(actor.accountId);
      const byAdmin = holdsWholeChurch(authority, Capability.EquippingClass);
      const check = await trx
        .insertInto('equipping_class_checks')
        .values({
          class_id: classId,
          checked_by: actor.accountId,
          checker_person_id: actor.personId,
          by_admin: byAdmin,
          fingerprint: standing.fingerprint,
        })
        .returning(['id', 'checked_at'])
        .executeTakeFirstOrThrow();
      await this.audit.writeWithin(trx, {
        actorId: actor.accountId,
        action: 'equipping_class.checked',
        targetType: 'equipping_class',
        targetId: classId,
        before: null,
        after: { by_admin: byAdmin, class_name: standing.class.name },
      });
      const response = { class_id: classId, check_id: check.id, by_admin: byAdmin };
      await this.idempotency.completeWithin(trx, { ...claim, status: 200, body: response });
      return response;
    });
  }

  /**
   * `POST /equipping/final-grades/classes/{id}/post`: records each grade as it stands and ends
   * the enrollments that finished, *Passed* and *Not passed*. One *Not yet* stays enrolled, so
   * a later Encounter weekend still lists them (decision 0508).
   */
  async post(actor: Actor, classId: string, claim: CurrentClaim): Promise<Record<string, unknown>> {
    try {
      return await this.db.transaction().execute(async (trx) => {
        await this.lockClassWithin(trx, classId);
        const standing = await this.standingWithin(trx, classId);
        const status = await this.statusOf(standing);
        if (status.phase !== 'READY' || status.covering_check_id === null) {
          throw new InvariantViolationError(
            status.phase === 'POSTED'
              ? 'This class has been posted.'
              : 'This class is not ready to post: its Coordinator checks it first.',
            { field: 'id', phase: status.phase },
          );
        }
        const posting = await trx
          .insertInto('equipping_class_postings')
          .values({
            class_id: classId,
            check_id: status.covering_check_id,
            posted_by: actor.accountId,
          })
          .returning(['id', 'posted_at'])
          .executeTakeFirstOrThrow();
        if (standing.students.length > 0) {
          await trx
            .insertInto('equipping_final_grades')
            .values(
              standing.students.map((s) => ({
                posting_id: posting.id,
                enrollment_id: s.enrollment_id,
                grade: s.grade,
                reason: s.reason,
                lessons_kept: s.lessons_kept,
                lessons_made_up: s.lessons_made_up,
                joins_at_lesson_6: s.joins_at_lesson_6,
              })),
            )
            .execute();
        }
        const finished = standing.students.filter((s) => s.grade !== 'NOT_YET');
        // Only those this posting ends: one archived meanwhile has ended already.
        const ended = finished.length
          ? await trx
              .updateTable('equipping_enrollments')
              .set({ ended_at: sql`now()`, ended_by: actor.accountId, end_reason: 'COMPLETED' })
              .where(
                'id',
                'in',
                finished.map((s) => s.enrollment_id),
              )
              .where('ended_at', 'is', null)
              .returning('id')
              .execute()
          : [];
        const endedIds = new Set(ended.map((row) => canonicalId(row.id)));
        for (const s of finished.filter((st) => endedIds.has(canonicalId(st.enrollment_id)))) {
          await this.audit.writeWithin(trx, {
            actorId: actor.accountId,
            action: 'equipping_enrollment.ended',
            targetType: 'person',
            targetId: s.person_id,
            before: {
              enrollment_id: s.enrollment_id,
              class_id: classId,
              class_name: standing.class.name,
            },
            after: { end_reason: 'COMPLETED' },
          });
        }
        for (const s of standing.students) {
          await this.audit.writeWithin(trx, {
            actorId: actor.accountId,
            action: 'equipping_final_grade.posted',
            targetType: 'person',
            targetId: s.person_id,
            before: null,
            after: {
              class_id: classId,
              class_name: standing.class.name,
              grade: s.grade,
              reason: s.reason,
            },
          });
        }
        // **A posted Passed files Life Class from the school** (decision 0509), dated the day it
        // was posted. One who already holds Life Class keeps what they hold.
        const postedOn = manilaDayOf(posting.posted_at);
        // In person order, as a Training save locks them (section 24).
        const passed = standing.students
          .filter((st) => st.grade === 'PASSED')
          .sort((x, y) => canonicalId(x.person_id).localeCompare(canonicalId(y.person_id)));
        for (const s of passed) {
          await this.training.fileFromSchoolWithin(trx, {
            personId: s.person_id,
            program: 'LIFE_CLASS',
            graduatedOn: postedOn,
            accountId: actor.accountId,
          });
        }
        const response = {
          class_id: classId,
          posting_id: posting.id,
          passed: standing.students.filter((s) => s.grade === 'PASSED').length,
          not_passed: standing.students.filter((s) => s.grade === 'NOT_PASSED').length,
          not_yet: standing.students.filter((s) => s.grade === 'NOT_YET').length,
        };
        await this.idempotency.completeWithin(trx, { ...claim, status: 200, body: response });
        return response;
      });
    } catch (error) {
      if (
        isUniqueViolation(error) &&
        violatedConstraint(error) === 'equipping_class_postings_once'
      ) {
        throw new InvariantViolationError('This class has been posted.', { field: 'id' });
      }
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** The class FOR NO KEY UPDATE, the mode a lesson save takes, so a save waits behind a post. */
  private async lockClassWithin(trx: Transaction<Database>, classId: string): Promise<void> {
    const cls = await trx
      .selectFrom('equipping_classes')
      .select('id')
      .where('id', '=', classId)
      .forNoKeyUpdate()
      .executeTakeFirst();
    if (cls === undefined) {
      throw new NotFoundError('No such class.');
    }
  }

  /**
   * The class, its students' grades, the lessons still unrecorded, its checks, its posting, and
   * the digest a check certifies. Once posted, the students are those graded then and
   * their grades are read as posted.
   */
  private async standingWithin(executor: Db | Transaction<Database>, classId: string) {
    const cls = await executor
      .selectFrom('equipping_classes')
      .select(['id', 'name', 'day_of_week', 'time_of_day', 'place', 'first_lesson_on'])
      .where('id', '=', classId)
      .executeTakeFirst();
    if (cls === undefined) {
      throw new NotFoundError('No such class.');
    }
    const posting =
      (await executor
        .selectFrom('equipping_class_postings')
        .select(['id', 'check_id', 'posted_by', 'posted_at'])
        .where('class_id', '=', classId)
        .executeTakeFirst()) ?? null;
    const saved = await executor
      .selectFrom('equipping_lessons')
      .select('lesson')
      .where('class_id', '=', classId)
      .execute();
    const savedSet = new Set(saved.map((row) => row.lesson));
    const notSaved = CLASS_LESSONS.filter((n) => !savedSet.has(n));

    const rows = await executor
      .selectFrom('equipping_enrollments as e')
      .innerJoin('equipping_registrations as r', 'r.id', 'e.registration_id')
      .leftJoin('equipping_final_grades as g', 'g.enrollment_id', 'e.id')
      .select([
        'e.id as enrollment_id',
        'e.registration_id',
        'e.started_at',
        'r.person_id',
        'g.grade',
        'g.reason',
        'g.lessons_kept',
        'g.lessons_made_up',
        'g.joins_at_lesson_6',
        'g.posting_id',
      ])
      .where('e.class_id', '=', classId)
      .where((eb) =>
        posting === null ? eb('e.ended_at', 'is', null) : eb('g.posting_id', '=', posting.id),
      )
      .execute();
    const registers = await this.attendance.registersOf(executor, classId, rows);
    const encounters = await this.attendance.encounterOf(
      executor,
      rows.map((row) => row.person_id),
    );
    const students: StudentGrade[] = rows.map((row) => {
      const register = registers.get(row.enrollment_id)!;
      const encounter = encounters.get(canonicalId(row.person_id)) ?? null;
      const worked = gradeOf(register, encounter);
      return {
        enrollment_id: row.enrollment_id,
        person_id: row.person_id,
        ...worked,
        ...(row.grade !== null
          ? {
              grade: row.grade,
              reason: row.reason!,
              lessons_kept: row.lessons_kept!,
              lessons_made_up: row.lessons_made_up!,
              joins_at_lesson_6: row.joins_at_lesson_6!,
            }
          : {}),
      };
    });

    // **A saved lesson with somebody unmarked is not recorded yet** (decision 0508): a student
    // enrolled the day it was saved, after the save, has no mark until the Teacher saves it again.
    const unmarked =
      posting === null
        ? CLASS_LESSONS.filter(
            (n) => savedSet.has(n) && rows.some((row) => !registers.get(row.enrollment_id)!.has(n)),
          )
        : [];
    const missing = [...new Set([...notSaved, ...unmarked])].sort((a, b) => a - b);

    const checks = (await executor
      .selectFrom('equipping_class_checks')
      .select(['id', 'checked_by', 'checker_person_id', 'by_admin', 'checked_at', 'fingerprint'])
      .where('class_id', '=', classId)
      .orderBy('checked_at', 'desc')
      .execute()) as CheckRow[];
    // **What a check certifies** (decision 0508): every student's grade, reason, lessons and
    // marks, and the lessons still to record. A check stands while this is unchanged, compared
    // exactly rather than by when anything was written.
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          missing,
          students: [...students]
            .sort((a, b) => a.enrollment_id.localeCompare(b.enrollment_id))
            .map((st) => [
              st.enrollment_id,
              st.grade,
              st.reason,
              st.lessons_kept,
              st.lessons_made_up,
              st.signs,
            ]),
        }),
      )
      .digest('hex');
    return {
      class: {
        id: cls.id,
        name: cls.name,
        day_of_week: cls.day_of_week,
        time_of_day: String(cls.time_of_day).slice(0, 5),
        place: cls.place,
      },
      students,
      missing,
      checks,
      fingerprint,
      posting,
    };
  }

  /**
   * Where the class stands. A check counts while nothing in the register has changed since it
   * (a wrong mark corrected after a check needs checking again). A Coordinator's check covers
   * every student but their own disciples, whom a check by the Admin covers (0501, point 16).
   */
  private async statusOf(standing: Awaited<ReturnType<EquippingGradesService['standingWithin']>>) {
    const fresh = standing.checks.filter((c) => c.fingerprint === standing.fingerprint);
    const admin = fresh.find((c) => c.by_admin) ?? null;
    const coordinator = fresh.find((c) => !c.by_admin) ?? null;
    let disciples = 0;
    if (coordinator !== null && coordinator.checker_person_id !== null) {
      const leaders = await this.hierarchy.directLeaderIdsOf(
        standing.students.map((s) => s.person_id),
      );
      disciples = standing.students.filter(
        (s) =>
          canonicalId(leaders.get(s.person_id) ?? '') ===
          canonicalId(coordinator.checker_person_id!),
      ).length;
    }
    const checkerName = async (c: CheckRow | null) =>
      c?.checker_person_id
        ? ((await this.people.forDecisions([c.checker_person_id])).get(c.checker_person_id)
            ?.fullName ?? null)
        : null;
    const counts = {
      passed: standing.students.filter((s) => s.grade === 'PASSED').length,
      not_passed: standing.students.filter((s) => s.grade === 'NOT_PASSED').length,
      not_yet: standing.students.filter((s) => s.grade === 'NOT_YET').length,
    };
    let phase: Phase;
    let covering: string | null = null;
    if (standing.posting !== null) {
      phase = 'POSTED';
    } else if (standing.missing.length > 0) {
      phase = 'NOT_READY';
    } else if (admin !== null) {
      phase = 'READY';
      covering = admin.id;
    } else if (coordinator !== null && disciples === 0) {
      phase = 'READY';
      covering = coordinator.id;
    } else if (coordinator !== null) {
      phase = 'WAITING_ADMIN';
    } else {
      phase = 'WAITING_COORDINATOR';
    }
    return {
      phase,
      missing_lessons: standing.missing,
      counts,
      coordinator_check:
        coordinator === null
          ? null
          : { by: await checkerName(coordinator), at: coordinator.checked_at.toISOString() },
      admin_check:
        admin === null
          ? null
          : { by: await checkerName(admin), at: admin.checked_at.toISOString() },
      disciples_for_admin: disciples,
      posted: standing.posting === null ? null : { at: standing.posting.posted_at.toISOString() },
      covering_check_id: covering,
    };
  }
}

/**
 * **One student's grade** (0501, points 13 to 15; decision 0508), from their register and the
 * Encounter. More than three absences, made up or not, is *Not passed*: over two of lessons 1 to
 * 4, or with the Encounter not attended, they repeat Life Class; otherwise they keep lessons 1 to
 * 4 and the Encounter and join a later class at lesson 6. A lesson not made up, or not marked, is
 * *Not passed*. The Encounter not attended is *Not yet*. A lesson held before they joined is no
 * absence, being owed as a make-up (decision 0503).
 */
function gradeOf(
  register: Map<number, { came: boolean; madeUpOn: string | null; beforeJoining: boolean }>,
  encounter: 'CAME' | 'ENROLLED' | 'MISSED' | null,
): Omit<StudentGrade, 'enrollment_id' | 'person_id'> {
  const signs: Sign[] = COLUMNS.map((n) => {
    if (n === 5) {
      return encounter === 'CAME' ? 'CAME' : encounter === 'MISSED' ? 'ABSENT' : 'NONE';
    }
    const entry = register.get(n);
    if (entry === undefined) return 'NONE';
    if (entry.came) return 'CAME';
    if (entry.madeUpOn !== null) return 'MADE_UP';
    return entry.beforeJoining ? 'BEFORE_JOINING' : 'ABSENT';
  });
  const absent = (n: number) => {
    const entry = register.get(n);
    return entry !== undefined && !entry.came && !entry.beforeJoining;
  };
  const absences = CLASS_LESSONS.filter(absent).length;
  const early = [1, 2, 3, 4].filter(absent).length;
  const owed = CLASS_LESSONS.filter((n) => {
    const entry = register.get(n);
    return entry !== undefined && !entry.came && entry.madeUpOn === null;
  });
  const madeUp = CLASS_LESSONS.filter((n) => register.get(n)?.madeUpOn != null).length;
  const kept =
    CLASS_LESSONS.filter((n) => {
      const entry = register.get(n);
      return entry !== undefined && (entry.came || entry.madeUpOn !== null);
    }).length + (encounter === 'CAME' ? 1 : 0);
  const base = { lessons_kept: kept, lessons_made_up: madeUp, signs, joins_at_lesson_6: false };
  if (absences > ABSENCES_ALLOWED) {
    // Only with every one of lessons 1 to 4 attended or made up (owner, 2026-11-23, decision
    // 0512): nothing is then owed from this class.
    const firstFourDone = [1, 2, 3, 4].every((n) => {
      const entry = register.get(n);
      return entry !== undefined && (entry.came || entry.madeUpOn !== null);
    });
    const later = early <= EARLY_ABSENCES_ALLOWED && encounter === 'CAME' && firstFourDone;
    return {
      ...base,
      joins_at_lesson_6: later,
      grade: 'NOT_PASSED',
      reason: `${absences} absences, over the ${ABSENCES_ALLOWED} allowed. ${
        later ? 'Joins a later class at lesson 6.' : 'Repeats Life Class.'
      }`,
    };
  }
  if (early > EARLY_ABSENCES_ALLOWED) {
    return {
      ...base,
      grade: 'NOT_PASSED',
      reason: `${early} absences in lessons 1 to 4. Repeats Life Class.`,
    };
  }
  if (owed.length > 0) {
    return { ...base, grade: 'NOT_PASSED', reason: `${joinLessons(owed)} not made up.` };
  }
  if (encounter !== 'CAME') {
    return {
      ...base,
      grade: 'NOT_YET',
      reason: 'Encounter not attended. Passes after a later one.',
    };
  }
  return { ...base, grade: 'PASSED', reason: 'Every lesson done.' };
}

/** *L2*, *L1 and L3*, *L1, L2 and L4*. */
function joinLessons(lessons: readonly number[]): string {
  const named = lessons.map((n) => `L${n}`);
  return named.length <= 1
    ? (named[0] ?? '')
    : `${named.slice(0, -1).join(', ')} and ${named[named.length - 1]}`;
}
