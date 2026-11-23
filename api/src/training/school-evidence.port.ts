import type { Transaction } from 'kysely';

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

export interface SchoolEvidencePort {
  /** Every current piece of evidence the school holds for these records, for one program. */
  evidenceWithin(
    trx: Transaction<Database>,
    personIds: readonly string[],
    program: 'ENCOUNTER' | 'LIFE_CLASS',
  ): Promise<SchoolEvidence[]>;
}

export const SCHOOL_EVIDENCE_PORT = Symbol('SCHOOL_EVIDENCE_PORT');
