import { authenticatedRequest } from './session';

/**
 * Person Merge as this client sees it (SKILL.md section 3, decision 0408). The Admin joins a
 * duplicate record into the record kept; `people.merge` is Admin-only, and the API decides.
 */

/** One reason the merge cannot be made yet, worded for the merge screen by the API. */
export interface MergeRefusal {
  code: string;
  message: string;
}

/** A merged record's read-only line (decision 0408, point 14). */
export interface MergedLine {
  into: { id: string; member_id: string; full_name: string };
  merged_at: string;
  merged_by: string | null;
}

export async function getMergePreview(
  keptId: string,
  duplicateId: string,
  signal?: AbortSignal,
): Promise<{ refusals: MergeRefusal[] }> {
  const query = new URLSearchParams({ duplicate_id: duplicateId }).toString();
  return authenticatedRequest(
    `/api/v1/people/${encodeURIComponent(keptId)}/merge-preview?${query}`,
    { signal },
  );
}

/** The key is the caller's, so a retry of the same merge is the same request (section 22). */
export async function mergePerson(
  keptId: string,
  input: { duplicate_id: string; reason: string },
  idempotencyKey: string,
): Promise<{ merged_into: { id: string; member_id: string; full_name: string } }> {
  return authenticatedRequest(`/api/v1/people/${encodeURIComponent(keptId)}/merge`, {
    method: 'POST',
    body: input,
    idempotencyKey,
  });
}
