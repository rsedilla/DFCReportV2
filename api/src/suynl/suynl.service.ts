import { Inject, Injectable } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';

import { AuditService } from '../audit/audit.service';
import { AccountsRepository } from '../auth/accounts.repository';
import { AuthorizationService, type Actor } from '../auth/authorization/authorization.service';
import { Capability } from '../auth/authorization/capabilities';
import {
  ApiError,
  ApiErrorCode,
  InvariantViolationError,
  ValidationFailedError,
} from '../common/errors/api-error';
import { isUniqueViolation, violatedConstraint } from '../common/errors/postgres-errors';
import { GrowthConflictError, nameOfAccount, nameOfPerson } from '../common/growth/growth-conflict';
import { filingFor, mayFileEach, type Filing } from '../common/growth/growth-filing';
import { growthPage, growthPopulation } from '../common/growth/growth-list';
import { canonicalId } from '../common/identifiers';
import { IdempotencyService } from '../common/idempotency/idempotency.service';
import { manilaDayOf } from '../common/time/manila';
import { databaseNow } from '../common/time/submission-window';
import { DATABASE, type Db } from '../database/database.module';
import { HierarchyService } from '../hierarchy/hierarchy.service';
import { PeopleReadService } from '../people/people.read.service';
import { composeName } from '../people/people.shared';

import type { CurrentClaim } from '../common/idempotency/current-idempotency.decorator';
import type { Database } from '../database/schema';
import type { SuynlListDto, SuynlStep } from './dto/suynl.dto';

/** One change as the DTO delivers it. */
export interface SuynlChange {
  person_id: string;
  lesson: number;
  done: boolean;
  seen_id?: string | null;
  reason?: string;
}

/** A current lesson row. */
interface Lesson {
  id: string;
  personId: string;
  lesson: number;
  confirmedAt: Date;
  recordedBy: string;
  /** Whose statement the row is, which a correction is attributed to (section 28). */
  confirmedBy: string | null;
}

type Outcome = 'UNCHANGED' | 'CREATE' | 'RETRACT' | 'STALE';

const CAPABILITIES = {
  confirm: Capability.SuynlConfirm,
  onBehalf: Capability.SuynlConfirmOnBehalf,
};

/** Section 28's one-current-row index, whose violation is a lost race and nothing else. */
const ONE_CURRENT_INDEX = 'suynl_lessons_one_current_per_lesson';

/**
 * SUYNL lessons (SKILL.md section 28): the tab's counts, its list and its save.
 *
 * Every read outside `suynl_lessons` goes through the module owning the table (section
 * 2): `people` for who is listed and their lifecycle, `hierarchy` for the pastoral
 * leader, `authorization` for scope, `auth` for the name behind an account.
 */
@Injectable()
export class SuynlService {
  constructor(
    @Inject(DATABASE) private readonly db: Db,
    private readonly hierarchy: HierarchyService,
    private readonly people: PeopleReadService,
    private readonly accounts: AccountsRepository,
    private readonly authorization: AuthorizationService,
    private readonly audit: AuditService,
    private readonly idempotency: IdempotencyService,
  ) {}

  /** What the shared Growth helpers read through, each the module owning its table. */
  private get deps() {
    return {
      authorization: this.authorization,
      hierarchy: this.hierarchy,
      people: this.people,
      accounts: this.accounts,
    };
  }

  /**
   * `GET /api/v1/suynl/counts`: the three cards, which add up to everyone the tab lists
   * (decision 0281), as things stand now.
   */
  async counts(actor: Actor): Promise<Record<string, unknown>> {
    const population = await growthPopulation(this.deps, actor, Capability.SuynlViewSubtree);
    const progress = await this.currentProgress(population);
    const people = await this.people.countCurrent(population);

    const inProgress = [...progress.values()].filter((entry) => entry.count < 10).length;
    const graduated = progress.size - inProgress;

    return {
      people,
      not_started: people - progress.size,
      in_progress: inProgress,
      graduated,
    };
  }

  /** `GET /api/v1/suynl/people`: the tab's list, one page (section 28). */
  async list(actor: Actor, query: SuynlListDto): Promise<Record<string, unknown>> {
    const now = await databaseNow(this.db);
    const population = await growthPopulation(this.deps, actor, Capability.SuynlViewSubtree);
    const progress = await this.currentProgress(population);

    const { rows, nextCursor } = await growthPage(
      this.deps,
      this.db,
      actor,
      population,
      query,
      narrowingFor(query.step, progress),
      now,
    );

    const ids = rows.map((row) => row.id);
    const lessons = await this.currentLessons(this.db, ids);
    const identities = await this.people.forDecisions(ids);
    const authority = await this.authorization.authorityFor(actor.accountId);
    const mayFile = await mayFileEach(
      this.deps,
      this.db,
      actor,
      authority,
      CAPABILITIES,
      [...identities.values()],
      now,
    );

    return {
      data: rows.map((row) => {
        const own = lessons
          .filter((lesson) => canonicalId(lesson.personId) === canonicalId(row.id))
          .sort((left, right) => left.lesson - right.lesson);

        return {
          person_id: row.id,
          member_id: row.member_id,
          full_name: composeName(row),
          lessons: own.map((lesson) => ({
            id: lesson.id,
            lesson: lesson.lesson,
            filed_on: manilaDayOf(lesson.confirmedAt),
          })),
          graduated_on: own.length === 10 ? manilaDayOf(latest(own)) : null,
          may_file: mayFile.has(row.id),
        };
      }),
      next_cursor: nextCursor,
    };
  }

  /**
   * `POST /api/v1/suynl/submit` (sections 14, 22 and 28; decisions 0279, 0280, 0282).
   *
   * **All or nothing**, as a DCC submission is: every line is decided before anything
   * is written, and the first refusal in the order the client sent is the one named.
   */
  async submit(
    actor: Actor,
    changes: readonly SuynlChange[],
    claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    assertWellFormed(changes);

    // On the pool before the transaction opens (section 24), as every write does.
    const authority = await this.authorization.authorityFor(actor.accountId);

    try {
      return await this.db.transaction().execute(async (trx) => {
        const now = await databaseNow(trx);
        const personIds = unique(changes.map((change) => change.person_id));
        const identities = await this.people.forDecisionsWithin(trx, personIds);
        const assignments = await this.hierarchy.assignmentsAsOf(trx, personIds, now);
        const filings = new Map<string, Filing>();

        for (const change of changes) {
          const key = canonicalId(change.person_id);
          if (filings.has(key)) {
            continue;
          }

          const filing = await filingFor(
            this.deps,
            trx,
            actor,
            authority,
            CAPABILITIES,
            change.person_id,
            identities.get(change.person_id),
            assignments.get(change.person_id),
          );

          if (filing instanceof Error) {
            throw filing;
          }

          filings.set(key, filing);
        }

        // Locked, so a correction racing this one waits and then reads what it left.
        const stored = keyed(await this.currentLessons(trx, personIds, { lock: true }));
        const outcomes = changes.map((change) => outcomeOf(change, stored));

        const staleAt = outcomes.indexOf('STALE');
        if (staleAt !== -1) {
          throw await this.conflictFor(trx, actor, changes[staleAt], stored);
        }

        let created = 0;
        let corrected = 0;

        for (const [index, change] of changes.entries()) {
          const filing = filings.get(canonicalId(change.person_id)) as Filing;

          if (outcomes[index] === 'CREATE') {
            await trx
              .insertInto('suynl_lessons')
              .values({
                person_id: change.person_id,
                lesson: change.lesson,
                confirmed_by: filing.confirmedBy,
                recorded_by: actor.accountId,
              })
              .execute();

            await this.audit.writeWithin(trx, {
              actorId: actor.accountId,
              action: 'suynl_lesson.confirmed',
              targetType: 'person',
              targetId: change.person_id,
              after: {
                lesson: change.lesson,
                filed_on: manilaDayOf(now),
                confirmed_by: filing.confirmedBy,
                on_behalf: filing.onBehalf,
              },
            });
            created += 1;
          } else if (outcomes[index] === 'RETRACT') {
            const row = stored.get(keyOf(change.person_id, change.lesson)) as Lesson;

            await trx
              .updateTable('suynl_lessons')
              .set({
                superseded_at: sql<Date>`now()`,
                corrected_by: actor.accountId,
                correction_reason: change.reason ?? null,
              })
              .where('id', '=', row.id)
              .execute();

            await this.audit.writeWithin(trx, {
              actorId: actor.accountId,
              action: 'suynl_lesson.corrected',
              targetType: 'person',
              targetId: change.person_id,
              before: { lesson: row.lesson, filed_on: manilaDayOf(row.confirmedAt) },
              after: {
                lesson: row.lesson,
                withdrawn: true,
                confirmed_by: row.confirmedBy,
                on_behalf: onBehalfOf(row.confirmedBy, actor.personId),
              },
              reason: change.reason ?? null,
            });
            corrected += 1;
          }
        }

        const response = {
          created,
          corrected,
          unchanged: changes.length - created - corrected,
        };

        // Last statement in the transaction, and inside it (CLAUDE.md, *Write endpoints*).
        await this.idempotency.completeWithin(trx, { ...claim, status: 201, body: response });

        return response;
      });
    } catch (error) {
      if (!isUniqueViolation(error) || violatedConstraint(error) !== ONE_CURRENT_INDEX) {
        throw error;
      }

      // A lost race on a first tick (section 22, *Write conflicts*): re-read what is now
      // committed and answer on it — a conflict where a line now disagrees, otherwise
      // `RESOURCE_BUSY`, since the identical body resubmitted writes nothing.
      const personIds = unique(changes.map((change) => change.person_id));
      const stored = keyed(await this.currentLessons(this.db, personIds));
      const stale = changes.find((change) => outcomeOf(change, stored) === 'STALE');

      if (stale !== undefined) {
        throw await this.conflictFor(this.db, actor, stale, stored);
      }

      throw new ApiError(
        ApiErrorCode.RESOURCE_BUSY,
        'Somebody else recorded these lessons while yours was being saved. Retry shortly, ' +
          'with the same key.',
        {},
      );
    }
  }

  /**
   * When each of these people's third current lesson was filed, for Win 3 (SKILL.md
   * section 27; decision 0284). A lesson corrected away never counted (section 28), so
   * only current rows are read; somebody with fewer than three is absent.
   */
  async thirdLessonInstantsOf(personIds: readonly string[]): Promise<Map<string, Date>> {
    if (personIds.length === 0) {
      return new Map();
    }

    const rows = await this.db
      .selectFrom('suynl_lessons')
      .select(['person_id', 'confirmed_at'])
      .where('person_id', 'in', [...personIds])
      .where('superseded_at', 'is', null)
      .orderBy('confirmed_at')
      .execute();

    const seen = new Map<string, number>();
    const third = new Map<string, Date>();

    for (const row of rows) {
      const count = (seen.get(row.person_id) ?? 0) + 1;
      seen.set(row.person_id, count);
      if (count === 3) {
        third.set(row.person_id, row.confirmed_at);
      }
    }

    return third;
  }

  /** Each current person with at least one current lesson, and how many they hold. */
  private async currentProgress(
    population: ReadonlySet<string> | null,
  ): Promise<Map<string, { count: number }>> {
    if (population !== null && population.size === 0) {
      return new Map();
    }

    const rows = await this.db
      .selectFrom('suynl_lessons')
      .select((eb) => ['person_id', eb.fn.countAll<string>().as('count')])
      .where('superseded_at', 'is', null)
      .$if(population !== null, (qb) => qb.where('person_id', 'in', [...(population ?? [])]))
      .groupBy('person_id')
      .execute();

    // Current people only (decision 0279): a lesson row outlives an archival or a merge.
    const identities = await this.people.forDecisions(rows.map((row) => row.person_id));
    const progress = new Map<string, { count: number }>();

    for (const row of rows) {
      const identity = identities.get(row.person_id);
      if (identity !== undefined && !identity.isArchived && identity.mergedIntoId === null) {
        progress.set(canonicalId(row.person_id), { count: Number(row.count) });
      }
    }

    return progress;
  }

  private async currentLessons(
    executor: Db | Transaction<Database>,
    personIds: readonly string[],
    options: { lock?: boolean } = {},
  ): Promise<Lesson[]> {
    if (personIds.length === 0) {
      return [];
    }

    const rows = await executor
      .selectFrom('suynl_lessons')
      .select(['id', 'person_id', 'lesson', 'confirmed_at', 'recorded_by', 'confirmed_by'])
      .where('person_id', 'in', [...personIds])
      .where('superseded_at', 'is', null)
      .$if(options.lock === true, (qb) => qb.forUpdate())
      .execute();

    return rows.map((row) => ({
      id: row.id,
      personId: row.person_id,
      lesson: row.lesson,
      confirmedAt: row.confirmed_at,
      recordedBy: row.recorded_by,
      confirmedBy: row.confirmed_by,
    }));
  }

  /**
   * The conflict for a stale line (decision 0282): what this client meant, against what
   * is stored now — the current row, or, where the row it saw was withdrawn and nothing
   * replaced it, that withdrawal.
   */
  private async conflictFor(
    executor: Db | Transaction<Database>,
    actor: Actor,
    change: SuynlChange,
    stored: Map<string, Lesson>,
  ): Promise<ApiError> {
    const current = stored.get(keyOf(change.person_id, change.lesson)) ?? null;
    const person = await nameOfPerson(this.deps, executor, change.person_id);
    const submitted = {
      values: { person: person.name, lesson: change.lesson, done: change.done },
      recordedAt: new Date().toISOString(),
      actor: await nameOfPerson(this.deps, executor, actor.personId),
    };

    if (current !== null) {
      const by = await nameOfAccount(this.deps, executor, current.recordedBy);

      return new GrowthConflictError({
        message: `${person.name} · lesson ${change.lesson} was changed by ${by.name} after this page loaded. Reload to see it, then decide again.`,
        submittedRow: change.seen_id ?? null,
        currentRow: current.id,
        submitted,
        current: {
          values: { person: person.name, lesson: change.lesson, done: true },
          recordedAt: current.confirmedAt.toISOString(),
          actor: by,
        },
      });
    }

    const seen =
      change.seen_id === undefined || change.seen_id === null
        ? undefined
        : await executor
            .selectFrom('suynl_lessons')
            .select(['person_id', 'lesson', 'superseded_at', 'corrected_by'])
            .where('id', '=', change.seen_id)
            .executeTakeFirst();

    if (
      seen === undefined ||
      canonicalId(seen.person_id) !== canonicalId(change.person_id) ||
      seen.lesson !== change.lesson ||
      seen.superseded_at === null ||
      seen.corrected_by === null
    ) {
      return new InvariantViolationError(
        'seen_id does not name a lesson this person held. Reload and try again.',
        { person_id: change.person_id, lesson: change.lesson, seen_id: change.seen_id ?? null },
      );
    }

    const by = await nameOfAccount(this.deps, executor, seen.corrected_by);

    return new GrowthConflictError({
      message: `${person.name} · lesson ${change.lesson} was withdrawn by ${by.name} after this page loaded. Reload to see it, then decide again.`,
      submittedRow: change.seen_id ?? null,
      currentRow: null,
      submitted,
      current: {
        values: { person: person.name, lesson: change.lesson, done: false },
        recordedAt: seen.superseded_at.toISOString(),
        actor: by,
      },
    });
  }
}

/**
 * What one change does against what is stored (decision 0282). A line that already
 * agrees writes nothing and conflicts with nothing; otherwise the row it was made
 * against must still be the current one.
 */
function outcomeOf(change: SuynlChange, stored: Map<string, Lesson>): Outcome {
  const current = stored.get(keyOf(change.person_id, change.lesson)) ?? null;

  if (change.done === (current !== null)) {
    return 'UNCHANGED';
  }

  const seen = change.seen_id ?? null;
  if (
    (seen === null ? null : canonicalId(seen)) !==
    (current === null ? null : canonicalId(current.id))
  ) {
    return 'STALE';
  }

  return change.done ? 'CREATE' : 'RETRACT';
}

/** Refusals that need nothing stored to decide, made before anything is read. */
function assertWellFormed(changes: readonly SuynlChange[]): void {
  const seen = new Set<string>();

  for (const change of changes) {
    const key = keyOf(change.person_id, change.lesson);

    if (seen.has(key)) {
      throw new InvariantViolationError(
        'This save names the same lesson for the same person twice. Send one change per lesson.',
        { person_id: change.person_id, lesson: change.lesson },
      );
    }
    seen.add(key);

    if (!change.done && (change.reason === undefined || change.reason === null)) {
      throw new ValidationFailedError('Say why this lesson is being withdrawn.', {
        field: 'reason',
        person_id: change.person_id,
        lesson: change.lesson,
      });
    }

    if (!change.done && (change.seen_id === undefined || change.seen_id === null)) {
      throw new ValidationFailedError('A withdrawal names the lesson row it withdraws.', {
        field: 'seen_id',
        person_id: change.person_id,
        lesson: change.lesson,
      });
    }

    if (change.done && change.reason !== undefined && change.reason !== null) {
      throw new ValidationFailedError('A tick needs no reason. Remove it.', {
        field: 'reason',
        person_id: change.person_id,
        lesson: change.lesson,
      });
    }
  }
}

function narrowingFor(
  step: SuynlStep | undefined,
  progress: Map<string, { count: number }>,
): { include?: ReadonlySet<string>; exclude?: ReadonlySet<string> } {
  switch (step) {
    case 'NOT_STARTED':
      return { exclude: new Set(progress.keys()) };
    case 'IN_PROGRESS':
      return { include: idsWhere(progress, (count) => count < 10) };
    case 'GRADUATED':
      return { include: idsWhere(progress, (count) => count === 10) };
    case 'STILL_TO_FINISH':
      return { exclude: idsWhere(progress, (count) => count === 10) };
    default:
      return {};
  }
}

function idsWhere(
  progress: Map<string, { count: number }>,
  test: (count: number) => boolean,
): ReadonlySet<string> {
  return new Set([...progress].filter(([, entry]) => test(entry.count)).map(([id]) => id));
}

/** Whether the actor is withdrawing somebody else's statement (section 14). */
function onBehalfOf(confirmedBy: string | null, actorPersonId: string): boolean {
  return confirmedBy !== null && canonicalId(confirmedBy) !== canonicalId(actorPersonId);
}

function keyOf(personId: string, lesson: number): string {
  return `${canonicalId(personId)}|${lesson}`;
}

function keyed(lessons: readonly Lesson[]): Map<string, Lesson> {
  return new Map(lessons.map((lesson) => [keyOf(lesson.personId, lesson.lesson), lesson]));
}

function unique(ids: readonly string[]): string[] {
  return [...new Map(ids.map((id) => [canonicalId(id), id])).values()];
}

function latest(lessons: readonly Lesson[]): Date {
  return lessons.reduce(
    (max, lesson) => (lesson.confirmedAt > max ? lesson.confirmedAt : max),
    lessons[0].confirmedAt,
  );
}
