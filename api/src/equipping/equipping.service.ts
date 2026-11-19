import { Inject, Injectable } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';

import { AttendanceStandingService } from '../attendance/attendance-standing.service';
import { AuditService } from '../audit/audit.service';
import { type Actor } from '../auth/authorization/authorization.service';
import { CellsReadService } from '../cells/cells.read.service';
import {
  InvariantViolationError,
  NotFoundError,
  ValidationFailedError,
} from '../common/errors/api-error';
import { isUniqueViolation, violatedConstraint } from '../common/errors/postgres-errors';
import { canonicalId, isUuid } from '../common/identifiers';
import { IdempotencyService } from '../common/idempotency/idempotency.service';
import { DATABASE, type Db } from '../database/database.module';
import { lockPersonsWithin } from '../database/person-lock';
import { HierarchyService } from '../hierarchy/hierarchy.service';
import { PeopleReadService } from '../people/people.read.service';
import { SuynlService } from '../suynl/suynl.service';
import { EncounterSeasonsService } from '../training/encounter-seasons.service';

import type { CurrentClaim } from '../common/idempotency/current-idempotency.decorator';
import type { Database, EquippingLevel, EquippingRequirement } from '../database/schema';
import type {
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
const ENCOUNTER_MINIMUM_AGE = 14;
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
 * The church's school: registration and enrollment for Life Class (SKILL.md section 29,
 * decision 0499).
 *
 * **Every route is Whole Church `equipping.manage`**, decided by the guard before this runs,
 * so nothing here narrows by scope. What it reads of other modules it reads through their
 * services (section 2): a person and their birthday from `people`, their leader from
 * `hierarchy`, their Cell from `cells`, their attendance from `attendance`, their SUYNL
 * lessons from `suynl`, and the Encounter seasons from `training`. It writes only its own
 * three tables, and never deletes a row of them.
 */
@Injectable()
export class EquippingService {
  constructor(
    @Inject(DATABASE) private readonly db: Db,
    private readonly people: PeopleReadService,
    private readonly hierarchy: HierarchyService,
    private readonly cells: CellsReadService,
    private readonly attendance: AttendanceStandingService,
    private readonly suynl: SuynlService,
    private readonly seasons: EncounterSeasonsService,
    private readonly audit: AuditService,
    private readonly idempotency: IdempotencyService,
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
      this.attendance.standingOf(ids),
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
    const [checks, cells, births, leaderNames] = await Promise.all([
      this.requirementsOf([id]),
      this.cells.currentCellsOfMany([id]),
      this.people.birthDatesOf([id]),
      this.people.directLeaderNamesOf([id]),
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
  async search(term: string, limit: number, teachers = false): Promise<Record<string, unknown>[]> {
    // A Registrar record is never somebody signed up for a class, for the Admin too (decision
    // 0499, point 13); `candidate` and `register` refuse it the same way.
    const restrictTo = teachers ? await this.mayTeachWithin(this.db, null) : null;
    const { rows } = await this.people.searchByName(term, limit, null, restrictTo, {
      currentOnly: true,
      exclude: await this.people.equippingAccountPersons(),
    });
    const names = await this.people.directLeaderNamesOf(rows.map((row) => row.id));
    const decided = await this.people.forDecisions(rows.map((row) => row.id));
    return rows.map((row) => ({
      id: row.id,
      member_id: row.member_id,
      full_name: decided.get(row.id)?.fullName ?? `${row.first_name} ${row.last_name}`,
      direct_leader_name: names.get(row.id) ?? null,
    }));
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
    const [people, leaderNames, births] = await Promise.all([
      this.people.forDecisions(ids),
      this.people.directLeaderNamesOf(ids),
      this.people.birthDatesOf(ids),
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
      })),
      next_cursor: rows.length > limit ? encodeCursor(page[page.length - 1]) : null,
    };
  }

  /** A term's classes, each with how many are enrolled. Not paged: a handful a term. */
  async classes(query: EquippingTermDto): Promise<Record<string, unknown>> {
    const rows = await this.db
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
      ])
      .where('c.level', '=', query.level)
      .where('c.term_year', '=', query.term_year)
      .where('c.term_number', '=', query.term_number)
      .orderBy(sql`lower(c.name)`)
      .execute();

    const teachers = await this.people.forDecisions(rows.map((row) => row.teacher_person_id));
    return {
      data: rows.map((row) => ({
        ...this.classShape(row),
        teacher: {
          id: row.teacher_person_id,
          full_name: teachers.get(row.teacher_person_id)?.fullName ?? null,
        },
        enrolled: Number(row.enrolled ?? 0),
      })),
    };
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
    const [people, leaderNames, eligibility] = await Promise.all([
      this.people.forDecisions([...ids, cls.teacher_person_id]),
      this.people.directLeaderNamesOf(ids),
      this.eligibilityOf(
        ready.map((row) => row.person_id),
        cls.encounter_season_id,
      ),
    ]);
    const nameOf = (id: string) => people.get(id)?.fullName ?? null;

    return {
      class: {
        ...this.classShape(cls),
        level: cls.level,
        term_year: cls.term_year,
        term_number: cls.term_number,
        teacher: { id: cls.teacher_person_id, full_name: nameOf(cls.teacher_person_id) },
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
    const teacher = await this.people.forDecision(body.teacher_person_id);
    if (
      !teacher ||
      teacher.mergedIntoId !== null ||
      (await this.isEquippingRecord(body.teacher_person_id))
    ) {
      throw new NotFoundError('No such person to be the Teacher.');
    }
    if (teacher.isArchived) {
      throw new InvariantViolationError('That person is archived, so cannot teach a class.', {
        field: 'teacher_person_id',
      });
    }
    const seasons = await this.seasons.allSeasons();
    if (!seasons.some((season) => season.id === body.encounter_season_id)) {
      throw new NotFoundError('No such Encounter season.');
    }

    return this.write(async (trx) => {
      const mayTeach = await this.mayTeachWithin(trx, [canonicalId(teacher.id)]);
      if (!mayTeach.has(canonicalId(teacher.id))) {
        throw new InvariantViolationError(
          'Only a current Cell Leader in the tree may teach a class.',
          { field: 'teacher_person_id' },
        );
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
          teacher_person_id: canonicalId(teacher.id),
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
        teacher: { id: row.teacher_person_id, full_name: teacher.fullName },
        enrolled: 0,
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
      const enrollment = await this.openEnrollmentWithin(trx, enrollmentId);
      if (enrollment.class_id === toClassId) {
        throw new InvariantViolationError('They are already in that class.', {
          field: 'class_id',
        });
      }
      const to = await this.classWithin(trx, toClassId);
      const from = await this.classWithin(trx, enrollment.class_id);
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
      const enrollment = await this.openEnrollmentWithin(trx, enrollmentId);
      const cls = await this.classWithin(trx, enrollment.class_id);
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
  ): Promise<{
    id: string;
    name: string;
    level: EquippingLevel;
    term_year: number;
    term_number: number;
    encounter_season_id: string;
  }> {
    const cls = await trx
      .selectFrom('equipping_classes')
      .select(['id', 'name', 'level', 'term_year', 'term_number', 'encounter_season_id'])
      .where('id', '=', classId)
      .executeTakeFirst();
    if (cls === undefined) {
      throw new NotFoundError('No such class.');
    }
    return cls;
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
      throw error;
    }
  }
}
