import { Inject, Injectable, Optional } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';

import { AuditService } from '../audit/audit.service';
import { AccountsRepository } from '../auth/accounts.repository';
import {
  AuthorizationService,
  holdsWholeChurch,
  type Actor,
} from '../auth/authorization/authorization.service';
import { Capability } from '../auth/authorization/capabilities';
import {
  ApiError,
  InvariantViolationError,
  ScopeDeniedError,
  ValidationFailedError,
} from '../common/errors/api-error';
import { GrowthConflictError, nameOfAccount, nameOfPerson } from '../common/growth/growth-conflict';
import { mayFileEach, type Filing } from '../common/growth/growth-filing';
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
  listPopulation,
} from '../common/growth/growth-list';
import { resolverOf } from '../common/merged-identity';
import { canonicalId } from '../common/identifiers';
import { IdempotencyService } from '../common/idempotency/idempotency.service';
import { manilaDayOf } from '../common/time/manila';
import { databaseNow } from '../common/time/submission-window';
import { DATABASE, type Db } from '../database/database.module';
import { HierarchyService } from '../hierarchy/hierarchy.service';
import { PeopleReadService } from '../people/people.read.service';
import { composeName } from '../people/people.shared';

import { TRAINING_PROGRAMS, type TrainingListDto, type TrainingStep } from './dto/training.dto';
import { SCHOOL_EVIDENCE_PORT, type SchoolEvidencePort } from './school-evidence.port';

import type { CurrentClaim } from '../common/idempotency/current-idempotency.decorator';
import type { Database, TrainingProgram } from '../database/schema';

/** One change as the DTO delivers it. */
export interface TrainingChange {
  person_id: string;
  program: TrainingProgram;
  graduated: boolean;
  graduated_on?: string | null;
  seen_id?: string | null;
  reason?: string;
}

/** A current graduation row. */
interface Graduation {
  id: string;
  /** The person shown: the record kept, where the row is on a record merged into it. */
  personId: string;
  /** The record the row is on, which differs from `personId` for a duplicate's (decision 0408). */
  recordId: string;
  program: TrainingProgram;
  graduatedOn: string | null;
  confirmedAt: Date;
  recordedBy: string;
  /** Whose statement the row is, which a correction is attributed to (section 28). */
  confirmedBy: string | null;
  /** Filed by the school rather than ticked (decision 0509). */
  fromSchool: boolean;
}

type Outcome = 'UNCHANGED' | 'CREATE' | 'REPLACE' | 'RETRACT' | 'STALE';

const CAPABILITIES = {
  confirm: Capability.TrainingConfirm,
  onBehalf: Capability.TrainingConfirmOnBehalf,
};

/** The two the school files (decision 0509): only the Admin ticks either. */
const SCHOOL_PROGRAMS: ReadonlySet<TrainingProgram> = new Set(['ENCOUNTER', 'LIFE_CLASS']);

const LABELS: Record<TrainingProgram, string> = {
  ENCOUNTER: 'the Encounter',
  LIFE_CLASS: 'Life Class',
  SOL_1: 'SOL 1',
  SOL_2: 'SOL 2',
  SOL_3: 'SOL 3',
};

/** Section 28's one-current-row index, whose violation is a lost race and nothing else. */
const ONE_CURRENT_INDEX = 'training_graduations_one_current_per_program';

/**
 * Training graduations (SKILL.md section 28): the tab's counts, its list and its save.
 *
 * The same shape as `SuynlService`, with a stated date: a graduation carries the day
 * the leader states where they know it, and changing that day is a correction.
 */
@Injectable()
export class TrainingService {
  constructor(
    @Inject(DATABASE) private readonly db: Db,
    private readonly hierarchy: HierarchyService,
    private readonly people: PeopleReadService,
    private readonly accounts: AccountsRepository,
    private readonly authorization: AuthorizationService,
    private readonly audit: AuditService,
    private readonly idempotency: IdempotencyService,
    /** Optional and refusing (ruling of 2026-09-01); bound in `SchoolEvidenceBindingModule`. */
    @Optional()
    @Inject(SCHOOL_EVIDENCE_PORT)
    private readonly schoolEvidence?: SchoolEvidencePort,
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
   * `GET /api/v1/training/counts`: a card per school and one for people with none yet
   * (decision 0281), as things stand now. The school cards overlap. `beyond_direct_disciples`
   * is not a card: how many listed are other than the actor and the actor's direct
   * disciples (decision 0384).
   */
  async counts(actor: Actor): Promise<Record<string, unknown>> {
    const now = await databaseNow(this.db);
    const { people: population } = await growthPopulation(
      this.deps,
      actor,
      Capability.TrainingViewSubtree,
    );
    const held = await this.currentPrograms(population);
    const people = await this.people.countCurrent(population);

    const perProgram = Object.fromEntries(
      TRAINING_PROGRAMS.map((program) => [
        program.toLowerCase(),
        [...held.values()].filter((programs) => programs.has(program)).length,
      ]),
    );

    // `all_five` is not a card: it is how many the list's opening view leaves out (decision 0287).
    return {
      people,
      not_started: people - held.size,
      ...perProgram,
      all_five: allFive(held).size,
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

  /** `GET /api/v1/training/people`: the tab's list, one page (section 28). */
  async list(actor: Actor, query: TrainingListDto): Promise<Record<string, unknown>> {
    const now = await databaseNow(this.db);
    const population = listPopulation(
      await growthPopulation(this.deps, actor, Capability.TrainingViewSubtree),
      query,
    );
    // Only a step filter reads the scope's graduations, so a list asked for no step, as a
    // person's page asks, skips it (checklist row perf-person-page).
    const held =
      query.step === undefined
        ? new Map<string, Set<TrainingProgram>>()
        : await this.currentPrograms(population);

    const { rows, nextCursor } = await growthPage(
      this.deps,
      this.db,
      actor,
      population,
      query,
      narrowingFor(query.step, held),
      now,
    );

    const ids = rows.map((row) => row.id);
    // A record kept shows the graduations of every record merged into it (decision 0408).
    const graduations = await this.graduationsOfKept(ids);
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
      data: rows.map((row) => ({
        person_id: row.id,
        member_id: row.member_id,
        full_name: composeName(row),
        graduations: graduations
          .filter((graduation) => canonicalId(graduation.personId) === canonicalId(row.id))
          .sort(
            (left, right) =>
              TRAINING_PROGRAMS.indexOf(left.program) - TRAINING_PROGRAMS.indexOf(right.program),
          )
          .map((graduation) => ({
            id: graduation.id,
            program: graduation.program,
            graduated_on: graduation.graduatedOn,
            from_school: graduation.fromSchool,
            school_held: graduation.schoolHeld,
          })),
        may_file: mayFile.has(row.id),
      })),
      // **Only the Admin ticks the Encounter and Life Class** (owner, 2026-11-22, decision 0509):
      // the school files them, and a tick is for somebody who finished before it.
      school_may_tick: holdsWholeChurch(authority, CAPABILITIES.confirm),
      next_cursor: nextCursor,
    };
  }

  /**
   * `POST /api/v1/training/submit` (sections 14, 22 and 28; decisions 0279, 0280, 0282).
   *
   * All or nothing, as `SuynlService.submit` is and for its reasons.
   */
  async submit(
    actor: Actor,
    changes: readonly TrainingChange[],
    claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    assertWellFormed(changes);

    const authority = await this.authorization.authorityFor(actor.accountId);

    try {
      return await this.db.transaction().execute(async (trx) => {
        const now = await databaseNow(trx);
        const today = manilaDayOf(now);

        for (const change of changes) {
          if (change.graduated_on != null && change.graduated_on > today) {
            throw new ValidationFailedError('A graduation date cannot be in the future.', {
              field: 'graduated_on',
              person_id: change.person_id,
              program: change.program,
            });
          }
        }

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
        );

        // Across every record of each person, so a graduation shown from a duplicate can be
        // withdrawn or corrected (decision 0408, point 20).
        const { shown: stored, all: everyRecord } = await this.storedOfKept(trx, personIds, {
          lock: true,
        });
        const outcomes = changes.map((change) => outcomeOf(change, stored));

        // **Only the Admin ticks the Encounter and Life Class** (decision 0509), refused before the
        // stale check: a line nobody else may make is never answered "reload and decide again".
        if (!holdsWholeChurch(authority, CAPABILITIES.confirm)) {
          const school = changes.find(
            (change, index) =>
              SCHOOL_PROGRAMS.has(change.program) && outcomes[index] !== 'UNCHANGED',
          );
          if (school !== undefined) {
            throw new ScopeDeniedError(
              `${LABELS[school.program]} is recorded by the school; only the Admin ticks it for somebody who finished before the school.`,
              { person_id: school.person_id, program: school.program },
            );
          }
        }

        const staleAt = outcomes.indexOf('STALE');
        if (staleAt !== -1) {
          throw await this.conflictFor(trx, actor, changes[staleAt], stored);
        }
        // **Nobody changes the school's** (decision 0509), the Admin included. After the stale
        // check, so the Admin's line made against an older page gets 0282's conflict.
        for (const [index, change] of changes.entries()) {
          if (!SCHOOL_PROGRAMS.has(change.program) || outcomes[index] === 'UNCHANGED') {
            continue;
          }
          // On any record of the person (decision 0408): a correction withdraws them all.
          if (
            (everyRecord.get(keyOf(change.person_id, change.program)) ?? []).some(
              (g) => g.fromSchool,
            )
          ) {
            throw new InvariantViolationError(
              `${LABELS[change.program]} was recorded by the school, and is changed there.`,
              { person_id: change.person_id, program: change.program },
            );
          }
        }

        let created = 0;
        let corrected = 0;

        for (const [index, change] of changes.entries()) {
          const outcome = outcomes[index];
          if (outcome === 'UNCHANGED' || outcome === 'STALE') {
            continue;
          }

          const filing = filings.get(canonicalId(change.person_id)) as Filing;
          const row = stored.get(keyOf(change.person_id, change.program)) ?? null;
          // The row shown and any other record's of the same program (decision 0408, point 20).
          const rows = everyRecord.get(keyOf(change.person_id, change.program)) ?? [];

          for (const withdrawn of rows) {
            await trx
              .updateTable('training_graduations')
              .set({
                superseded_at: sql<Date>`now()`,
                corrected_by: actor.accountId,
                correction_reason: change.reason ?? null,
              })
              .where('id', '=', withdrawn.id)
              .execute();
          }

          if (outcome === 'CREATE' || outcome === 'REPLACE') {
            await trx
              .insertInto('training_graduations')
              .values({
                person_id: change.person_id,
                program: change.program,
                graduated_on: change.graduated_on ?? null,
                confirmed_by: filing.confirmedBy,
                recorded_by: actor.accountId,
              })
              .execute();
          }

          if (outcome === 'CREATE') {
            await this.audit.writeWithin(trx, {
              actorId: actor.accountId,
              action: 'training_graduation.confirmed',
              targetType: 'person',
              targetId: change.person_id,
              after: {
                program: change.program,
                graduated_on: change.graduated_on ?? null,
                confirmed_by: filing.confirmedBy,
                on_behalf: filing.onBehalf,
              },
            });
            created += 1;
          } else {
            // One entry per row withdrawn, against the record it was on; the row shown carries
            // the replacement where there is one.
            for (const withdrawn of rows) {
              const replaced = outcome === 'REPLACE' && withdrawn.id === row?.id;
              await this.audit.writeWithin(trx, {
                actorId: actor.accountId,
                action: 'training_graduation.corrected',
                targetType: 'person',
                targetId: withdrawn.recordId,
                before: {
                  program: change.program,
                  graduated_on: withdrawn.graduatedOn,
                  confirmed_by: withdrawn.confirmedBy,
                },
                after: replaced
                  ? {
                      program: change.program,
                      graduated_on: change.graduated_on ?? null,
                      confirmed_by: filing.confirmedBy,
                      on_behalf: filing.onBehalf,
                    }
                  : {
                      program: change.program,
                      withdrawn: true,
                      confirmed_by: withdrawn.confirmedBy,
                      on_behalf: onBehalfOf(withdrawn.confirmedBy, actor.personId),
                    },
                reason: change.reason ?? null,
              });
            }
            corrected += 1;
          }

          // **The school's takes the place of a tick the Admin withdraws** (decision 0509,
          // point 8): one whose school records show them passed is filed from the school, from
          // those records as they stand now.
          if (outcome === 'RETRACT' && SCHOOL_PROGRAMS.has(change.program)) {
            await this.fileWhatTheSchoolHoldsWithin(trx, change.person_id, change.program, actor);
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
      // A lost race on a first graduation.
      return answerLostRace(
        error,
        ONE_CURRENT_INDEX,
        changes,
        async () =>
          (await this.storedOfKept(this.db, uniqueIds(changes.map((c) => c.person_id)))).shown,
        (change, stored) => outcomeOf(change, stored) === 'STALE',
        (change, stored) => this.conflictFor(this.db, actor, change, stored),
        'Somebody else recorded these graduations while yours was being saved. Retry shortly, ' +
          'with the same key.',
      );
    }
  }

  /**
   * **Files a graduation from the school** (decision 0509): a posted *Passed* files Life Class,
   * the Encounter attended files the Encounter. Inside the school's own transaction. A person
   * who already holds a current graduation of the program keeps it, the school's being added
   * only where there is none. Answers whether it filed.
   */
  async fileFromSchoolWithin(
    trx: Transaction<Database>,
    input: { personId: string; program: TrainingProgram; graduatedOn: string; accountId: string },
  ): Promise<boolean> {
    // Growth records only current people (decision 0279).
    const identity = (await this.people.forDecisionsWithin(trx, [input.personId])).get(
      input.personId,
    );
    if (identity === undefined || identity.isArchived || identity.mergedIntoId !== null) {
      return false;
    }
    // Held on this record or on one merged into it (decision 0408): kept as it is.
    const { shown } = await this.storedOfKept(trx, [input.personId], { lock: true });
    if (shown.has(keyOf(input.personId, input.program))) {
      return false;
    }
    // A tick landing at the same moment holds the one current row; the school's then files
    // nothing rather than failing the posting or the Encounter save.
    const filed = await trx
      .insertInto('training_graduations')
      .values({
        person_id: input.personId,
        program: input.program,
        graduated_on: input.graduatedOn,
        confirmed_by: null,
        recorded_by: input.accountId,
        from_school: true,
      })
      .onConflict((oc) =>
        oc.columns(['person_id', 'program']).where('superseded_at', 'is', null).doNothing(),
      )
      .returning('id')
      .executeTakeFirst();
    if (filed === undefined) {
      return false;
    }
    await this.audit.writeWithin(trx, {
      actorId: input.accountId,
      action: 'training_graduation.confirmed',
      targetType: 'person',
      targetId: input.personId,
      after: { program: input.program, graduated_on: input.graduatedOn, from_school: true },
    });
    return true;
  }

  /**
   * Files the graduation the school's own records support, where there is one (decision 0509,
   * point 8): the earliest of what it holds for the person and every record merged into them,
   * dated as the school dates it.
   */
  private async fileWhatTheSchoolHoldsWithin(
    trx: Transaction<Database>,
    personId: string,
    program: TrainingProgram,
    actor: Actor,
  ): Promise<void> {
    if (this.schoolEvidence === undefined) {
      throw new InvariantViolationError(
        'This deployment cannot withdraw a tick of the Encounter or Life Class: a port it needs is not bound.',
        {},
      );
    }
    const pairs = await this.people.mergedPairsWithin(trx);
    const records = [
      personId,
      ...pairs.absorbed.filter(
        (_, index) => canonicalId(pairs.kept[index]) === canonicalId(personId),
      ),
    ];
    const evidence = await this.schoolEvidence.evidenceWithin(
      trx,
      records,
      program as 'ENCOUNTER' | 'LIFE_CLASS',
    );
    const seasonIds = uniqueIds(
      evidence.flatMap((each) => (each.kind === 'WEEKEND' ? [each.seasonId] : [])),
    );
    const seasons =
      seasonIds.length === 0
        ? []
        : await trx
            .selectFrom('encounter_seasons')
            .select(['id', 'mens_encounter_on', 'womens_encounter_on'])
            .where('id', 'in', seasonIds)
            .execute();
    const dates = evidence.map((each) => {
      if (each.kind === 'POSTED') {
        return manilaDayOf(each.postedAt);
      }
      const season = seasons.find((row) => canonicalId(row.id) === canonicalId(each.seasonId));
      if (season === undefined) {
        return null;
      }
      return String(
        each.network === 'MENS' ? season.mens_encounter_on : season.womens_encounter_on,
      );
    });
    const earliest = dates
      .filter((date): date is string => date !== null)
      .sort()
      .at(0);
    if (earliest === undefined) {
      return;
    }
    await this.fileFromSchoolWithin(trx, {
      personId,
      program,
      graduatedOn: earliest,
      accountId: actor.accountId,
    });
  }

  /**
   * **Withdraws a graduation the school filed** (decision 0509), when what it rested on is
   * corrected: the Encounter's when who came is corrected to not attended. A tick from before
   * the school is left alone. Answers whether it withdrew one.
   */
  async withdrawFromSchoolWithin(
    trx: Transaction<Database>,
    input: {
      personId: string;
      program: TrainingProgram;
      /** Only the row this date filed: another weekend's is not this correction's. */
      graduatedOn: string;
      accountId: string;
      reason: string;
    },
  ): Promise<boolean> {
    // **Every current row of the person and program first, merged records included**, so a
    // Training save withdrawing a tick from before the school (point 8), which holds that tick
    // and may be about to file the school's in its place, finishes before this decides. The
    // read below is then a new statement and sees what that save filed.
    await this.storedOfKept(trx, [input.personId], { lock: true });
    const row = await trx
      .selectFrom('training_graduations')
      .select(['id', 'graduated_on'])
      .where('person_id', '=', input.personId)
      .where('program', '=', input.program)
      .where('graduated_on', '=', input.graduatedOn)
      .where('superseded_at', 'is', null)
      .where('from_school', '=', true)
      .forUpdate()
      .executeTakeFirst();
    if (row === undefined) {
      return false;
    }
    await trx
      .updateTable('training_graduations')
      .set({
        superseded_at: sql<Date>`now()`,
        corrected_by: input.accountId,
        correction_reason: input.reason,
      })
      .where('id', '=', row.id)
      .execute();
    await this.audit.writeWithin(trx, {
      actorId: input.accountId,
      action: 'training_graduation.corrected',
      targetType: 'person',
      targetId: input.personId,
      before: {
        program: input.program,
        graduated_on: row.graduated_on === null ? null : String(row.graduated_on),
        from_school: true,
      },
      after: { program: input.program, withdrawn: true, from_school: true },
      reason: input.reason,
    });
    return true;
  }

  /**
   * Which of these people hold a current Encounter or Life Class graduation, for the SUYNL
   * readiness table, which leaves them out (decision 0297). Only current rows count
   * (section 28); lifecycle is the caller's, which reads it already.
   */
  async pastTheLcPartyOf(personIds: readonly string[]): Promise<Set<string>> {
    if (personIds.length === 0) {
      return new Set();
    }

    // A record kept holds what any record merged into it holds (decision 0408).
    const pairs = await this.people.mergedPairsWithin(this.db);
    const resolve = resolverOf(pairs);
    const wanted = new Set(personIds.map((id) => canonicalId(id)));
    const absorbed = pairs.absorbed.filter((_, index) =>
      wanted.has(canonicalId(pairs.kept[index])),
    );

    const rows = await this.db
      .selectFrom('training_graduations')
      .select('person_id')
      .distinct()
      .where('person_id', 'in', [...personIds, ...absorbed])
      .where('program', 'in', ['ENCOUNTER', 'LIFE_CLASS'])
      .where('superseded_at', 'is', null)
      .execute();

    return new Set(rows.map((row) => canonicalId(resolve(row.person_id))));
  }

  /**
   * Who holds a current graduation of any of these programs, for who may guide a level of the
   * school, a Guide being one level ahead (section 29, decision 0501). A pass from before the
   * school is such a row too. `null` asks of the whole church, for the Guide search.
   */
  async holdersOfAny(
    personIds: readonly string[] | null,
    programs: readonly TrainingProgram[],
  ): Promise<Set<string>> {
    if ((personIds !== null && personIds.length === 0) || programs.length === 0) {
      return new Set();
    }
    const pairs = await this.people.mergedPairsWithin(this.db);
    const resolve = resolverOf(pairs);
    let query = this.db
      .selectFrom('training_graduations')
      .select('person_id')
      .distinct()
      .where('program', 'in', [...programs])
      .where('superseded_at', 'is', null);
    if (personIds !== null) {
      const wanted = new Set(personIds.map((id) => canonicalId(id)));
      const absorbed = pairs.absorbed.filter((_, index) =>
        wanted.has(canonicalId(pairs.kept[index])),
      );
      query = query.where('person_id', 'in', [...personIds, ...absorbed]);
    }
    const rows = await query.execute();
    return new Set(rows.map((row) => canonicalId(resolve(row.person_id))));
  }

  /** The programs each current person holds a current graduation for. */
  private async currentPrograms(
    population: ReadonlySet<string> | null,
  ): Promise<Map<string, Set<TrainingProgram>>> {
    if (population !== null && population.size === 0) {
      return new Map();
    }

    // A merged pair is one person (decision 0408): each record's graduations count for the
    // record kept, and a program held on both is one program.
    const pairs = await this.people.mergedPairsWithin(this.db);
    const resolve = resolverOf(pairs);
    const reach =
      population === null
        ? null
        : [
            ...population,
            ...pairs.absorbed.filter((_, index) => population.has(canonicalId(pairs.kept[index]))),
          ];

    const rows = (
      await this.db
        .selectFrom('training_graduations')
        .select(['person_id', 'program'])
        .where('superseded_at', 'is', null)
        .$if(reach !== null, (qb) => qb.where('person_id', 'in', reach ?? []))
        .execute()
    ).map((row) => ({ ...row, person_id: canonicalId(resolve(row.person_id)) }));

    // Current people only (decision 0279).
    const identities = await this.people.forDecisions(uniqueIds(rows.map((row) => row.person_id)));
    const held = new Map<string, Set<TrainingProgram>>();

    for (const row of rows) {
      const identity = identities.get(row.person_id);
      if (identity === undefined || identity.isArchived || identity.mergedIntoId !== null) {
        continue;
      }

      const key = canonicalId(row.person_id);
      const programs = held.get(key) ?? new Set<TrainingProgram>();
      programs.add(row.program);
      held.set(key, programs);
    }

    return held;
  }

  /**
   * The current graduations shown for these records kept, with every record merged into each
   * (decision 0408): a program held on both is shown once, the earlier graduation date kept
   * (an unknown date counting as later), which is the row a save decides against.
   */
  private async graduationsOfKept(
    ids: readonly string[],
  ): Promise<(Graduation & { schoolHeld: boolean })[]> {
    const { shown, all } = await this.storedOfKept(this.db, ids);
    // A correction is refused while any record of the person holds the school's row (decision
    // 0509), so the screen offers none where only a merged record holds it.
    return [...shown.entries()].map(([key, graduation]) => ({
      ...graduation,
      schoolHeld: (all.get(key) ?? []).some((row) => row.fromSchool),
    }));
  }

  /**
   * What a save decides against, for these records kept (decision 0408, point 20): each
   * program as the screen showed it, and every record's row of it, which a correction withdraws
   * together. Locked where asked, records merged in included.
   */
  private async storedOfKept(
    executor: Db | Transaction<Database>,
    ids: readonly string[],
    options: { lock?: boolean } = {},
  ): Promise<{ shown: Map<string, Graduation>; all: Map<string, Graduation[]> }> {
    const pairs = await this.people.mergedPairsWithin(executor);
    const wanted = new Set(ids.map((id) => canonicalId(id)));
    const absorbed = pairs.absorbed.filter((_, index) =>
      wanted.has(canonicalId(pairs.kept[index])),
    );
    const resolve = resolverOf(pairs);
    const order = (graduation: Graduation) => graduation.graduatedOn ?? '9999-12-31';
    const shown = new Map<string, Graduation>();
    const all = new Map<string, Graduation[]>();

    for (const row of await this.currentGraduations(executor, [...ids, ...absorbed], options)) {
      const graduation = { ...row, personId: canonicalId(resolve(row.personId)) };
      const key = keyOf(graduation.personId, graduation.program);
      all.set(key, [...(all.get(key) ?? []), graduation]);
      const seen = shown.get(key);
      if (seen === undefined || order(graduation) < order(seen)) {
        shown.set(key, graduation);
      }
    }

    return { shown, all };
  }

  private async currentGraduations(
    executor: Db | Transaction<Database>,
    personIds: readonly string[],
    options: { lock?: boolean } = {},
  ): Promise<Graduation[]> {
    if (personIds.length === 0) {
      return [];
    }

    const rows = await executor
      .selectFrom('training_graduations')
      .select([
        'id',
        'person_id',
        'program',
        'graduated_on',
        'confirmed_at',
        'recorded_by',
        'confirmed_by',
        'from_school',
      ])
      .where('person_id', 'in', [...personIds])
      .where('superseded_at', 'is', null)
      .$if(options.lock === true, (qb) => qb.orderBy('person_id').orderBy('id').forUpdate())
      .execute();

    return rows.map((row) => ({
      id: row.id,
      personId: row.person_id,
      recordId: row.person_id,
      program: row.program,
      graduatedOn: row.graduated_on === null ? null : String(row.graduated_on),
      confirmedAt: row.confirmed_at,
      recordedBy: row.recorded_by,
      confirmedBy: row.confirmed_by,
      fromSchool: row.from_school,
    }));
  }

  /** The conflict for a stale line (decision 0282), as `SuynlService` builds its own. */
  private async conflictFor(
    executor: Db | Transaction<Database>,
    actor: Actor,
    change: TrainingChange,
    stored: Map<string, Graduation>,
  ): Promise<ApiError> {
    const current = stored.get(keyOf(change.person_id, change.program)) ?? null;
    const person = await nameOfPerson(this.deps, executor, change.person_id);
    const label = LABELS[change.program];
    const submitted = {
      values: {
        person: person.name,
        program: change.program,
        graduated: change.graduated,
        graduated_on: change.graduated_on ?? null,
      },
      recordedAt: new Date().toISOString(),
      actor: await nameOfPerson(this.deps, executor, actor.personId),
    };

    if (current !== null) {
      const by = await nameOfAccount(this.deps, executor, current.recordedBy);

      return new GrowthConflictError({
        message: `${person.name} · ${label} was changed by ${by.name} after this page loaded. Reload to see it, then decide again.`,
        submittedRow: change.seen_id ?? null,
        currentRow: current.id,
        submitted,
        current: {
          values: {
            person: person.name,
            program: change.program,
            graduated: true,
            graduated_on: current.graduatedOn,
          },
          recordedAt: current.confirmedAt.toISOString(),
          actor: by,
        },
      });
    }

    const seen =
      change.seen_id === undefined || change.seen_id === null
        ? undefined
        : await executor
            .selectFrom('training_graduations')
            .select(['person_id', 'program', 'superseded_at', 'corrected_by'])
            .where('id', '=', change.seen_id)
            .executeTakeFirst();
    // A row on a record merged into this person is this person's (decision 0408, point 20).
    const resolve = resolverOf(await this.people.mergedPairsWithin(executor));

    if (
      seen === undefined ||
      canonicalId(resolve(seen.person_id)) !== canonicalId(change.person_id) ||
      seen.program !== change.program ||
      seen.superseded_at === null ||
      seen.corrected_by === null
    ) {
      return new InvariantViolationError(
        'seen_id does not name a graduation this person held. Reload and try again.',
        { person_id: change.person_id, program: change.program, seen_id: change.seen_id ?? null },
      );
    }

    const by = await nameOfAccount(this.deps, executor, seen.corrected_by);

    return new GrowthConflictError({
      message: `${person.name} · ${label} was withdrawn by ${by.name} after this page loaded. Reload to see it, then decide again.`,
      submittedRow: change.seen_id ?? null,
      currentRow: null,
      submitted,
      current: {
        values: { person: person.name, program: change.program, graduated: false },
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
function outcomeOf(change: TrainingChange, stored: Map<string, Graduation>): Outcome {
  const current = stored.get(keyOf(change.person_id, change.program)) ?? null;
  const agrees = change.graduated
    ? current !== null && current.graduatedOn === (change.graduated_on ?? null)
    : current === null;

  if (agrees) {
    return 'UNCHANGED';
  }

  if (!seenIsCurrent(change.seen_id, current === null ? null : current.id)) {
    return 'STALE';
  }

  if (!change.graduated) {
    return 'RETRACT';
  }

  return current === null ? 'CREATE' : 'REPLACE';
}

/** Refusals that need nothing stored to decide, made before anything is read. */
function assertWellFormed(changes: readonly TrainingChange[]): void {
  const seen = new Set<string>();

  for (const change of changes) {
    const key = keyOf(change.person_id, change.program);
    const details = { person_id: change.person_id, program: change.program };

    if (seen.has(key)) {
      throw new InvariantViolationError(
        'This save names the same graduation for the same person twice. Send one change per graduation.',
        details,
      );
    }
    seen.add(key);

    const hasSeen = change.seen_id !== undefined && change.seen_id !== null;
    const hasReason = change.reason !== undefined && change.reason !== null;

    if (!change.graduated && change.graduated_on != null) {
      throw new ValidationFailedError('A withdrawal carries no graduation date.', {
        field: 'graduated_on',
        ...details,
      });
    }

    if (!change.graduated && !hasSeen) {
      throw new ValidationFailedError('A withdrawal names the graduation row it withdraws.', {
        field: 'seen_id',
        ...details,
      });
    }

    // Withdrawing a graduation, or changing its date, corrects a row; a first
    // graduation corrects nothing (section 28, *Correcting*).
    if (hasSeen && !hasReason) {
      throw new ValidationFailedError('Say why this graduation is being changed.', {
        field: 'reason',
        ...details,
      });
    }

    if (!hasSeen && hasReason) {
      throw new ValidationFailedError('A first graduation needs no reason. Remove it.', {
        field: 'reason',
        ...details,
      });
    }
  }
}

function narrowingFor(
  step: TrainingStep | undefined,
  held: Map<string, Set<TrainingProgram>>,
): { include?: ReadonlySet<string>; exclude?: ReadonlySet<string> } {
  if (step === undefined) {
    return {};
  }

  if (step === 'NOT_STARTED') {
    return { exclude: new Set(held.keys()) };
  }

  if (step === 'STILL_TO_FINISH') {
    return { exclude: allFive(held) };
  }

  return {
    include: new Set([...held].filter(([, programs]) => programs.has(step)).map(([id]) => id)),
  };
}

/** The people holding all five graduations (decision 0287). */
function allFive(held: Map<string, Set<TrainingProgram>>): Set<string> {
  return new Set(
    [...held]
      .filter(([, programs]) => programs.size === TRAINING_PROGRAMS.length)
      .map(([id]) => id),
  );
}

function keyOf(personId: string, program: TrainingProgram): string {
  return `${canonicalId(personId)}|${program}`;
}
