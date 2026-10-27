import { authenticatedRequest } from './session';

/**
 * Archiving and restoring a person, and People's *Absent 3+ Months* tab (SKILL.md sections 3,
 * 6 and 19; decision 0397). Only the Admin archives and restores; the API checks
 * `people.manage_lifecycle` and, for the account choice, `accounts.manage`.
 */

/** The reasons an archive may give, in the order the dialog offers them. */
export const ARCHIVE_REASONS = [
  'WORKING_AWAY',
  'STUDYING_AWAY',
  'MOVED_AWAY',
  'ATTENDS_ANOTHER_CHURCH',
  'PASSED_AWAY',
  'RECORD_CREATED_IN_ERROR',
  'OTHER',
] as const;

export type ArchiveReason =
  | (typeof ARCHIVE_REASONS)[number]
  // The first list's, kept on the rows that carry it and given for no new archive.
  | 'NO_LONGER_IN_CURRENT_NETWORK';

const REASON_LABELS: Record<ArchiveReason, string> = {
  WORKING_AWAY: 'Working away',
  STUDYING_AWAY: 'Studying away',
  MOVED_AWAY: 'Moved away',
  ATTENDS_ANOTHER_CHURCH: 'Attends another church',
  PASSED_AWAY: 'Passed away',
  RECORD_CREATED_IN_ERROR: 'Record created in error',
  OTHER: 'Other',
  NO_LONGER_IN_CURRENT_NETWORK: 'No longer in the current Network',
};

export function archiveReasonLabel(reason: ArchiveReason | null): string {
  return reason === null ? 'No reason recorded' : REASON_LABELS[reason];
}

/** A person page's read-only line for an archived person; null for a current one. */
export interface ArchivedLine {
  archived_at: string;
  reason: ArchiveReason | null;
  note: string | null;
}

interface CellName {
  id: string;
  cell_id: string;
  category: string | null;
  day_of_week: number | null;
}

/** One row of *Absent 3+ Months*. */
export interface AbsentPerson {
  id: string;
  member_id: string;
  full_name: string;
  leader: { person_id: string; full_name: string } | null;
  cell: CellName | null;
  /** The Cells they lead now; such a row carries no Archive (decision 0397, point 3). */
  leads: (CellName & { members: number })[];
  /** How many people they pastor now; such a row carries no Archive either (decision 0397). */
  pastors: number;
  last_at_cell: string | null;
  last_at_dcc: string | null;
}

/** One row of the Admin's *Archived* view. */
export interface ArchivedPerson {
  id: string;
  member_id: string;
  full_name: string;
  archived_at: string;
  reason: ArchiveReason | null;
  note: string | null;
  leader: { person_id: string; full_name: string } | null;
  cell: CellName | null;
}

function query(params: { cursor?: string; limit?: number }): string {
  const search = new URLSearchParams();
  if (params.cursor) {
    search.set('cursor', params.cursor);
  }
  if (params.limit !== undefined) {
    search.set('limit', String(params.limit));
  }
  const suffix = search.toString();
  return suffix === '' ? '' : `?${suffix}`;
}

export async function absentPeople(
  params: { cursor?: string; limit?: number } = {},
  signal?: AbortSignal,
): Promise<{ months: string[]; data: AbsentPerson[]; next_cursor: string | null }> {
  return authenticatedRequest(`/api/v1/people/absent${query(params)}`, { signal });
}

export async function archivedPeople(
  params: { cursor?: string; limit?: number } = {},
  signal?: AbortSignal,
): Promise<{ data: ArchivedPerson[]; next_cursor: string | null }> {
  return authenticatedRequest(`/api/v1/people/archived${query(params)}`, { signal });
}

/** The key is the caller's, so a retry of the same choice is the same request (section 22). */
export async function archivePerson(
  personId: string,
  input: { reason: ArchiveReason; note?: string; account_access?: 'DISABLE' | 'KEEP' },
  idempotencyKey: string,
): Promise<unknown> {
  return authenticatedRequest(`/api/v1/people/${encodeURIComponent(personId)}/archive`, {
    method: 'POST',
    body: input,
    idempotencyKey,
  });
}

export async function restorePerson(personId: string, idempotencyKey: string): Promise<unknown> {
  return authenticatedRequest(`/api/v1/people/${encodeURIComponent(personId)}/restore`, {
    method: 'POST',
    idempotencyKey,
  });
}

/** "September 2026", for the months the tab covers. */
export function monthName(month: string): string {
  const [year, number] = month.split('-').map(Number);
  return new Date(Date.UTC(year, number - 1, 1)).toLocaleDateString('en-PH', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** "27 Oct 2026", for a day or an instant, in Asia/Manila. */
export function shortDate(value: string): string {
  const at = value.length === 10 ? new Date(`${value}T00:00:00+08:00`) : new Date(value);
  return at.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Manila',
  });
}
