import { authenticatedRequest } from './session';

import type { CellCategory } from './cells';

/** One person of a leader's two levels (decision 0422). */
export interface MyPeopleRow {
  person_id: string;
  full_name: string;
  /** Who disciples them; null where that is the reader. */
  leader: { person_id: string; full_name: string } | null;
  cell: { cell_id: string; category: CellCategory | null; day_of_week: number | null } | null;
  /** True where the reader may not read their Cell, so `cell` says nothing. */
  cell_withheld: boolean;
}

export async function getMyPeople(
  cursor: string | null,
  signal?: AbortSignal,
): Promise<{ data: MyPeopleRow[]; next_cursor: string | null }> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  return authenticatedRequest(`/api/v1/cells/people/mine${query}`, { signal });
}

export async function getMyPeopleCounts(
  signal?: AbortSignal,
): Promise<{ all: number; direct: number; beneath: number }> {
  return authenticatedRequest('/api/v1/cells/people/mine/counts', { signal });
}
