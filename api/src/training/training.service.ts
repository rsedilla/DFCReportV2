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

import { TRAINING_PROGRAMS, type TrainingListDto, type TrainingStep } from './dto/training.dto';

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
  personId: string;
  program: TrainingProgram;
  graduatedOn: string | null;
  confirmedAt: Date;
  recordedBy: string;
  /** Whose statement the row is, which a correction is attributed to (section 28). */
  confirmedBy: string | null;
}

type Outcome = 'UNCHANGED' | 'CREATE' | 'REPLACE' | 'RETRACT' | 'STALE';

const CAPABILITIES = {
  confirm: Capability.TrainingConfirm,
  onBehalf: Capability.TrainingConfirmOnBehalf,
};

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
   * (decision 0281), as things stand now. The school cards overlap.
   */
  async counts(actor: Actor): Promise<Record<string, unknown>> {
    const population = await growthPopulation(this.deps, actor, Capability.TrainingViewSubtree);
    const held = await this.currentPrograms(population);
    const people = await this.people.countCurrent(population);

    const perProgram = Object.fromEntries(
      TRAINING_PROGRAMS.map((program) => [
        program.toLowerCase(),
        [...held.values()].filter((programs) => programs.has(program)).length,
      ]),
    );

    // `all_five` is not a card: it is how many the list's opening view leaves out (decision 0287).
    return { people, not_started: people - held.size, ...perProgram, all_five: allFive(held).size };
  }

  /** `GET /api/v1/training/people`: the tab's list, one page (section 28). */
  async list(actor: Actor, query: TrainingListDto): Promise<Record<string, unknown>> {
    const now = await databaseNow(this.db);
    const population = await growthPopulation(this.deps, actor, Capability.TrainingViewSubtree);
    const held = await this.currentPrograms(population);

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
    const graduations = await this.currentGraduations(this.db, ids);
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
          })),
        may_file: mayFile.has(row.id),
      })),
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

        const stored = keyed(await this.currentGraduations(trx, personIds, { lock: true }));
        const outcomes = changes.map((change) => outcomeOf(change, stored));

        const staleAt = outcomes.indexOf('STALE');
        if (staleAt !== -1) {
          throw await this.conflictFor(trx, actor, changes[staleAt], stored);
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

          if (row !== null) {
            await trx
              .updateTable('training_graduations')
              .set({
                superseded_at: sql<Date>`now()`,
                corrected_by: actor.accountId,
                correction_reason: change.reason ?? null,
              })
              .where('id', '=', row.id)
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
            await this.audit.writeWithin(trx, {
              actorId: actor.accountId,
              action: 'training_graduation.corrected',
              targetType: 'person',
              targetId: change.person_id,
              before: {
                program: change.program,
                graduated_on: row?.graduatedOn ?? null,
                confirmed_by: row?.confirmedBy ?? null,
              },
              after:
                outcome === 'REPLACE'
                  ? {
                      program: change.program,
                      graduated_on: change.graduated_on ?? null,
                      confirmed_by: filing.confirmedBy,
                      on_behalf: filing.onBehalf,
                    }
                  : {
                      program: change.program,
                      withdrawn: true,
                      confirmed_by: row?.confirmedBy ?? null,
                      on_behalf: onBehalfOf(row?.confirmedBy ?? null, actor.personId),
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

      // A lost race on a first graduation (section 22, *Write conflicts*), answered on
      // what is now committed, as `SuynlService.submit` answers its own.
      const personIds = unique(changes.map((change) => change.person_id));
      const stored = keyed(await this.currentGraduations(this.db, personIds));
      const stale = changes.find((change) => outcomeOf(change, stored) === 'STALE');

      if (stale !== undefined) {
        throw await this.conflictFor(this.db, actor, stale, stored);
      }

      throw new ApiError(
        ApiErrorCode.RESOURCE_BUSY,
        'Somebody else recorded these graduations while yours was being saved. Retry shortly, ' +
          'with the same key.',
        {},
      );
    }
  }

  /** The programs each current person holds a current graduation for. */
  private async currentPrograms(
    population: ReadonlySet<string> | null,
  ): Promise<Map<string, Set<TrainingProgram>>> {
    if (population !== null && population.size === 0) {
      return new Map();
    }

    const rows = await this.db
      .selectFrom('training_graduations')
      .select(['person_id', 'program'])
      .where('superseded_at', 'is', null)
      .$if(population !== null, (qb) => qb.where('person_id', 'in', [...(population ?? [])]))
      .execute();

    // Current people only (decision 0279).
    const identities = await this.people.forDecisions(unique(rows.map((row) => row.person_id)));
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
      ])
      .where('person_id', 'in', [...personIds])
      .where('superseded_at', 'is', null)
      .$if(options.lock === true, (qb) => qb.forUpdate())
      .execute();

    return rows.map((row) => ({
      id: row.id,
      personId: row.person_id,
      program: row.program,
      graduatedOn: row.graduated_on === null ? null : String(row.graduated_on),
      confirmedAt: row.confirmed_at,
      recordedBy: row.recorded_by,
      confirmedBy: row.confirmed_by,
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

    if (
      seen === undefined ||
      canonicalId(seen.person_id) !== canonicalId(change.person_id) ||
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

  const seen = change.seen_id ?? null;
  if (
    (seen === null ? null : canonicalId(seen)) !==
    (current === null ? null : canonicalId(current.id))
  ) {
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

/** Whether the actor is withdrawing somebody else's statement (section 14). */
function onBehalfOf(confirmedBy: string | null, actorPersonId: string): boolean {
  return confirmedBy !== null && canonicalId(confirmedBy) !== canonicalId(actorPersonId);
}

function keyOf(personId: string, program: TrainingProgram): string {
  return `${canonicalId(personId)}|${program}`;
}

function keyed(graduations: readonly Graduation[]): Map<string, Graduation> {
  return new Map(
    graduations.map((graduation) => [keyOf(graduation.personId, graduation.program), graduation]),
  );
}

function unique(ids: readonly string[]): string[] {
  return [...new Map(ids.map((id) => [canonicalId(id), id])).values()];
}
