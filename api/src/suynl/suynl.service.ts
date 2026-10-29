import { Inject, Injectable } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';

import { AuditService } from '../audit/audit.service';
import { AccountsRepository } from '../auth/accounts.repository';
import { AuthorizationService, type Actor } from '../auth/authorization/authorization.service';
import { Capability } from '../auth/authorization/capabilities';
import {
  ApiError,
  InvariantViolationError,
  ValidationFailedError,
} from '../common/errors/api-error';
import { GrowthConflictError, nameOfAccount, nameOfPerson } from '../common/growth/growth-conflict';
import { mayFileEach, submitterLookup, type Filing } from '../common/growth/growth-filing';
import {
  answerLostRace,
  filingsFor,
  onBehalfOf,
  seenIsCurrent,
  uniqueIds,
} from '../common/growth/growth-submit';
import {
  beyondDirectDisciplesCount,
  growthPage,
  growthPopulation,
} from '../common/growth/growth-list';
import { mergedCte, resolverOf } from '../common/merged-identity';
import { canonicalId } from '../common/identifiers';
import { IdempotencyService } from '../common/idempotency/idempotency.service';
import { compareRosterKeys } from '../common/roster-cursor';
import { manilaDayOf } from '../common/time/manila';
import { databaseNow } from '../common/time/submission-window';
import { DATABASE, type Db } from '../database/database.module';
import { HierarchyService } from '../hierarchy/hierarchy.service';
import { PeopleReadService } from '../people/people.read.service';
import { composeName } from '../people/people.shared';
import { TrainingService } from '../training/training.service';

import type { CurrentClaim } from '../common/idempotency/current-idempotency.decorator';
import type { Database, NetworkName } from '../database/schema';
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
    private readonly training: TrainingService,
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
   * (decision 0281), as things stand now, and how many of them are other than the actor and
   * the actor's direct disciples (decision 0384), which is not a card.
   */
  async counts(actor: Actor): Promise<Record<string, unknown>> {
    const now = await databaseNow(this.db);
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
      beyond_direct_disciples: await beyondDirectDisciplesCount(
        this.deps,
        this.db,
        actor,
        population,
        people,
        now,
      ),
    };
  }

  /** `GET /api/v1/suynl/people`: the tab's list, one page (section 28). */
  async list(actor: Actor, query: SuynlListDto): Promise<Record<string, unknown>> {
    const now = await databaseNow(this.db);
    const population = await growthPopulation(this.deps, actor, Capability.SuynlViewSubtree);
    // Only a step filter reads the scope's progress, so a list asked for no step, as a
    // person's page asks, skips it (checklist row perf-person-page).
    const progress =
      query.step === undefined
        ? new Map<string, { count: number }>()
        : await this.currentProgress(population);

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
    // A record kept shows the lessons of every record merged into it (decision 0407).
    const lessons = await this.lessonsOfKept(ids);
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
      // SUYNL follows DCC: whoever records a person's DCC files their lessons (decision 0322).
      submitterLookup(this.deps, this.db, now),
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
   * `GET /api/v1/suynl/readiness` and `/readiness/{id}`: who is getting ready for the LC
   * Party, row by row (decision 0297), as things stand now.
   *
   * **A person is counted** when they are current, hold at least one current lesson, and
   * hold no current Encounter or Life Class graduation; then by lessons, ten, seven to
   * nine, or one to six. **Rows are the subject's direct disciples**, each counting their
   * branch now, themselves included; the subject's own row is the subject alone. A
   * whole-church reader asking for nobody gets the two roots' branches instead, and a
   * line for anybody counted in neither. The rows, that row and that line are disjoint, so
   * they add up to the total, which is everyone the reader's grant reaches in them.
   *
   * **`names: false` leaves each row's people out** (checklist row perf-suynl-readiness): a
   * whole-church table carries every counted name in the church, and the screen asks for a
   * row's people only when its name is opened, from the same route for that leader, with
   * **`totalNames`**, which lists the total's people as one list in first-name order.
   */
  async readiness(
    actor: Actor,
    subjectId: string | null,
    options: { names: boolean; totalNames?: boolean } = { names: true },
  ): Promise<Record<string, unknown>> {
    const now = await databaseNow(this.db);
    const population = await growthPopulation(this.deps, actor, Capability.SuynlViewSubtree);
    const churchWide = subjectId === null && population === null;

    const rows: { leaderId: string; network: NetworkName | null; members: string[] }[] = [];
    let own: string[] | null = null;

    if (churchWide) {
      for (const seat of await this.hierarchy.rootSeatsAsOf(this.db, now)) {
        rows.push({
          leaderId: seat.personId,
          network: seat.network,
          members: branchesOf(seat.personId, await this.hierarchy.subtreeEdgesOf(seat.personId))
            .all,
        });
      }
    } else {
      const subject = subjectId ?? actor.personId;
      const branches = branchesOf(subject, await this.hierarchy.subtreeEdgesOf(subject));
      for (const [childId, members] of branches.byChild) {
        rows.push({ leaderId: childId, network: null, members });
      }
      own = [subject];
    }

    const reached = (ids: readonly string[]) =>
      ids.filter((id) => population === null || population.has(canonicalId(id)));
    const everyone = uniqueIds([...rows.flatMap((row) => row.members), ...(own ?? [])]);

    // The whole church is never enumerated, so its progress is read unrestricted.
    const progress = await this.currentProgress(churchWide ? null : new Set(reached(everyone)));
    const past = await this.training.pastTheLcPartyOf([...progress.keys()]);
    const counted = new Map([...progress].filter(([id]) => !past.has(id)));

    const inRows = new Set(everyone.map(canonicalId));
    const elsewhere = churchWide ? [...counted.keys()].filter((id) => !inRows.has(id)) : null;

    const identities = await this.people.forDecisions(
      uniqueIds([...rows.map((row) => row.leaderId), ...(own ?? []), ...counted.keys()]),
    );

    const figures = (ids: readonly string[], names = options.names) => {
      const people = uniqueIds(reached(ids))
        .flatMap((id) => {
          const entry = counted.get(canonicalId(id));
          const identity = identities.get(id) ?? identities.get(canonicalId(id));
          return entry === undefined || identity === undefined
            ? []
            : [{ identity, lessons: entry.count }];
        })
        .sort((left, right) => compareRosterKeys(left.identity, right.identity));

      return {
        completed: people.filter((person) => person.lessons >= 10).length,
        seven_to_nine: people.filter((person) => person.lessons >= 7 && person.lessons < 10).length,
        one_to_six: people.filter((person) => person.lessons < 7).length,
        people: people.length,
        ...(names
          ? {
              members: people.map((person) => ({
                person_id: person.identity.id,
                full_name: person.identity.fullName,
                lessons: person.lessons,
              })),
            }
          : {}),
      };
    };

    const leadAnyone = await this.hierarchy.whichLeadAnyone(rows.map((row) => row.leaderId));
    const leading = new Set([...leadAnyone].map(canonicalId));

    const all = figures(
      [...rows.flatMap((row) => row.members), ...(own ?? []), ...(elsewhere ?? [])],
      options.totalNames === true,
    );

    const subject = own === null ? undefined : identities.get(own[0]);

    return {
      subject: subject === undefined ? null : { id: subject.id, full_name: subject.fullName },
      rows: rows
        .map((row) => ({
          row,
          identity: identities.get(row.leaderId) ?? identities.get(canonicalId(row.leaderId)),
        }))
        // A whole-church reader's rows are in Network order, a leader's in first-name order,
        // and never by a figure (sections 13 and 17, decision 0293).
        .sort((left, right) =>
          left.row.network !== null && right.row.network !== null
            ? left.row.network.localeCompare(right.row.network)
            : left.identity === undefined || right.identity === undefined
              ? Number(left.identity === undefined) - Number(right.identity === undefined)
              : compareRosterKeys(left.identity, right.identity),
        )
        .map(({ row, identity }) => ({
          leader:
            identity === undefined
              ? null
              : { id: row.leaderId, member_id: identity.memberId, full_name: identity.fullName },
          network: row.network,
          leads_anyone: leading.has(canonicalId(row.leaderId)),
          ...figures(row.members),
        })),
      own: own === null ? null : figures(own),
      elsewhere: elsewhere === null ? null : figures(elsewhere),
      total: {
        completed: all.completed,
        seven_to_nine: all.seven_to_nine,
        one_to_six: all.one_to_six,
        people: all.people,
        ...(all.members === undefined ? {} : { members: all.members }),
      },
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
        const personIds = uniqueIds(changes.map((change) => change.person_id));
        const identities = await this.people.forDecisionsWithin(trx, personIds);
        const assignments = await this.hierarchy.assignmentsAsOf(trx, personIds, now);
        const filings = await filingsFor(
          this.deps,
          trx,
          actor,
          authority,
          CAPABILITIES,
          personIds,
          identities,
          assignments,
          submitterLookup(this.deps, trx, now),
        );

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
      // A lost race on a first tick.
      return answerLostRace(
        error,
        ONE_CURRENT_INDEX,
        changes,
        async () =>
          keyed(await this.currentLessons(this.db, uniqueIds(changes.map((c) => c.person_id)))),
        (change, stored) => outcomeOf(change, stored) === 'STALE',
        (change, stored) => this.conflictFor(this.db, actor, change, stored),
        'Somebody else recorded these lessons while yours was being saved. Retry shortly, ' +
          'with the same key.',
      );
    }
  }

  /**
   * When each of these people's third current lesson was filed, for Win 3 (SKILL.md
   * section 27; decision 0284). A lesson corrected away never counted (section 28), so
   * only current rows are read; somebody with fewer than three is absent. `null` is
   * everyone, which a church-wide caller asks for rather than sending every disciple's id:
   * a list that long costs more to send than the query costs to run (perf-conquest).
   */
  async thirdLessonInstantsOf(personIds: readonly string[] | null): Promise<Map<string, Date>> {
    if (personIds !== null && personIds.length === 0) {
      return new Map();
    }

    // The third is picked in the database, and the people go as one array parameter. A merged
    // pair is one person (decision 0407): each lesson resolves to the record kept, and a lesson
    // on both records counts once, on the earlier date.
    const pairs = await this.people.mergedPairsWithin(this.db);
    const result = await sql<{ person_id: string; confirmed_at: Date }>`
      WITH ${mergedCte(pairs)},
      lessons AS (
        SELECT coalesce(m.kept_id, l.person_id) AS person_id, l.lesson,
               min(l.confirmed_at) AS confirmed_at
          FROM suynl_lessons l
          LEFT JOIN merged m ON m.absorbed_id = l.person_id
         WHERE l.superseded_at IS NULL
         GROUP BY coalesce(m.kept_id, l.person_id), l.lesson
      )
      SELECT person_id, confirmed_at
      FROM (
        SELECT person_id, confirmed_at,
          row_number() OVER (PARTITION BY person_id ORDER BY confirmed_at) AS position
        FROM lessons
        WHERE true
          ${personIds === null ? sql`` : sql`AND person_id = ANY(${[...personIds]}::uuid[])`}
      ) ordered
      WHERE position = 3
    `.execute(this.db);

    return new Map(result.rows.map((row) => [row.person_id, row.confirmed_at]));
  }

  /** Each current person with at least one current lesson, and how many they hold. */
  private async currentProgress(
    population: ReadonlySet<string> | null,
  ): Promise<Map<string, { count: number }>> {
    if (population !== null && population.size === 0) {
      return new Map();
    }

    // A merged pair is one person (decision 0407): each record's lessons count for the record
    // kept, and a lesson on both counts once, so lessons are counted as distinct numbers.
    const pairs = await this.people.mergedPairsWithin(this.db);
    const resolve = resolverOf(pairs);
    const reach =
      population === null
        ? null
        : [
            ...population,
            ...pairs.absorbed.filter((_, index) => population.has(canonicalId(pairs.kept[index]))),
          ];

    const rows = await this.db
      .selectFrom('suynl_lessons')
      .select(['person_id', 'lesson'])
      .where('superseded_at', 'is', null)
      .$if(reach !== null, (qb) => qb.where('person_id', 'in', reach ?? []))
      .execute();

    const lessonsOf = new Map<string, Set<number>>();
    for (const row of rows) {
      const kept = canonicalId(resolve(row.person_id));
      lessonsOf.set(kept, (lessonsOf.get(kept) ?? new Set()).add(row.lesson));
    }

    // Current people only (decision 0279): a lesson row outlives an archival, and a merged
    // record's lessons are counted for the record kept above rather than dropped.
    const identities = await this.people.forDecisions([...lessonsOf.keys()]);
    const progress = new Map<string, { count: number }>();

    for (const [personId, lessons] of lessonsOf) {
      const identity = identities.get(personId);
      if (identity !== undefined && !identity.isArchived && identity.mergedIntoId === null) {
        progress.set(personId, { count: lessons.size });
      }
    }

    return progress;
  }

  /**
   * The current lessons shown for these records kept, with every record merged into each
   * (decision 0407): a lesson held on both is shown once, on the earlier date. For reading
   * only; a save reads `currentLessons`, which names the record written.
   */
  private async lessonsOfKept(ids: readonly string[]): Promise<Lesson[]> {
    const pairs = await this.people.mergedPairsWithin(this.db);
    const wanted = new Set(ids.map((id) => canonicalId(id)));
    const absorbed = pairs.absorbed.filter((_, index) =>
      wanted.has(canonicalId(pairs.kept[index])),
    );
    const resolve = resolverOf(pairs);
    const earliest = new Map<string, Lesson>();

    for (const lesson of await this.currentLessons(this.db, [...ids, ...absorbed])) {
      const personId = canonicalId(resolve(lesson.personId));
      const key = `${personId}#${lesson.lesson}`;
      const seen = earliest.get(key);
      if (seen === undefined || lesson.confirmedAt < seen.confirmedAt) {
        earliest.set(key, { ...lesson, personId });
      }
    }

    return [...earliest.values()];
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

  if (!seenIsCurrent(change.seen_id, current === null ? null : current.id)) {
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

function keyOf(personId: string, lesson: number): string {
  return `${canonicalId(personId)}|${lesson}`;
}

function keyed(lessons: readonly Lesson[]): Map<string, Lesson> {
  return new Map(lessons.map((lesson) => [keyOf(lesson.personId, lesson.lesson), lesson]));
}

/** A branch as it stands now: everyone in it, and each direct disciple's own, themselves included. */
function branchesOf(
  rootId: string,
  edges: readonly { personId: string; leaderId: string }[],
): { all: string[]; byChild: Map<string, string[]> } {
  const childrenOf = new Map<string, string[]>();
  for (const edge of edges) {
    const key = canonicalId(edge.leaderId);
    childrenOf.set(key, [...(childrenOf.get(key) ?? []), edge.personId]);
  }

  const collect = (id: string): string[] => {
    const out: string[] = [];
    const stack = [id];
    while (stack.length > 0) {
      const next = stack.pop() as string;
      out.push(next);
      stack.push(...(childrenOf.get(canonicalId(next)) ?? []));
    }
    return out;
  };

  return {
    all: collect(rootId),
    byChild: new Map(
      (childrenOf.get(canonicalId(rootId)) ?? []).map((childId) => [childId, collect(childId)]),
    ),
  };
}

function latest(lessons: readonly Lesson[]): Date {
  return lessons.reduce(
    (max, lesson) => (lesson.confirmedAt > max ? lesson.confirmedAt : max),
    lessons[0].confirmedAt,
  );
}
