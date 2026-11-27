import type { Kysely, Transaction } from 'kysely';

import type { Database, NetworkName } from '../database/schema';

/**
 * What the school recorded that would file a person's Encounter or Life Class (decision 0509,
 * point 8): asked when the Admin withdraws a *Before the school* tick, so the school's graduation
 * takes its place. `training` cannot import `EquippingModule`, which imports it, so `equipping`
 * answers through this port, bound in `SchoolEvidenceBindingModule`. Optional and refusing when
 * absent (ruling of 2026-09-01); `test/unit/module-graph.spec.ts` asserts it bound.
 *
 * Each answer names what Training needs to date the graduation and nothing more: an Encounter
 * weekend as the season and Network whose date `training` owns, and a posting as its instant.
 */
export type SchoolEvidence =
  /** The Encounter attended, or a posted *Not yet* passed at it: dated that weekend. */
  | { kind: 'WEEKEND'; seasonId: string; network: NetworkName }
  /** A posted *Passed*: dated the day it was posted. */
  | { kind: 'POSTED'; postedAt: Date };

/** The SOL levels the school runs (decisions 0514 and 0516); SOL 3 is not one yet. */
export type SolLevel = 'SOL_1' | 'SOL_2';

/** The programs the school files from: the Encounter, Life Class and each SOL level it runs. */
export type SchoolProgram = 'ENCOUNTER' | 'LIFE_CLASS' | SolLevel;

export interface SchoolEvidencePort {
  /** Every current piece of evidence the school holds for these records, for one program. */
  evidenceWithin(
    trx: Transaction<Database>,
    personIds: readonly string[],
    program: SchoolProgram,
  ): Promise<SchoolEvidence[]>;
  /**
   * The SOL levels the school runs: each one a Coordinator has opened a class of that was not
   * cancelled (owner, 2026-11-26, "When a class opens"; decision 0514, point 13; decision 0516,
   * point 1). From then only the Admin ticks that level, for somebody who finished before the
   * school.
   */
  solLevelsRun(executor: Kysely<Database> | Transaction<Database>): Promise<ReadonlySet<SolLevel>>;
  /**
   * Holds off a SOL class being opened until this transaction ends, taken by a Training save that
   * names a SOL level before it asks `solLevelsRun`, so a leader's tick never lands after a class
   * opened (`equipping/sol-opening.ts`).
   */
  shareSolOpeningWithin(trx: Transaction<Database>): Promise<void>;
}

export const SCHOOL_EVIDENCE_PORT = Symbol('SCHOOL_EVIDENCE_PORT');
