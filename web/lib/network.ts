import { authenticatedRequest } from './session';

/**
 * One person on the Network screen, with the headcounts of their branch now
 * (SKILL.md section 17, decision 0252).
 */
export interface BranchNode {
  id: string;
  member_id: string;
  full_name: string;
  /** Whether this person currently leads anybody. */
  leads_anyone: boolean;
  /** Their direct disciples now. */
  direct_reports: number;
  /** Everyone beneath them now, themselves excluded. */
  beneath: number;
}

/** The focus person and one page of their direct disciples, ordered by name. */
export interface Branch {
  person: BranchNode;
  data: BranchNode[];
  next_cursor: string | null;
  /**
   * `my-tree` only: for a reader outside the pastoral tree, the Network roots their
   * scope reaches, which is where the screen starts (decision 0268). Empty otherwise.
   */
  roots?: BranchNode[];
}

/**
 * DCC records behind for the current month, under `dcc.view_subtree` (decision 0252).
 * Each figure is a sum over a branch as it stands now of each leader's own unmet
 * obligations.
 */
export interface DccBehind {
  reporting_month: string;
  open: boolean;
  branch_behind: number;
  behind_by_child: Record<string, number>;
}

/** The Cell figures for the current month, under `cell.view_subtree` (decision 0252). */
export interface CellFigures {
  reporting_month: string;
  open: boolean;
  /** Current Cell Leaders beneath the person, the person excluded (section 11). */
  cell_leaders_beneath: number;
  branch_meetings_behind: number;
  meetings_behind_by_child: Record<string, number>;
}

/** Twenty at a time, the same at every width (decision 0252). */
const PAGE = '20';

function pagingSuffix(cursor: string | undefined): string {
  const params = new URLSearchParams({ limit: PAGE });

  // The API refuses `?cursor=` rather than restarting at page one, so an empty value is
  // dropped here rather than sent.
  if (cursor !== undefined && cursor !== '') {
    params.set('cursor', cursor);
  }

  return `?${params.toString()}`;
}

/** The signed-in person's own branch: where the Network screen starts. */
export async function getMyBranch(cursor?: string, signal?: AbortSignal): Promise<Branch> {
  return authenticatedRequest<Branch>(`/api/v1/network/my-tree${pagingSuffix(cursor)}`, {
    signal,
  });
}

/** Anybody else's branch, when the reader's scope reaches them. */
export async function getBranch(
  personId: string,
  cursor?: string,
  signal?: AbortSignal,
): Promise<Branch> {
  return authenticatedRequest<Branch>(
    `/api/v1/leaders/${encodeURIComponent(personId)}/children${pagingSuffix(cursor)}`,
    { signal },
  );
}

export async function getDccBehind(personId: string, signal?: AbortSignal): Promise<DccBehind> {
  return authenticatedRequest<DccBehind>(
    `/api/v1/leaders/${encodeURIComponent(personId)}/dcc-behind`,
    { signal },
  );
}

export async function getCellFigures(personId: string, signal?: AbortSignal): Promise<CellFigures> {
  return authenticatedRequest<CellFigures>(
    `/api/v1/leaders/${encodeURIComponent(personId)}/cell-figures`,
    { signal },
  );
}
