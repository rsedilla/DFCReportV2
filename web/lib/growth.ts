import { authenticatedRequest } from '@/lib/session';

/**
 * The Growth tabs' API (SKILL.md section 28; decisions 0278 to 0282).
 *
 * Every list and count is as things stand now and covers current people only. Who may
 * file for whom is the API's to decide; `may_file` on a row says what it decided, so a
 * row the reader cannot file for shows marks rather than boxes.
 */

export interface GrowthListQuery {
  q?: string;
  mine?: boolean;
  step?: string;
  cursor?: string | null;
  limit?: number;
}

function listQuery(query: GrowthListQuery): string {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.mine) params.set('mine', 'true');
  if (query.step) params.set('step', query.step);
  if (query.cursor) params.set('cursor', query.cursor);
  params.set('limit', String(query.limit ?? 50));
  return params.toString();
}

// ---------------------------------------------------------------------------
// SUYNL
// ---------------------------------------------------------------------------

export type SuynlStep = 'NOT_STARTED' | 'IN_PROGRESS' | 'GRADUATED';

/** The three cards, which add up to everyone listed (decision 0281). */
export interface SuynlCounts {
  people: number;
  not_started: number;
  in_progress: number;
  graduated: number;
}

export interface SuynlLesson {
  id: string;
  lesson: number;
  /** The Manila day it was filed; a lesson carries no stated date (section 28). */
  filed_on: string;
}

export interface SuynlPerson {
  person_id: string;
  member_id: string;
  full_name: string;
  lessons: SuynlLesson[];
  /** The day the tenth lesson was filed, or null short of ten. */
  graduated_on: string | null;
  may_file: boolean;
}

export interface SuynlPage {
  data: SuynlPerson[];
  next_cursor: string | null;
}

/** One tick or untick. A withdrawal names the row it withdraws and carries a reason. */
export interface SuynlChange {
  person_id: string;
  lesson: number;
  done: boolean;
  seen_id: string | null;
  reason?: string;
}

export function getSuynlCounts(signal?: AbortSignal): Promise<SuynlCounts> {
  return authenticatedRequest<SuynlCounts>('/api/v1/suynl/counts', { signal });
}

export function listSuynlPeople(query: GrowthListQuery, signal?: AbortSignal): Promise<SuynlPage> {
  return authenticatedRequest<SuynlPage>(`/api/v1/suynl/people?${listQuery(query)}`, { signal });
}

export function submitSuynl(changes: SuynlChange[], idempotencyKey: string): Promise<unknown> {
  return authenticatedRequest<unknown>('/api/v1/suynl/submit', {
    method: 'POST',
    body: { changes },
    idempotencyKey,
  });
}

// ---------------------------------------------------------------------------
// Training
// ---------------------------------------------------------------------------

export type TrainingProgram = 'ENCOUNTER' | 'LIFE_CLASS' | 'SOL_1' | 'SOL_2' | 'SOL_3';

/** The five schools, the Encounter first (section 28). */
export const TRAINING_PROGRAMS: readonly TrainingProgram[] = [
  'ENCOUNTER',
  'LIFE_CLASS',
  'SOL_1',
  'SOL_2',
  'SOL_3',
];

export const PROGRAM_LABELS: Record<TrainingProgram, string> = {
  ENCOUNTER: 'Encounter',
  LIFE_CLASS: 'Life Class',
  SOL_1: 'SOL 1',
  SOL_2: 'SOL 2',
  SOL_3: 'SOL 3',
};

/** A card per school, which overlap, and one for people with none yet (decision 0281). */
export interface TrainingCounts {
  people: number;
  not_started: number;
  encounter: number;
  life_class: number;
  sol_1: number;
  sol_2: number;
  sol_3: number;
}

export interface TrainingGraduation {
  id: string;
  program: TrainingProgram;
  /** Null where the leader does not know it (section 28). */
  graduated_on: string | null;
}

export interface TrainingPerson {
  person_id: string;
  member_id: string;
  full_name: string;
  graduations: TrainingGraduation[];
  may_file: boolean;
}

export interface TrainingPage {
  data: TrainingPerson[];
  next_cursor: string | null;
}

/** One change. Withdrawing a graduation, or changing its date, names the row and a reason. */
export interface TrainingChange {
  person_id: string;
  program: TrainingProgram;
  graduated: boolean;
  graduated_on?: string | null;
  seen_id: string | null;
  reason?: string;
}

export function getTrainingCounts(signal?: AbortSignal): Promise<TrainingCounts> {
  return authenticatedRequest<TrainingCounts>('/api/v1/training/counts', {
    signal,
  });
}

export function listTrainingPeople(
  query: GrowthListQuery,
  signal?: AbortSignal,
): Promise<TrainingPage> {
  return authenticatedRequest<TrainingPage>(`/api/v1/training/people?${listQuery(query)}`, {
    signal,
  });
}

export function submitTraining(
  changes: TrainingChange[],
  idempotencyKey: string,
): Promise<unknown> {
  return authenticatedRequest<unknown>('/api/v1/training/submit', {
    method: 'POST',
    body: { changes },
    idempotencyKey,
  });
}
