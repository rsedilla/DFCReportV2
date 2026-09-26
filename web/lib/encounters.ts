import { authenticatedRequest } from '@/lib/session';

/**
 * An Encounter season (SKILL.md section 28, decision 0296): the Men's and Women's weekends,
 * each the day it starts, and the LC Party five or more weeks before each.
 */
export interface EncounterSeason {
  id: string;
  mens_lc_party_on: string;
  mens_encounter_on: string;
  womens_lc_party_on: string;
  womens_encounter_on: string;
}

/**
 * A season as a reader is shown it: a Whole Church reader both halves, any other reader their
 * own Network's, the other half null (decision 0296). The API decides which.
 */
export interface ShownSeason {
  id: string;
  mens_lc_party_on: string | null;
  mens_encounter_on: string | null;
  womens_lc_party_on: string | null;
  womens_encounter_on: string | null;
}

export type SeasonsShown = 'BOTH' | 'MENS' | 'WOMENS' | 'NEITHER';

export interface EncounterSeasonInput {
  mens_encounter_on: string;
  womens_encounter_on: string;
  /** Left out, five weeks before the Men's weekend. */
  mens_lc_party_on?: string;
  /** Left out, five weeks before the Women's weekend. */
  womens_lc_party_on?: string;
}

/** The LC Party is at least this many days before its own weekend (decision 0296). */
export const PARTY_DAYS_BEFORE = 35;

export function listEncounterSeasons(
  signal?: AbortSignal,
): Promise<{ shows: SeasonsShown; data: ShownSeason[] }> {
  return authenticatedRequest<{ shows: SeasonsShown; data: ShownSeason[] }>(
    '/api/v1/encounter-seasons',
    { signal },
  );
}

export function createEncounterSeason(
  input: EncounterSeasonInput,
  idempotencyKey: string,
): Promise<EncounterSeason> {
  return authenticatedRequest<EncounterSeason>('/api/v1/encounter-seasons', {
    method: 'POST',
    body: input,
    idempotencyKey,
  });
}

export function updateEncounterSeason(
  id: string,
  input: EncounterSeasonInput,
  idempotencyKey: string,
): Promise<EncounterSeason> {
  return authenticatedRequest<EncounterSeason>(
    `/api/v1/encounter-seasons/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: input, idempotencyKey },
  );
}

export function addDays(date: string, days: number): string {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

function weekendsOf(season: ShownSeason): string[] {
  return [season.mens_encounter_on, season.womens_encounter_on].filter(
    (date): date is string => date !== null,
  );
}

/** The earlier of the weekends a reader is shown. */
export function firstWeekendOf(season: ShownSeason): string {
  return weekendsOf(season).sort()[0] ?? '';
}

/** The later of the weekends a reader is shown. */
export function lastWeekendOf(season: ShownSeason): string {
  return weekendsOf(season).sort().reverse()[0] ?? '';
}

/** "4 Dec – 6 Dec 2026": a weekend from the day it starts. */
export function weekendLabel(starts: string): string {
  const format = (date: string, withYear: boolean) =>
    new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      ...(withYear ? { year: 'numeric' } : {}),
      timeZone: 'UTC',
    });
  return `${format(starts, false)} – ${format(addDays(starts, 2), true)}`;
}

export function dayLabel(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** "December 2026": a season by the month of its earlier weekend. */
export function seasonLabel(season: ShownSeason): string {
  return new Date(`${firstWeekendOf(season)}T00:00:00Z`).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
