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
  ValidationFailedError,
} from '../common/errors/api-error';
import { canonicalId } from '../common/identifiers';
import { IdempotencyService } from '../common/idempotency/idempotency.service';
import { isUniqueViolation, violatedConstraint } from '../common/errors/postgres-errors';
import { manilaDayOf } from '../common/time/manila';
import { databaseNow } from '../common/time/submission-window';
import { DATABASE, type Db } from '../database/database.module';
import { lockPersonsWithin } from '../database/person-lock';
import { HierarchyService } from '../hierarchy/hierarchy.service';
import { PeopleReadService } from '../people/people.read.service';
import { EncounterSeasonsService } from '../training/encounter-seasons.service';
import { TrainingService } from '../training/training.service';

import {
  CLASS_LESSONS,
  EquippingAttendanceService,
  type RegisterEntry,
} from './equipping-attendance.service';
import { lifeClassFiledOf, type LifeClassFiled } from './life-class-from-school';

import type { CurrentClaim } from '../common/idempotency/current-idempotency.decorator';
import type { Database, GradeChangeSign } from '../database/schema';
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

/** What a posted class's grade carries beside the grade itself (decision 0513). */
interface PostedFacts {
  register: Map<number, RegisterEntry>;
  encounter: 'CAME' | 'ENROLLED' | 'MISSED' | null;
  posted: { final_grade_id: string; changes: number; passed_later: boolean } | null;
  /** The graded enrollment's registration, and whether the enrollment is still open. */
  registration_id: string;
  open: boolean;
  /**
   * The registration each register entry was recorded under: the student's own for a lesson of
   * a class they left this term (decision 0513, point 11), an earlier term's for one kept from it
   * (decision 0512, point 12).
   */
  entryRegistrations: Map<string, string>;
}

/** What the grade as it stands read the Encounter as, and what it reads now (point 14). */
type EncounterBefore = 'CAME' | 'NOT_CAME';
type EncounterNow = 'CAME' | 'MISSED' | 'ENROLLED' | 'NONE';

/** What a change sets a lesson to (decision 0513). */
export type ChangeTo = 'CAME' | 'ABSENT' | 'MADE_UP';

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
    private readonly seasons: EncounterSeasonsService,
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
  async classGrades(
    actor: Actor,
    classId: string,
    options: { history: boolean } = { history: true },
  ): Promise<Record<string, unknown>> {
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
    const history = options.history
      ? await this.historyOf(
          standing.students.flatMap((s) => (s.posted === null ? [] : [s.posted.final_grade_id])),
        )
      : new Map<string, Record<string, unknown>[]>();
    const changes = options.history && standing.posting !== null && admin;
    const registeredLater = changes
      ? await this.registeredLaterOf(
          this.db,
          standing.students.map((s) => s.enrollment_id),
        )
      : new Set<string>();
    return {
      class: standing.class,
      status: await this.statusOf(standing),
      may_check: standing.posting === null && standing.missing.length === 0,
      checks_as: admin ? 'ADMIN' : 'COORDINATOR',
      // **Only the Admin changes a lesson after posting** (decision 0513), read as 0508 reads
      // the Admin: `equipping.class` at Whole Church.
      may_change: changes,
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
          // The Coordinator's read carries none of it (decision 0513).
          ...(s.posted === null || !options.history
            ? {}
            : {
                final_grade_id: s.posted.final_grade_id,
                changes_seen: s.posted.changes,
                // The lessons a change may reach, each as the register reads it now.
                changeable: changes
                  ? changeableOf(s, registeredLater.has(canonicalId(s.enrollment_id)))
                  : { lessons: [], why: null },
                // The Encounter the grade as it stands read, beside the one it reads now, when they
                // differ (decision 0513, point 14).
                encounter_change: changes ? encounterChangeOf(s) : null,
                history: history.get(s.posted.final_grade_id) ?? [],
              }),
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

  /**
   * `GET /equipping/final-grades/grades/{id}/change-preview`: what a change of one lesson would
   * make the grade, before the Admin saves it (decision 0513). Writes nothing; refuses as the save
   * would.
   */
  async previewChange(
    finalGradeId: string,
    input: { lesson: number; to: ChangeTo; made_up_on?: string },
  ): Promise<Record<string, unknown>> {
    const classId = await this.classOfGrade(this.db, finalGradeId);
    const standing = await this.standingWithin(this.db, classId);
    const student = studentOfGrade(standing.students, finalGradeId);
    const today = manilaDayOf(await databaseNow(this.db));
    const plan = await this.planChange(this.db, student, input, today);
    return previewShape(input.lesson, plan);
  }

  /**
   * `POST /equipping/final-grades/grades/{id}/changes`: **the Admin changes one lesson of a posted
   * class, with a reason, and the grade is worked out again** (decisions 0501, 0508 and 0513). The
   * posted grade is never rewritten: the change is a row of its own keeping the lesson and the
   * grade before and after, and the mark or make-up it writes is written as any correction is,
   * the earlier one closed and kept. Training follows the grade: a *Passed* files Life Class from
   * the school, dated today, and a *Passed* changed away withdraws the one the school filed.
   */
  async change(
    actor: Actor,
    finalGradeId: string,
    body: {
      lesson: number;
      to: ChangeTo;
      made_up_on?: string;
      why: 'MADE_UP_AFTER_POSTING' | 'RECORDED_WRONGLY';
      details: string;
      changes_seen: number;
    },
    claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    try {
      return await this.changeWithin(actor, finalGradeId, body, claim);
    } catch (error) {
      // The database keeps the flag of a grade a later class carries from (a merged record's
      // included, which the later-term refusal does not resolve); refused in words, not as a 500.
      if (violatedConstraint(error) === 'equipping_grade_change_carried') {
        throw new InvariantViolationError(
          'They have joined a later class at Lesson 6 on this grade, which keeps it as it is.',
          { field: 'to' },
        );
      }
      throw error;
    }
  }

  private async changeWithin(
    actor: Actor,
    finalGradeId: string,
    body: Parameters<EquippingGradesService['change']>[2],
    claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    return this.db.transaction().execute(async (trx) => {
      const classId = await this.classOfGrade(trx, finalGradeId);
      // **The person's lock first, which registering takes** (decision 0513, point 15): a change
      // and a later-term registration saved at once are taken one after the other, so the
      // later-term check below sees one registered in the same instant. The record a merge kept
      // is locked too, being the one a new registration is made on.
      await lockPersonsWithin(trx, await this.personsToLockOf(trx, finalGradeId));
      // The class's lock, as a lesson save and a posting take it, then the grade's own row, so
      // two changes of one grade are made one after the other.
      await this.lockClassWithin(trx, classId);
      await trx
        .selectFrom('equipping_final_grades')
        .select('id')
        .where('id', '=', finalGradeId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      const standing = await this.standingWithin(trx, classId);
      const student = studentOfGrade(standing.students, finalGradeId);
      if (student.posted!.changes !== body.changes_seen) {
        throw new ApiError(
          ApiErrorCode.VERSION_CONFLICT,
          'This grade was changed since you opened it. Reload to see it as it is now.',
          { field: 'changes_seen', current: student.posted!.changes },
        );
      }
      const now = await databaseNow(trx);
      const today = manilaDayOf(now);
      const plan = await this.planChange(trx, student, body, today);
      // The change first: the database admits a mark or make-up of a posted class only beside it.
      const recorded = await trx
        .insertInto('equipping_grade_changes')
        .values({
          final_grade_id: finalGradeId,
          lesson: body.lesson,
          sign_before: plan.signBefore,
          made_up_on_before: plan.madeUpOnBefore,
          sign_after: body.to,
          made_up_on_after: body.to === 'MADE_UP' ? body.made_up_on! : null,
          why: body.why,
          details: body.details,
          grade_before: student.grade,
          reason_before: student.reason,
          grade_after: plan.after.grade,
          reason_after: plan.after.reason,
          lessons_kept_after: plan.after.lessons_kept,
          lessons_made_up_after: plan.after.lessons_made_up,
          joins_at_lesson_6_after: plan.after.joins_at_lesson_6,
          encounter_before: plan.encounterBefore,
          encounter_after: plan.encounterNow,
          enrollment_effect: plan.effect,
          // What the school's Life Class stands filed under after it: kept as it was while the
          // grade stays Passed, the change's own instant where it becomes so, none otherwise.
          life_class_filed_at:
            plan.after.grade !== 'PASSED'
              ? null
              : plan.filed === null
                ? sql<Date>`now()`
                : plan.filed.kind === 'INSTANT'
                  ? plan.filed.at
                  : null,
          life_class_weekend: plan.after.grade === 'PASSED' && plan.filed?.kind === 'WEEKEND',
          changed_by: actor.accountId,
          changer_person_id: actor.personId,
        })
        .returning(['id', 'changed_at'])
        .executeTakeFirstOrThrow();

      await this.writeRegisterChangeWithin(trx, actor, plan.entry, body);

      // **The register and the grade agree** (0501, point 15): worked out again from what was
      // written, the grade is the one recorded on the change, or nothing is kept.
      const registers = await this.attendance.registersOf(trx, classId, [
        {
          enrollment_id: student.enrollment_id,
          registration_id: plan.registrationId,
          started_at: plan.startedAt,
        },
      ]);
      const worked = gradeOf(registers.get(student.enrollment_id)!, student.encounter);
      if (
        worked.grade !== plan.after.grade ||
        worked.reason !== plan.after.reason ||
        worked.lessons_kept !== plan.after.lessons_kept ||
        worked.lessons_made_up !== plan.after.lessons_made_up ||
        worked.joins_at_lesson_6 !== plan.after.joins_at_lesson_6
      ) {
        throw new Error(
          'A grade change wrote a register whose grade differs from the one planned.',
        );
      }

      // **The enrollment follows the grade into or out of Not yet** (decision 0513, point 10).
      if (plan.effect === 'ENDS') {
        await trx
          .updateTable('equipping_enrollments')
          .set({ ended_at: sql`now()`, ended_by: actor.accountId, end_reason: 'COMPLETED' })
          .where('id', '=', student.enrollment_id)
          .where('ended_at', 'is', null)
          .executeTakeFirstOrThrow();
      } else if (plan.effect === 'REOPENS') {
        await trx
          .updateTable('equipping_enrollments')
          .set({ ended_at: null, ended_by: null, end_reason: null, withdraw_note: null })
          .where('id', '=', student.enrollment_id)
          .executeTakeFirstOrThrow();
      }
      if (plan.effect !== null) {
        // The end a reopening clears is kept here, the one record of it (section 21).
        await this.audit.writeWithin(trx, {
          actorId: actor.accountId,
          action:
            plan.effect === 'ENDS' ? 'equipping_enrollment.ended' : 'equipping_enrollment.reopened',
          targetType: 'person',
          targetId: student.person_id,
          before: {
            enrollment_id: student.enrollment_id,
            class_id: classId,
            open: student.open,
            ...plan.endBefore,
          },
          after: {
            enrollment_id: student.enrollment_id,
            class_id: classId,
            open: plan.effect === 'REOPENS',
            ...(plan.effect === 'ENDS' ? { end_reason: 'COMPLETED' } : {}),
          },
          reason: body.details,
        });
      }

      // Training follows the grade (decision 0509): Life Class filed from the school, or withdrawn.
      if (plan.filed === null && plan.after.grade === 'PASSED') {
        await this.training.fileFromSchoolWithin(trx, {
          personId: student.person_id,
          program: 'LIFE_CLASS',
          // Dated by the change's own instant, which a later withdrawal and the school's
          // evidence read back, as posting dates its filing by `posted_at`.
          graduatedOn: manilaDayOf(recorded.changed_at),
          accountId: actor.accountId,
        });
      } else if (plan.filed !== null && plan.after.grade !== 'PASSED') {
        // Exactly what was filed: the day it became Passed, or the weekend it passed at.
        const graduatedOn = await this.filedOnOf(trx, plan.filed);
        await this.training.withdrawFromSchoolWithin(trx, {
          personId: student.person_id,
          program: 'LIFE_CLASS',
          graduatedOn,
          accountId: actor.accountId,
          reason: body.details,
        });
      }

      await this.audit.writeWithin(trx, {
        actorId: actor.accountId,
        action: 'equipping_final_grade.changed',
        targetType: 'person',
        targetId: student.person_id,
        before: {
          class_id: classId,
          class_name: standing.class.name,
          lesson: body.lesson,
          sign: plan.signBefore,
          made_up_on: plan.madeUpOnBefore,
          grade: student.grade,
          reason: student.reason,
        },
        after: {
          class_id: classId,
          class_name: standing.class.name,
          lesson: body.lesson,
          sign: body.to,
          made_up_on: body.to === 'MADE_UP' ? body.made_up_on! : null,
          grade: plan.after.grade,
          reason: plan.after.reason,
          why: body.why,
          ...(plan.encounterChange === null ? {} : { encounter_change: plan.encounterChange }),
        },
        reason: body.details,
      });

      const response = {
        final_grade_id: finalGradeId,
        change_id: recorded.id,
        grade: plan.after.grade,
        reason: plan.after.reason,
        enrollment: plan.effect,
        changes_seen: student.posted!.changes + 1,
      };
      await this.idempotency.completeWithin(trx, { ...claim, status: 201, body: response });
      return response;
    });
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** The posted class a final grade belongs to; `NOT_FOUND` for none. */
  private async classOfGrade(
    executor: Db | Transaction<Database>,
    finalGradeId: string,
  ): Promise<string> {
    const row = await executor
      .selectFrom('equipping_final_grades as g')
      .innerJoin('equipping_class_postings as p', 'p.id', 'g.posting_id')
      .select('p.class_id')
      .where('g.id', '=', finalGradeId)
      .executeTakeFirst();
    if (row === undefined) {
      throw new NotFoundError('No such grade.');
    }
    return row.class_id;
  }

  /**
   * **What a change of one lesson does** (decision 0513), refused as it would be on saving. The
   * lesson is one this class recorded for the graded enrollment, or one it held before they
   * joined, which is only made up; the grade is worked out from the register with that one
   * lesson changed.
   */
  private async planChange(
    executor: Db | Transaction<Database>,
    student: StudentGrade & PostedFacts,
    input: { lesson: number; to: ChangeTo; made_up_on?: string },
    today: string,
  ) {
    if (!(CLASS_LESSONS as readonly number[]).includes(input.lesson)) {
      throw new ValidationFailedError(
        'A change reaches lessons 1 to 4 and 6 to 9; the Encounter is changed on its own page.',
        { field: 'lesson' },
      );
    }
    if ((input.to === 'MADE_UP') !== (input.made_up_on !== undefined)) {
      throw new ValidationFailedError(
        input.to === 'MADE_UP' ? 'Say the day it was made up.' : 'Only a make-up carries a date.',
        { field: 'made_up_on' },
      );
    }
    const refusal = refusalOf(student, input.lesson);
    if (refusal !== null) {
      throw new InvariantViolationError(refusal, { field: 'lesson' });
    }
    if ((await this.registeredLaterOf(executor, [student.enrollment_id])).size > 0) {
      throw new InvariantViolationError(LATER_TERM, { field: 'lesson' });
    }
    const entry = student.register.get(input.lesson)!;
    const signBefore = signOf(entry);
    const madeUpOnBefore = signBefore === 'MADE_UP' ? entry.madeUpOn : null;
    if (signBefore === 'BEFORE_JOINING' && input.to !== 'MADE_UP') {
      throw new InvariantViolationError(
        `They joined after L${input.lesson}, so it is made up, not marked.`,
        { field: 'to' },
      );
    }
    if (
      input.to === signBefore &&
      (input.to !== 'MADE_UP' || input.made_up_on === madeUpOnBefore)
    ) {
      throw new InvariantViolationError(`L${input.lesson} already reads that.`, { field: 'to' });
    }
    if (input.to === 'MADE_UP' && (input.made_up_on! < entry.heldOn || input.made_up_on! > today)) {
      throw new ValidationFailedError('A make-up falls between the missed lesson and today.', {
        field: 'made_up_on',
      });
    }
    const changed = new Map(student.register);
    changed.set(input.lesson, {
      ...entry,
      came: input.to === 'CAME',
      madeUpOn: input.to === 'MADE_UP' ? input.made_up_on! : null,
      beforeJoining: input.to === 'MADE_UP' ? entry.beforeJoining : false,
    });
    // **A kept lesson keeps the join it gave** (decision 0513, point 12): lessons 1 to 4 let them
    // join a later class at Lesson 6, each attended or made up and at most two missed (decisions
    // 0508 and 0512), a join that class has graded. A change that would undo either is refused:
    // *Absent*, a *Came* made *Made up* past the two, and a *Made up* made *Came* that leaves
    // the earlier term passing (owner, 2026-11-24): that term's grade, worked out again with the
    // lesson changed, must still join a later class at Lesson 6.
    if (
      isKept(student, entry) &&
      !(await this.earlierTermStillJoins(executor, student, entry, changed))
    ) {
      throw new InvariantViolationError(
        `L${input.lesson} was kept from ${entry.fromClass?.name ?? 'an earlier class'} and let them join a later class at Lesson 6, which that class has graded. This would undo that join, so it is not changed.`,
        { field: 'to' },
      );
    }
    const after = gradeOf(changed, student.encounter);
    // **Into or out of Not yet as posting would have** (decision 0513, point 10): a *Not yet*
    // made anything else has their enrollment ended, and a finished student made *Not yet* has
    // theirs reopened, which only stands while nothing else holds their place.
    // Reopened only where a finished student is made *Not yet*: a *Not yet* withdrawn or archived
    // since posting stays as the Registrar left them, whatever is changed.
    const enrollment = await executor
      .selectFrom('equipping_enrollments')
      .select([
        'registration_id',
        'started_at',
        'ended_at',
        'ended_by',
        'end_reason',
        'withdraw_note',
      ])
      .where('id', '=', student.enrollment_id)
      .executeTakeFirstOrThrow();
    // Decided from how the enrollment ended, not from the grade: only an end `COMPLETED`, by
    // posting or by a change ending a *Not yet*, is reopened. A withdrawal or an archive is left
    // as the Registrar left it, whatever the grade is changed to and however often.
    const finished =
      !student.open && enrollment.end_reason === 'COMPLETED' && enrollment.withdraw_note === null;
    const effect: 'ENDS' | 'REOPENS' | null =
      student.open && after.grade !== 'NOT_YET'
        ? 'ENDS'
        : finished && student.grade !== 'NOT_YET' && after.grade === 'NOT_YET'
          ? 'REOPENS'
          : null;
    if (effect === 'REOPENS') {
      const blocked = await this.reopenRefusalOf(executor, student);
      if (blocked !== null) {
        throw new InvariantViolationError(blocked, { field: 'to', grade_after: after.grade });
      }
    }
    // One who has joined a later class at Lesson 6 has registered in a later term, refused above;
    // the database keeps that grade's flag besides (`equipping_grade_change_carried`).
    const filed =
      (await lifeClassFiledOf(executor, { finalGradeIds: [student.posted!.final_grade_id] }))[0]
        ?.filed ?? null;
    return {
      entry,
      signBefore,
      madeUpOnBefore,
      after,
      before: { grade: student.grade, reason: student.reason },
      registrationId: enrollment.registration_id,
      startedAt: enrollment.started_at,
      filed,
      holds: filed !== null,
      endBefore: {
        ended_at: enrollment.ended_at === null ? null : new Date(enrollment.ended_at).toISOString(),
        ended_by: enrollment.ended_by,
        end_reason: enrollment.end_reason,
        withdraw_note: enrollment.withdraw_note,
      },
      encounterBefore: encounterBeforeOf(student)!,
      encounterNow: encounterNowOf(student),
      encounterChange: encounterChangeOf(student),
      effect,
    };
  }

  /**
   * Why an ended enrollment cannot be reopened, or null (decision 0513, point 10): a cancelled
   * registration takes nobody back, and another enrollment open on it already holds the place.
   */
  private async reopenRefusalOf(
    executor: Db | Transaction<Database>,
    student: StudentGrade & PostedFacts,
  ): Promise<string | null> {
    // Locked as cancelling locks it, so a cancel cannot land beside the reopening unseen.
    const registration = await executor
      .selectFrom('equipping_registrations')
      .select('cancelled_at')
      .where('id', '=', student.registration_id)
      .forNoKeyUpdate()
      .executeTakeFirstOrThrow();
    if (registration.cancelled_at !== null) {
      return 'This would make them Not yet, but their registration was cancelled, so their enrollment cannot be opened again.';
    }
    const open = await executor
      .selectFrom('equipping_enrollments')
      .select('id')
      .where('registration_id', '=', student.registration_id)
      .where('ended_at', 'is', null)
      .executeTakeFirst();
    if (open !== undefined) {
      return 'This would make them Not yet, but they are enrolled in a class again on this registration, so this enrollment cannot be opened again.';
    }
    return null;
  }

  /**
   * Writes the lesson as the change says, as any correction writes it: the current mark and
   * make-up closed and kept, a new one opened (decision 0503), where the lesson was recorded:
   * the posted class under the graded enrollment, a class left this term under the enrollment
   * there (point 11), or an earlier term's class under the enrollment kept from (point 12). A mark
   * carries the Admin's details as its reason, as a closed week's does.
   */
  private async writeRegisterChangeWithin(
    trx: Transaction<Database>,
    actor: Actor,
    entry: RegisterEntry,
    body: { to: ChangeTo; made_up_on?: string; details: string },
  ): Promise<void> {
    const close = { superseded_at: sql<Date>`now()`, superseded_by: actor.accountId };
    const where = { lesson_id: entry.lessonId, enrollment_id: entry.enrollmentId };
    // A make-up is closed first: a mark saying they came is refused while one stands.
    await trx
      .updateTable('equipping_make_ups')
      .set(close)
      .where('lesson_id', '=', where.lesson_id)
      .where('enrollment_id', '=', where.enrollment_id)
      .where('superseded_at', 'is', null)
      .execute();
    const markWanted =
      body.to === 'CAME' ? true : body.to === 'ABSENT' ? false : entry.came ? false : null;
    if (markWanted !== null) {
      await trx
        .updateTable('equipping_marks')
        .set(close)
        .where('lesson_id', '=', where.lesson_id)
        .where('enrollment_id', '=', where.enrollment_id)
        .where('superseded_at', 'is', null)
        .execute();
      await trx
        .insertInto('equipping_marks')
        .values({
          ...where,
          came: markWanted,
          recorded_by: actor.accountId,
          correction_reason: body.details,
        })
        .execute();
    }
    if (body.to === 'MADE_UP') {
      await trx
        .insertInto('equipping_make_ups')
        .values({ ...where, made_up_on: body.made_up_on!, recorded_by: actor.accountId })
        .execute();
    }
  }

  /**
   * **Not once they have registered for the level again** (decision 0513, point 15): of these
   * graded enrollments, those whose person holds a registration, not cancelled, at the same level
   * in a later term, which rests on the grade as a try (decision 0511), a fresh start or a carry at
   * Lesson 6 (decision 0512). A registration on a record merged into theirs, or on the record
   * theirs was merged into, is theirs (decision 0408).
   */
  private async registeredLaterOf(
    executor: Db | Transaction<Database>,
    enrollmentIds: readonly string[],
  ): Promise<Set<string>> {
    if (enrollmentIds.length === 0) {
      return new Set();
    }
    const graded = await executor
      .selectFrom('equipping_enrollments as e')
      .innerJoin('equipping_registrations as r', 'r.id', 'e.registration_id')
      .select(['e.id', 'r.person_id', 'r.level', 'r.term_year', 'r.term_number'])
      .where('e.id', 'in', [...enrollmentIds])
      .execute();
    const pairs = await this.people.mergedPairsWithin(executor);
    const keptOf = new Map(pairs.absorbed.map((id, index) => [id, pairs.kept[index]]));
    const identity = (personId: string) =>
      keptOf.get(canonicalId(personId)) ?? canonicalId(personId);
    const groupOf = (personId: string) => {
      const kept = identity(personId);
      return [kept, ...pairs.absorbed.filter((id) => keptOf.get(id) === kept)];
    };
    const persons = [...new Set(graded.flatMap((row) => groupOf(row.person_id)))];
    const later = await executor
      .selectFrom('equipping_registrations')
      .select(['person_id', 'level', 'term_year', 'term_number'])
      .where('person_id', 'in', persons)
      .where('cancelled_at', 'is', null)
      .execute();
    return new Set(
      graded
        .filter((row) =>
          later.some(
            (reg) =>
              identity(reg.person_id) === identity(row.person_id) &&
              reg.level === row.level &&
              (reg.term_year > row.term_year ||
                (reg.term_year === row.term_year && reg.term_number > row.term_number)),
          ),
        )
        .map((row) => canonicalId(row.id)),
    );
  }

  /**
   * The Persons a change of this grade locks (decision 0513, point 15): the grade's own, and the
   * record a merge kept for it, on which a new registration would be made.
   */
  private async personsToLockOf(
    trx: Transaction<Database>,
    finalGradeId: string,
  ): Promise<string[]> {
    const row = await trx
      .selectFrom('equipping_final_grades as g')
      .innerJoin('equipping_enrollments as e', 'e.id', 'g.enrollment_id')
      .innerJoin('equipping_registrations as r', 'r.id', 'e.registration_id')
      .select('r.person_id')
      .where('g.id', '=', finalGradeId)
      .executeTakeFirst();
    if (row === undefined) {
      throw new NotFoundError('No such grade.');
    }
    const person = await this.people.forDecisionWithin(trx, row.person_id);
    return [row.person_id, ...(person?.mergedIntoId ? [person.mergedIntoId] : [])];
  }

  /** The Manila day the school's Life Class was dated by, for withdrawing exactly it. */
  private async filedOnOf(
    trx: Transaction<Database>,
    filed: Exclude<LifeClassFiled, null>,
  ): Promise<string> {
    if (filed.kind === 'INSTANT') {
      return manilaDayOf(filed.at);
    }
    const season = (await this.seasons.allSeasons(trx)).find(
      (each) => canonicalId(each.id) === canonicalId(filed.seasonId),
    );
    if (season === undefined) {
      throw new Error('A Life Class filed at a weekend names a season that does not exist.');
    }
    return filed.network === 'MENS' ? season.mens_encounter_on : season.womens_encounter_on;
  }

  /**
   * **Whether the earlier term still joins at Lesson 6 with a kept lesson changed** (decision
   * 0513, point 12): its register as recorded, the one lesson changed, worked out again.
   */
  private async earlierTermStillJoins(
    executor: Db | Transaction<Database>,
    student: StudentGrade & PostedFacts,
    entry: RegisterEntry,
    changed: Map<number, RegisterEntry>,
  ): Promise<boolean> {
    const graded = await executor
      .selectFrom('equipping_enrollments')
      .select('carried_from_enrollment_id')
      .where('id', '=', student.enrollment_id)
      .executeTakeFirstOrThrow();
    if (graded.carried_from_enrollment_id === null) {
      return false;
    }
    const earlier = await executor
      .selectFrom('equipping_enrollments')
      .select(['id', 'class_id', 'registration_id', 'started_at'])
      .where('id', '=', graded.carried_from_enrollment_id)
      .executeTakeFirstOrThrow();
    const registers = await this.attendance.registersOf(executor, earlier.class_id, [
      {
        enrollment_id: earlier.id,
        registration_id: earlier.registration_id,
        started_at: earlier.started_at,
      },
    ]);
    const register = new Map(registers.get(earlier.id) ?? []);
    register.set(entry.lesson, changed.get(entry.lesson)!);
    const worked = gradeOf(register, student.encounter);
    return worked.joins_at_lesson_6;
  }

  /** Each grade's changes, oldest first, with who made them (decision 0513). */
  private async historyOf(finalGradeIds: readonly string[]) {
    const result = new Map<string, Record<string, unknown>[]>();
    if (finalGradeIds.length === 0) {
      return result;
    }
    const rows = await this.db
      .selectFrom('equipping_grade_changes')
      .selectAll()
      .where('final_grade_id', 'in', [...finalGradeIds])
      .orderBy('seq')
      .execute();
    const names = await this.people.forDecisions(
      rows.flatMap((row) => (row.changer_person_id === null ? [] : [row.changer_person_id])),
    );
    for (const row of rows) {
      const list = result.get(row.final_grade_id) ?? [];
      list.push({
        at: new Date(row.changed_at).toISOString(),
        by:
          row.changer_person_id === null
            ? null
            : (names.get(row.changer_person_id)?.fullName ?? null),
        lesson: row.lesson,
        sign_before: row.sign_before,
        made_up_on_before: row.made_up_on_before === null ? null : String(row.made_up_on_before),
        sign_after: row.sign_after,
        made_up_on_after: row.made_up_on_after === null ? null : String(row.made_up_on_after),
        why: row.why,
        details: row.details,
        grade_before: row.grade_before,
        reason_before: row.reason_before,
        grade_after: row.grade_after,
        reason_after: row.reason_after,
        // Where the change worked from an Encounter the grade before had not (point 14).
        encounter_change:
          (row.encounter_before === 'CAME') === (row.encounter_after === 'CAME')
            ? null
            : { before: row.encounter_before, now: row.encounter_after },
        enrollment: row.enrollment_effect,
      });
      result.set(row.final_grade_id, list);
    }
    return result;
  }

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

    // A posted grade as it stands now, the latest change of it included (decision 0513).
    const rows = await executor
      .selectFrom('equipping_enrollments as e')
      .innerJoin('equipping_registrations as r', 'r.id', 'e.registration_id')
      .leftJoin('equipping_current_grades as g', 'g.enrollment_id', 'e.id')
      .select([
        'e.id as enrollment_id',
        'e.registration_id',
        'e.started_at',
        'e.ended_at',
        'r.person_id',
        'g.final_grade_id',
        'g.grade',
        'g.reason',
        'g.lessons_kept',
        'g.lessons_made_up',
        'g.joins_at_lesson_6',
        'g.posting_id',
        'g.passed_later_at',
        'g.changes',
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
    // Where each lesson was recorded, a class left this term or a term kept from (decision 0513).
    const entryEnrollments = [
      ...new Set(
        [...registers.values()].flatMap((register) =>
          [...register.values()].map((entry) => canonicalId(entry.enrollmentId)),
        ),
      ),
    ];
    const entryRegistrations = new Map(
      (entryEnrollments.length === 0
        ? []
        : await executor
            .selectFrom('equipping_enrollments')
            .select(['id', 'registration_id'])
            .where('id', 'in', entryEnrollments)
            .execute()
      ).map((row) => [canonicalId(row.id), canonicalId(row.registration_id)]),
    );
    const students: (StudentGrade & PostedFacts)[] = rows.map((row) => {
      const register = registers.get(row.enrollment_id)!;
      const encounter = encounters.get(canonicalId(row.person_id)) ?? null;
      const worked = gradeOf(register, encounter);
      return {
        enrollment_id: row.enrollment_id,
        person_id: row.person_id,
        ...worked,
        register,
        encounter,
        registration_id: canonicalId(row.registration_id),
        open: row.ended_at === null,
        entryRegistrations,
        posted:
          row.final_grade_id === null
            ? null
            : {
                final_grade_id: row.final_grade_id,
                changes: row.changes ?? 0,
                passed_later: row.passed_later_at !== null,
              },
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

const LATER_TERM =
  'They have registered for this level in a later term, which rests on this grade. Cancel that registration first, then change this.';

/** The student a final grade belongs to, within its posted class's standing. */
function studentOfGrade<T extends StudentGrade & PostedFacts>(
  students: readonly T[],
  finalGradeId: string,
): T {
  const student = students.find(
    (s) => s.posted !== null && canonicalId(s.posted.final_grade_id) === canonicalId(finalGradeId),
  );
  if (student === undefined) {
    throw new NotFoundError('No such grade.');
  }
  return student;
}

function signOf(entry: RegisterEntry): GradeChangeSign {
  if (entry.came) return 'CAME';
  if (entry.madeUpOn !== null) return 'MADE_UP';
  return entry.beforeJoining ? 'BEFORE_JOINING' : 'ABSENT';
}

/**
 * **Kept from an earlier term** (decision 0512): recorded under another registration than the
 * graded one, so a later class carries it. Changed only where lessons 1 to 4 stay done (decision
 * 0513, point 12), that is to *Came* or *Made up*.
 */
function isKept(student: StudentGrade & PostedFacts, entry: RegisterEntry): boolean {
  const registration = student.entryRegistrations.get(canonicalId(entry.enrollmentId));
  return registration !== undefined && registration !== student.registration_id;
}

/**
 * What the grade as it stands read the Encounter as (decision 0513, point 14). The grade reads
 * it as attended or not, and the lessons kept count it, so the grade worked out from the register
 * under one of the two reproduces the one stored and the other does not. Null where neither does:
 * the register itself has moved since the grade was set, which no ruling settles.
 */
function encounterBeforeOf(student: StudentGrade & PostedFacts): EncounterBefore | null {
  const same = (encounter: 'CAME' | null) => {
    const worked = gradeOf(student.register, encounter);
    return (
      worked.grade === student.grade &&
      worked.reason === student.reason &&
      worked.lessons_kept === student.lessons_kept
    );
  };
  if (same('CAME')) return 'CAME';
  if (same(null)) return 'NOT_CAME';
  return null;
}

function encounterNowOf(student: StudentGrade & PostedFacts): EncounterNow {
  return student.encounter ?? 'NONE';
}

/** The Encounter before and now, where they differ (decision 0513, point 14); else null. */
function encounterChangeOf(
  student: StudentGrade & PostedFacts,
): { before: EncounterBefore; now: EncounterNow } | null {
  const before = encounterBeforeOf(student);
  const now = encounterNowOf(student);
  if (before === null || (before === 'CAME') === (now === 'CAME')) {
    return null;
  }
  return { before, now };
}

/** Why a lesson of a posted grade is not changed here, or null (decision 0513). */
function refusalOf(student: StudentGrade & PostedFacts, lesson: number): string | null {
  const whole = wholeRefusalOf(student);
  if (whole !== null) {
    return whole;
  }
  if (student.register.get(lesson) === undefined) {
    return `L${lesson} was not recorded for them.`;
  }
  return null;
}

/** Why no lesson of this grade is changed, whichever lesson, or null. */
function wholeRefusalOf(student: StudentGrade & PostedFacts): string | null {
  // An Encounter recorded or corrected since is worked from as it stands (point 14). A register
  // that no longer gives the grade under either reading of it is a different thing, which no
  // ruling settles, so it is refused rather than folded into a lesson change.
  if (encounterBeforeOf(student) === null) {
    return 'Their register has changed since this grade was set, so no lesson is changed here.';
  }
  return null;
}

/** The lessons a change may reach, for the dialog's list, and why there are none where so. */
function changeableOf(student: StudentGrade & PostedFacts, registeredLater: boolean) {
  if (registeredLater) {
    return { lessons: [], why: LATER_TERM };
  }
  const whole = wholeRefusalOf(student);
  if (whole !== null) {
    return { lessons: [], why: whole };
  }
  const lessons = CLASS_LESSONS.flatMap((lesson) => {
    if (refusalOf(student, lesson) !== null) {
      return [];
    }
    const entry = student.register.get(lesson)!;
    return [
      {
        lesson,
        sign: signOf(entry),
        made_up_on: entry.madeUpOn,
        held_on: entry.heldOn,
        // Recorded in another class: the one they left this term, or the term it was kept from.
        recorded_in: entry.fromClass?.name ?? null,
        kept: isKept(student, entry),
      },
    ];
  });
  return {
    lessons,
    why: lessons.length === 0 ? 'No lesson of theirs was recorded in this class.' : null,
  };
}

/** What a preview answers: the lesson and the grade, before and after, and what follows. */
function previewShape(
  lesson: number,
  plan: {
    signBefore: GradeChangeSign;
    madeUpOnBefore: string | null;
    before: { grade: Grade; reason: string };
    after: Omit<StudentGrade, 'enrollment_id' | 'person_id'>;
    holds: boolean;
    encounterChange: { before: EncounterBefore; now: EncounterNow } | null;
    effect: 'ENDS' | 'REOPENS' | null;
  },
): Record<string, unknown> {
  return {
    lesson,
    sign_before: plan.signBefore,
    made_up_on_before: plan.madeUpOnBefore,
    grade_before: plan.before.grade,
    reason_before: plan.before.reason,
    grade_after: plan.after.grade,
    reason_after: plan.after.reason,
    joins_at_lesson_6_after: plan.after.joins_at_lesson_6,
    training:
      !plan.holds && plan.after.grade === 'PASSED'
        ? 'FILES'
        : plan.holds && plan.after.grade !== 'PASSED'
          ? 'WITHDRAWS'
          : null,
    encounter_change: plan.encounterChange,
    enrollment: plan.effect,
  };
}

/** *L2*, *L1 and L3*, *L1, L2 and L4*. */
function joinLessons(lessons: readonly number[]): string {
  const named = lessons.map((n) => `L${n}`);
  return named.length <= 1
    ? (named[0] ?? '')
    : `${named.slice(0, -1).join(', ')} and ${named[named.length - 1]}`;
}
