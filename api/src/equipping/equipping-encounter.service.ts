import { Inject, Injectable } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';

import { AuditService } from '../audit/audit.service';
import { type Actor } from '../auth/authorization/authorization.service';
import { CellsReadService } from '../cells/cells.read.service';
import { InvariantViolationError, NotFoundError } from '../common/errors/api-error';
import { canonicalId } from '../common/identifiers';
import { IdempotencyService } from '../common/idempotency/idempotency.service';
import { isUniqueViolation, violatedConstraint } from '../common/errors/postgres-errors';
import { manilaDayOf } from '../common/time/manila';
import { databaseNow } from '../common/time/submission-window';
import { DATABASE, type Db } from '../database/database.module';
import { PeopleReadService } from '../people/people.read.service';
import { EncounterSeasonsService } from '../training/encounter-seasons.service';
import { TrainingService } from '../training/training.service';

import { EquippingAttendanceService, expectedOn } from './equipping-attendance.service';
import { ENCOUNTER_MINIMUM_AGE, ageOn } from './equipping.service';

import type { CurrentClaim } from '../common/idempotency/current-idempotency.decorator';
import type { Database, NetworkName } from '../database/schema';
import type { EncounterAttendanceDto, EnrollEncounterDto } from './dto/equipping.dto';

/** Lessons 1 to 4, which decide the Encounter (decision 0501, point 13). */
const BEFORE_ENCOUNTER = [1, 2, 3, 4] as const;

/** At most two of lessons 1 to 4 missed, each made up, to go (decision 0501, point 13). */
const ABSENCES_ALLOWED = 2;

type Status = 'CLEARED' | 'NEEDS_MAKE_UP' | 'CANT_GO';

/** One of lessons 1 to 4 as the list shows it: came, made up, absent, before joining, none. */
type Sign = 'CAME' | 'MADE_UP' | 'ABSENT' | 'BEFORE_JOINING' | 'NONE';

interface Candidate {
  enrollment_id: string;
  person_id: string;
  class_id: string;
  class_name: string;
  /** The season their class names, which differs for a student carried to a later weekend. */
  class_season_id: string;
  /** Missed an earlier season's weekend they were enrolled in. */
  missed_season_id: string | null;
}

interface Weekend {
  season: { id: string; mens_encounter_on: string; womens_encounter_on: string };
  on: string;
}

/**
 * **The Encounter's enrollment and attendance** (SKILL.md section 29, decisions 0501 and 0507).
 *
 * After lesson 4 a list for each Network's weekend reads *Cleared*, *Needs make-up* or *Can't
 * go*, worked out from the class's register: lessons 1 to 4 each came or made up, at most two
 * missed, and 14 by the weekend's first day. The Registrar enrolls cleared students before the
 * weekend begins, and from its first day records who came, which is the register's ENC column.
 * A student who missed it, or was not cleared in time, is listed for a later weekend. Every
 * route is Whole Church `equipping.manage`. It reads people and Cells through their services
 * (section 2) and writes only `equipping`'s tables.
 */
@Injectable()
export class EquippingEncounterService {
  constructor(
    @Inject(DATABASE) private readonly db: Db,
    private readonly people: PeopleReadService,
    private readonly cells: CellsReadService,
    private readonly seasons: EncounterSeasonsService,
    private readonly attendance: EquippingAttendanceService,
    private readonly training: TrainingService,
    private readonly audit: AuditService,
    private readonly idempotency: IdempotencyService,
  ) {}

  /** `GET /equipping/encounter`: one weekend's list. */
  async list(network: NetworkName, seasonId: string | undefined): Promise<Record<string, unknown>> {
    const all = await this.seasons.allSeasons(this.db);
    const now = await databaseNow(this.db);
    const today = manilaDayOf(now);
    const chosen = seasonId ?? this.currentSeasonOf(all, network, today);
    const seasons = all.map((each) => ({
      id: each.id,
      weekend_on: network === 'MENS' ? each.mens_encounter_on : each.womens_encounter_on,
    }));
    if (chosen === null) {
      return { network, seasons, season: null };
    }
    const weekend = this.weekendOf(all, chosen, network);
    const standing = await this.standingWithin(this.db, weekend, network, all);

    const personIds = [
      ...standing.candidates.map((c) => c.person_id),
      ...standing.enrolled.map((e) => e.person_id),
    ];
    const cellsOf = await this.cells.currentCellsOfMany(personIds);
    const leaderIds = [...cellsOf.values()].flatMap((c) =>
      c.membership?.leaderId ? [c.membership.leaderId] : [],
    );
    const names = await this.people.forDecisions([...personIds, ...leaderIds]);
    const nameOf = (id: string | null) => (id === null ? null : (names.get(id)?.fullName ?? null));
    const leaderOf = (personId: string) => {
      const id = cellsOf.get(personId)?.membership?.leaderId ?? null;
      return id === null ? null : { id, full_name: nameOf(id) };
    };
    const weekendOfSeason = new Map(seasons.map((s) => [s.id, s.weekend_on]));
    const byName = <T extends { person: { full_name: string | null } }>(a: T, b: T) =>
      (a.person.full_name ?? '').localeCompare(b.person.full_name ?? '');

    return {
      network,
      seasons,
      season: { id: weekend.season.id, weekend_on: weekend.on },
      // Enrolling closes when the weekend begins; from then the Registrar records who came.
      phase: today >= weekend.on ? 'RECORDING' : 'ENROLLING',
      students: standing.candidates
        .map((c) => {
          const s = standing.statusOf.get(c.enrollment_id)!;
          return {
            enrollment_id: c.enrollment_id,
            person: { id: c.person_id, full_name: nameOf(c.person_id) },
            class: { id: c.class_id, name: c.class_name },
            cell_leader: leaderOf(c.person_id),
            status: s.status,
            reasons: s.reasons,
            age_on_weekend: s.age,
            lessons: s.signs,
            missed_weekend_on:
              c.missed_season_id === null
                ? null
                : (weekendOfSeason.get(c.missed_season_id) ?? null),
            from_weekend_on:
              c.missed_season_id === null && c.class_season_id !== weekend.season.id
                ? (weekendOfSeason.get(c.class_season_id) ?? null)
                : null,
          };
        })
        .sort(byName),
      waiting: standing.waiting,
      enrolled: standing.enrolled
        .map((e) => ({
          encounter_enrollment_id: e.id,
          person: { id: e.person_id, full_name: nameOf(e.person_id) },
          class: { id: e.class_id, name: e.class_name },
          came: e.came,
        }))
        .sort(byName),
    };
  }

  /** `POST /equipping/encounter/enrollments`: cleared students into one weekend. */
  async enroll(
    actor: Actor,
    body: EnrollEncounterDto,
    claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    return this.write(async (trx) => {
      const all = await this.seasons.allSeasons(trx);
      const weekend = this.weekendOf(all, body.season_id, body.network);
      const ids = [...body.enrollment_ids].map((id) => canonicalId(id)).sort();
      // The classes of the named students, locked as a lesson save locks its class, so a mark
      // or make-up saved meanwhile is read before the status is decided.
      const classIds = await trx
        .selectFrom('equipping_enrollments')
        .select('class_id')
        .where('id', 'in', ids)
        .execute();
      await trx
        .selectFrom('equipping_classes')
        .select('id')
        .where('id', 'in', [...new Set(classIds.map((row) => row.class_id))].sort())
        .orderBy('id')
        .forNoKeyUpdate()
        .execute();

      const today = manilaDayOf(await databaseNow(trx));
      if (today >= weekend.on) {
        throw new InvariantViolationError(
          `The ${body.network === 'MENS' ? "Men's" : "Women's"} Encounter has begun; nobody more is enrolled in it.`,
          { field: 'season_id' },
        );
      }
      const standing = await this.standingWithin(trx, weekend, body.network, all);
      const candidates = new Map(standing.candidates.map((c) => [canonicalId(c.enrollment_id), c]));
      const refusals: { enrollment_id: string; reason: string }[] = [];
      for (const id of ids) {
        const candidate = candidates.get(id);
        const status = standing.statusOf.get(candidate?.enrollment_id ?? '');
        if (candidate === undefined || status === undefined) {
          refusals.push({ enrollment_id: id, reason: 'not on this weekend’s list' });
        } else if (status.status !== 'CLEARED') {
          refusals.push({ enrollment_id: id, reason: status.reasons.join(' ') });
        }
      }
      if (refusals.length > 0) {
        throw new InvariantViolationError(
          'Some of them are not cleared for this weekend. Nobody was enrolled.',
          { refusals },
        );
      }

      const chosen = ids.map((id) => candidates.get(id)!);
      const inserted = await trx
        .insertInto('equipping_encounter_enrollments')
        .values(
          chosen.map((c) => ({
            enrollment_id: c.enrollment_id,
            person_id: c.person_id,
            encounter_season_id: weekend.season.id,
            network: body.network,
            enrolled_by: actor.accountId,
          })),
        )
        .returning(['id', 'enrollment_id'])
        .execute();
      for (const c of chosen) {
        await this.audit.writeWithin(trx, {
          actorId: actor.accountId,
          action: 'equipping_encounter_enrollment.created',
          targetType: 'person',
          targetId: c.person_id,
          before: null,
          after: { season_id: weekend.season.id, network: body.network, weekend_on: weekend.on },
        });
      }
      const response = {
        season_id: weekend.season.id,
        network: body.network,
        enrolled: inserted.map((row) => ({
          encounter_enrollment_id: row.id,
          enrollment_id: row.enrollment_id,
        })),
      };
      await this.idempotency.completeWithin(trx, { ...claim, status: 201, body: response });
      return response;
    });
  }

  /**
   * `POST /equipping/encounter/attendance`: who came to one weekend, from its first day. Every
   * enrolled student not named is saved as not attended; a change closes the earlier row.
   */
  async recordAttendance(
    actor: Actor,
    body: EncounterAttendanceDto,
    claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    return this.write(async (trx) => {
      const all = await this.seasons.allSeasons(trx);
      const weekend = this.weekendOf(all, body.season_id, body.network);
      // The classes of those enrolled, locked first as a lesson save and a posting lock them, so
      // a class is not checked or posted beside a change to who came (decision 0508).
      const classes = await trx
        .selectFrom('equipping_encounter_enrollments as ee')
        .innerJoin('equipping_registrations as r', 'r.person_id', 'ee.person_id')
        .innerJoin('equipping_enrollments as e', 'e.registration_id', 'r.id')
        .select('e.class_id')
        .distinct()
        .where('ee.encounter_season_id', '=', weekend.season.id)
        .where('ee.network', '=', body.network)
        .where('e.ended_at', 'is', null)
        .execute();
      if (classes.length > 0) {
        await trx
          .selectFrom('equipping_classes')
          .select('id')
          .where(
            'id',
            'in',
            classes.map((row) => row.class_id),
          )
          .orderBy('id')
          .forNoKeyUpdate()
          .execute();
      }
      const locked = await trx
        .selectFrom('equipping_encounter_enrollments')
        .select(['id', 'person_id', 'enrollment_id'])
        .where('encounter_season_id', '=', weekend.season.id)
        .where('network', '=', body.network)
        .orderBy('id')
        .forUpdate()
        .execute();
      const today = manilaDayOf(await databaseNow(trx));
      if (today < weekend.on) {
        throw new InvariantViolationError('Who came is recorded from the weekend’s first day.', {
          field: 'season_id',
        });
      }
      // **Only the students the page lists are written** (decision 0507): one archived, withdrawn,
      // moved to a later season's class or now of the other Network since is left as recorded,
      // never saved as not attended by a page that could not show them.
      const listed = new Set(
        (await this.standingWithin(trx, weekend, body.network, all)).enrolled.map((row) =>
          canonicalId(row.id),
        ),
      );
      const enrolled = locked.filter((row) => listed.has(canonicalId(row.id)));
      const known = new Set(enrolled.map((row) => canonicalId(row.id)));
      const came = new Set(body.came.map((id) => canonicalId(id)));
      const stranger = [...came].find((id) => !known.has(id));
      if (stranger !== undefined) {
        throw new InvariantViolationError('Somebody in the list is not enrolled in this weekend.', {
          field: 'came',
        });
      }
      const current = enrolled.length
        ? await trx
            .selectFrom('equipping_encounter_attendance')
            .select(['id', 'encounter_enrollment_id', 'came'])
            .where(
              'encounter_enrollment_id',
              'in',
              enrolled.map((row) => row.id),
            )
            .where('superseded_at', 'is', null)
            .execute()
        : [];
      const currentOf = new Map(
        current.map((row) => [canonicalId(row.encounter_enrollment_id), row]),
      );
      // **A person attends one Encounter** (decision 0507): every weekend row of the people
      // ticked is locked, so a save on another weekend waits, and one who attended another is
      // refused in words rather than by the database's backstop.
      const tickedPeople = enrolled
        .filter((row) => came.has(canonicalId(row.id)))
        .map((row) => row.person_id);
      if (tickedPeople.length > 0) {
        const theirs = await trx
          .selectFrom('equipping_encounter_enrollments')
          .select(['id', 'person_id'])
          .where('person_id', 'in', tickedPeople)
          .orderBy('id')
          .forUpdate()
          .execute();
        const elsewhere = theirs.filter((row) => !known.has(canonicalId(row.id)));
        const attended = elsewhere.length
          ? await trx
              .selectFrom('equipping_encounter_attendance')
              .select('encounter_enrollment_id')
              .where(
                'encounter_enrollment_id',
                'in',
                elsewhere.map((row) => row.id),
              )
              .where('superseded_at', 'is', null)
              .where('came', '=', true)
              .execute()
          : [];
        if (attended.length > 0) {
          const ids = new Set(attended.map((row) => canonicalId(row.encounter_enrollment_id)));
          const people = elsewhere
            .filter((row) => ids.has(canonicalId(row.id)))
            .map((row) => row.person_id);
          const names = await this.people.forDecisions(people);
          throw new InvariantViolationError(
            `Already recorded at another Encounter: ${people
              .map((id) => names.get(id)?.fullName ?? 'somebody')
              .join(', ')}. Correct that weekend first.`,
            { field: 'came' },
          );
        }
      }
      // **A posted Not yet passes at a later Encounter** (decision 0509): the posted grade on the
      // weekend row's own registration, through its open enrollment, locked. A move keeps the
      // registration and opens a new enrollment on it, so a student moved since is still found,
      // and a Life Class of another term, on another registration, never is. A grade found here
      // is passed, or was passed, at most once.
      const notYet = enrolled.length
        ? await trx
            .selectFrom('equipping_encounter_enrollments as ee')
            .innerJoin('equipping_enrollments as made', 'made.id', 'ee.enrollment_id')
            .innerJoin('equipping_enrollments as e', 'e.registration_id', 'made.registration_id')
            .innerJoin('equipping_final_grades as g', 'g.enrollment_id', 'e.id')
            .select([
              'ee.id as encounter_enrollment_id',
              'g.id',
              'g.enrollment_id',
              'g.passed_later_at',
            ])
            .where(
              'ee.id',
              'in',
              enrolled.map((row) => row.id),
            )
            .where('g.grade', '=', 'NOT_YET')
            .orderBy('g.id')
            .forUpdate(['g'])
            .execute()
        : [];
      const notYetOf = new Map(
        notYet.map((row) => [canonicalId(row.encounter_enrollment_id), row]),
      );
      // One who passed at this weekend is not recorded as not attended: the Life Class it filed
      // rests on it (owner, 2026-11-22).
      const undone = enrolled.filter(
        (row) =>
          !came.has(canonicalId(row.id)) &&
          currentOf.get(canonicalId(row.id))?.came === true &&
          notYetOf.get(canonicalId(row.id))?.passed_later_at != null,
      );
      if (undone.length > 0) {
        const names = await this.people.forDecisions(undone.map((row) => row.person_id));
        throw new InvariantViolationError(
          `Passed Life Class at this Encounter, so cannot be recorded as not attended: ${undone
            .map((row) => names.get(row.person_id)?.fullName ?? 'somebody')
            .join(', ')}.`,
          { field: 'came' },
        );
      }
      // Training's graduations are filed after the attendance, in person order.
      const toFile: { personId: string; encounterEnrollmentId: string; came: boolean }[] = [];
      let changed = 0;
      for (const row of enrolled) {
        const wants = came.has(canonicalId(row.id));
        const was = currentOf.get(canonicalId(row.id));
        if (was !== undefined && was.came === wants) {
          continue;
        }
        if (was !== undefined) {
          await trx
            .updateTable('equipping_encounter_attendance')
            .set({ superseded_at: sql`now()`, superseded_by: actor.accountId })
            .where('id', '=', was.id)
            .execute();
        }
        await trx
          .insertInto('equipping_encounter_attendance')
          .values({ encounter_enrollment_id: row.id, came: wants, recorded_by: actor.accountId })
          .execute();
        await this.audit.writeWithin(trx, {
          actorId: actor.accountId,
          action: 'equipping_encounter_attendance.recorded',
          targetType: 'person',
          targetId: row.person_id,
          before: was === undefined ? null : { came: was.came },
          after: { came: wants, season_id: weekend.season.id, weekend_on: weekend.on },
        });
        changed += 1;
        // A first record of not attended files and withdraws nothing: only a correction from came
        // withdraws, and only what this weekend filed.
        if (wants || was?.came === true) {
          toFile.push({ personId: row.person_id, encounterEnrollmentId: row.id, came: wants });
        }
      }
      // **The Encounter attended is filed from the school** (decision 0509), dated the weekend,
      // and a correction to not attended withdraws the one this weekend filed.
      toFile.sort((a, b) => canonicalId(a.personId).localeCompare(canonicalId(b.personId)));
      for (const each of toFile) {
        if (!each.came) {
          await this.training.withdrawFromSchoolWithin(trx, {
            personId: each.personId,
            program: 'ENCOUNTER',
            graduatedOn: weekend.on,
            accountId: actor.accountId,
            reason: `Corrected to not attended at the Encounter of ${weekend.on}.`,
          });
          continue;
        }
        await this.training.fileFromSchoolWithin(trx, {
          personId: each.personId,
          program: 'ENCOUNTER',
          graduatedOn: weekend.on,
          accountId: actor.accountId,
        });
        const grade = notYetOf.get(canonicalId(each.encounterEnrollmentId));
        if (grade === undefined || grade.passed_later_at !== null) {
          continue;
        }
        await this.passLaterWithin(
          trx,
          actor,
          { person_id: each.personId, enrollment_id: grade.enrollment_id },
          grade.id,
          weekend.on,
        );
      }
      const response = {
        season_id: weekend.season.id,
        network: body.network,
        came: came.size,
        did_not: enrolled.length - came.size,
        changed,
      };
      await this.idempotency.completeWithin(trx, { ...claim, status: 200, body: response });
      return response;
    });
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * **A posted Not yet passes** (decision 0509): the posted grade records when and by whom,
   * the enrollment ends completed, and Life Class is filed from the school, dated the weekend
   * they attended.
   */
  private async passLaterWithin(
    trx: Transaction<Database>,
    actor: Actor,
    row: { person_id: string; enrollment_id: string },
    gradeId: string,
    weekendOn: string,
  ): Promise<void> {
    await trx
      .updateTable('equipping_final_grades')
      .set({ passed_later_at: sql`now()`, passed_later_by: actor.accountId })
      .where('id', '=', gradeId)
      .execute();
    const ended = await trx
      .updateTable('equipping_enrollments')
      .set({ ended_at: sql`now()`, ended_by: actor.accountId, end_reason: 'COMPLETED' })
      .where('id', '=', row.enrollment_id)
      .where('ended_at', 'is', null)
      .returning('class_id')
      .executeTakeFirst();
    if (ended !== undefined) {
      await this.audit.writeWithin(trx, {
        actorId: actor.accountId,
        action: 'equipping_enrollment.ended',
        targetType: 'person',
        targetId: row.person_id,
        before: { enrollment_id: row.enrollment_id, class_id: ended.class_id },
        after: { end_reason: 'COMPLETED', passed_at_encounter_on: weekendOn },
      });
    }
    await this.audit.writeWithin(trx, {
      actorId: actor.accountId,
      action: 'equipping_final_grade.passed_later',
      targetType: 'person',
      targetId: row.person_id,
      before: { grade: 'NOT_YET' },
      after: { passed_at_encounter_on: weekendOn },
    });
    await this.training.fileFromSchoolWithin(trx, {
      personId: row.person_id,
      program: 'LIFE_CLASS',
      graduatedOn: weekendOn,
      accountId: actor.accountId,
    });
  }

  /**
   * The season a weekend's list opens on: the earliest whose weekend is no more than two weeks
   * past, so who came can still be recorded after it, else the latest.
   */
  private currentSeasonOf(
    all: readonly { id: string; mens_encounter_on: string; womens_encounter_on: string }[],
    network: NetworkName,
    today: string,
  ): string | null {
    const recent = new Date(`${today}T00:00:00Z`);
    recent.setUTCDate(recent.getUTCDate() - 14);
    const floor = recent.toISOString().slice(0, 10);
    const dated = all
      .map((each) => ({
        id: each.id,
        on: network === 'MENS' ? each.mens_encounter_on : each.womens_encounter_on,
      }))
      .sort((a, b) => a.on.localeCompare(b.on));
    return dated.find((each) => each.on >= floor)?.id ?? dated[dated.length - 1]?.id ?? null;
  }

  private weekendOf(
    all: readonly { id: string; mens_encounter_on: string; womens_encounter_on: string }[],
    seasonId: string,
    network: NetworkName,
  ): Weekend {
    const season = all.find((each) => canonicalId(each.id) === canonicalId(seasonId));
    if (season === undefined) {
      throw new NotFoundError('No such Encounter season.');
    }
    return {
      season,
      on: network === 'MENS' ? season.mens_encounter_on : season.womens_encounter_on,
    };
  }

  /**
   * Who is on one weekend's list, and where each stands. A student is listed for the weekend
   * of their class's season, or for a later one when they have not attended an Encounter, are
   * enrolled in no weekend still to be recorded, and their own season's weekend is past or was
   * missed. A class whose lesson 4 is not saved yet lists nobody: it waits.
   */
  private async standingWithin(
    executor: Db | Transaction<Database>,
    weekend: Weekend,
    network: NetworkName,
    all: readonly { id: string; mens_encounter_on: string; womens_encounter_on: string }[],
  ) {
    const weekendOfSeason = new Map(
      all.map((s) => [
        canonicalId(s.id),
        network === 'MENS' ? s.mens_encounter_on : s.womens_encounter_on,
      ]),
    );
    const open = await executor
      .selectFrom('equipping_enrollments as e')
      .innerJoin('equipping_registrations as r', 'r.id', 'e.registration_id')
      .innerJoin('equipping_classes as c', 'c.id', 'e.class_id')
      .select([
        'e.id as enrollment_id',
        'e.registration_id',
        'e.started_at',
        'r.person_id',
        'c.id as class_id',
        'c.name as class_name',
        'c.first_lesson_on',
        'c.encounter_season_id',
      ])
      .where('e.ended_at', 'is', null)
      .where('r.level', '=', 'LIFE_CLASS')
      .execute();
    // Their class's weekend on or before this one.
    const inReach = open.filter(
      (row) => (weekendOfSeason.get(canonicalId(row.encounter_season_id)) ?? '9999') <= weekend.on,
    );
    const networks = await this.people.currentNetworksOf(inReach.map((row) => row.person_id));
    const ours = inReach.filter((row) => networks.get(row.person_id) === network);

    const encounterRows = ours.length
      ? await executor
          .selectFrom('equipping_encounter_enrollments as ee')
          .innerJoin('equipping_enrollments as e', 'e.id', 'ee.enrollment_id')
          .innerJoin('equipping_classes as c', 'c.id', 'e.class_id')
          .leftJoin('equipping_encounter_attendance as a', (join) =>
            join.onRef('a.encounter_enrollment_id', '=', 'ee.id').on('a.superseded_at', 'is', null),
          )
          .select([
            'ee.id',
            'ee.person_id',
            'ee.encounter_season_id',
            'ee.network',
            'c.id as class_id',
            'c.name as class_name',
            'a.came',
          ])
          .where(
            'ee.person_id',
            'in',
            ours.map((row) => row.person_id),
          )
          .execute()
      : [];
    const thisSeason = canonicalId(weekend.season.id);
    const enrolled = encounterRows
      .filter(
        (row) => canonicalId(row.encounter_season_id) === thisSeason && row.network === network,
      )
      .map((row) => ({ ...row, came: row.came ?? null }));
    const enrolledPeople = new Set(enrolled.map((row) => canonicalId(row.person_id)));

    const earliestOnOf = new Map<string, string>();
    for (const row of ours) {
      const on = weekendOfSeason.get(canonicalId(row.encounter_season_id)) ?? '9999';
      const person = canonicalId(row.person_id);
      if (!earliestOnOf.has(person) || on < earliestOnOf.get(person)!) {
        earliestOnOf.set(person, on);
      }
    }
    const candidates: Candidate[] = [];
    for (const row of ours) {
      const person = canonicalId(row.person_id);
      if (enrolledPeople.has(person)) {
        continue;
      }
      const theirs = encounterRows.filter((each) => canonicalId(each.person_id) === person);
      // Attended one, or enrolled in another weekend whose attendance is not recorded yet and
      // still listed there: their Network's weekend, and their class's weekend on or before it.
      // **One who has left that weekend's list is carried** (owner, 2026-11-22, decision 0507),
      // the unrecorded row holding nobody back.
      const ownOn = weekendOfSeason.get(canonicalId(row.encounter_season_id)) ?? '9999';
      // The earliest of their open classes' weekends decides that weekend's list, as `ours`
      // counts a person once any of their rows reaches it.
      const earliestOn = earliestOnOf.get(person) ?? ownOn;
      if (
        theirs.some(
          (each) =>
            each.came === true ||
            // One weekend a season (the unique key): a row in this season, of either Network,
            // carries them to the next season rather than to this one's other weekend.
            canonicalId(each.encounter_season_id) === thisSeason ||
            (each.came === null &&
              each.network === network &&
              earliestOn <= (weekendOfSeason.get(canonicalId(each.encounter_season_id)) ?? '')),
        )
      ) {
        continue;
      }
      const missed = theirs
        .filter((each) => each.came === false)
        .sort((a, b) =>
          (weekendOfSeason.get(canonicalId(b.encounter_season_id)) ?? '').localeCompare(
            weekendOfSeason.get(canonicalId(a.encounter_season_id)) ?? '',
          ),
        )[0];
      // A student of an earlier season who was neither enrolled nor missed it is listed once
      // that weekend has begun, for this later one.
      const ownSeason = canonicalId(row.encounter_season_id);
      if (ownSeason !== thisSeason && missed === undefined) {
        if (ownOn >= weekend.on) {
          continue;
        }
      }
      candidates.push({
        enrollment_id: row.enrollment_id,
        person_id: row.person_id,
        class_id: row.class_id,
        class_name: row.class_name,
        class_season_id: row.encounter_season_id,
        missed_season_id: missed?.encounter_season_id ?? null,
      });
    }

    // Lesson 4 saved, or the class waits.
    const classIds = [...new Set(candidates.map((c) => c.class_id))];
    const fourth = classIds.length
      ? await executor
          .selectFrom('equipping_lessons')
          .select('class_id')
          .where('class_id', 'in', classIds)
          .where('lesson', '=', 4)
          .execute()
      : [];
    const held = new Set(fourth.map((row) => canonicalId(row.class_id)));
    const waiting = [
      ...new Map(
        ours
          .filter(
            (row) =>
              candidates.some((c) => c.enrollment_id === row.enrollment_id) &&
              !held.has(canonicalId(row.class_id)),
          )
          .map((row) => [
            row.class_id,
            {
              class: { id: row.class_id, name: row.class_name },
              lesson_4_on: expectedOn(String(row.first_lesson_on), 4),
            },
          ]),
      ).values(),
    ].sort((a, b) => a.class.name.localeCompare(b.class.name));
    const listed = candidates.filter((c) => held.has(canonicalId(c.class_id)));

    // Each class's register, read as the class's own page reads it (decision 0503).
    const statusOf = new Map<
      string,
      { status: Status; reasons: string[]; age: number | null; signs: Sign[] }
    >();
    const [births, decisions] = await Promise.all([
      this.people.birthDatesOf(listed.map((c) => c.person_id)),
      this.people.forDecisions(listed.map((c) => c.person_id)),
    ]);
    for (const classId of new Set(listed.map((c) => c.class_id))) {
      const rows = ours.filter(
        (row) =>
          row.class_id === classId && listed.some((c) => c.enrollment_id === row.enrollment_id),
      );
      const registers = await this.attendance.registersOf(executor, classId, rows);
      for (const row of rows) {
        const register = registers.get(row.enrollment_id)!;
        const signs: Sign[] = BEFORE_ENCOUNTER.map((n) => {
          const entry = register.get(n);
          if (entry === undefined) return 'NONE';
          if (entry.came) return 'CAME';
          if (entry.madeUpOn !== null) return 'MADE_UP';
          return entry.beforeJoining ? 'BEFORE_JOINING' : 'ABSENT';
        });
        const absences = BEFORE_ENCOUNTER.filter((n) => {
          const entry = register.get(n);
          return entry !== undefined && !entry.came && !entry.beforeJoining;
        });
        const owed = BEFORE_ENCOUNTER.filter(
          (_, i) => signs[i] === 'ABSENT' || signs[i] === 'BEFORE_JOINING',
        );
        const unmarked = BEFORE_ENCOUNTER.filter((_, i) => signs[i] === 'NONE');
        const birthDate =
          births.get(canonicalId(row.person_id)) ?? births.get(row.person_id) ?? null;
        const age = birthDate === null ? null : ageOn(birthDate, weekend.on);
        const decision = decisions.get(row.person_id);
        const reasons: string[] = [];
        let status: Status = 'CLEARED';
        if (decision === undefined || decision.isArchived || decision.mergedIntoId !== null) {
          status = 'CANT_GO';
          reasons.push('Archived or merged.');
        } else if (absences.length > ABSENCES_ALLOWED) {
          status = 'CANT_GO';
          reasons.push(`${absences.length} absences in lessons 1 to 4. Repeats Life Class.`);
        } else if (age === null) {
          status = 'CANT_GO';
          reasons.push('No birthday recorded.');
        } else if (age < ENCOUNTER_MINIMUM_AGE) {
          status = 'CANT_GO';
          reasons.push(`${age} on ${weekend.on}. Must be ${ENCOUNTER_MINIMUM_AGE}.`);
        } else if (owed.length > 0 || unmarked.length > 0) {
          status = 'NEEDS_MAKE_UP';
          if (owed.length > 0) {
            reasons.push(`${joinLessons(owed)} not made up yet.`);
          }
          if (unmarked.length > 0) {
            reasons.push(`${joinLessons(unmarked)} not marked.`);
          }
        }
        statusOf.set(row.enrollment_id, { status, reasons, age, signs });
      }
    }

    return { candidates: listed, statusOf, waiting, enrolled };
  }

  private async write<T>(work: (trx: Transaction<Database>) => Promise<T>): Promise<T> {
    try {
      return await this.db.transaction().execute(work);
    } catch (error) {
      if (
        isUniqueViolation(error) &&
        violatedConstraint(error) === 'equipping_encounter_enrollments_one_per_season'
      ) {
        throw new InvariantViolationError('Somebody in the list is already enrolled this season.', {
          field: 'enrollment_ids',
        });
      }
      throw error;
    }
  }
}

/** *L2*, *L1 and L3*, *L1, L2 and L4*. */
function joinLessons(lessons: readonly number[]): string {
  const named = lessons.map((n) => `L${n}`);
  return named.length <= 1
    ? (named[0] ?? '')
    : `${named.slice(0, -1).join(', ')} and ${named[named.length - 1]}`;
}
