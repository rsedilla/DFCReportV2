import { authenticatedRequest } from './session';

/** One read of a person's record, from any screen (decision 0414). */
export interface PersonView {
  viewer: { person_id: string; full_name: string };
  /** `PASTORAL_LEADER` where the viewer is the person's pastoral leader now. */
  relation: 'PASTORAL_LEADER' | null;
  viewed_at: string;
}

/** Who opened or looked up this person's record, newest first. The Admin's alone; the API checks it. */
export async function getPersonViews(
  personId: string,
  query: { cursor?: string; limit?: number },
  signal?: AbortSignal,
): Promise<{ data: PersonView[]; next_cursor: string | null }> {
  const params = new URLSearchParams();
  if (query.cursor) params.set('cursor', query.cursor);
  if (query.limit) params.set('limit', String(query.limit));
  const suffix = params.size > 0 ? `?${params.toString()}` : '';
  return authenticatedRequest(`/api/v1/people/${encodeURIComponent(personId)}/views${suffix}`, {
    signal,
  });
}

/**
 * When, as a person reads it: "Today, 9:14 am", "Yesterday, 7:02 pm", or "28 Oct, 10:31 am",
 * in Manila time (decision 0010).
 */
export function openedWhen(iso: string, now: Date = new Date()): string {
  const at = new Date(iso);
  const day = (date: Date) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(date);
  const time = at.toLocaleString('en-GB', {
    timeZone: 'Asia/Manila',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (day(at) === day(now)) return `Today, ${time}`;
  if (day(at) === day(yesterday)) return `Yesterday, ${time}`;
  // The year too where it is not this one, since the log reaches back a year.
  const thisYear = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric' });
  const sameYear = thisYear.format(at) === thisYear.format(now);
  const date = at.toLocaleString('en-GB', {
    timeZone: 'Asia/Manila',
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
  return `${date}, ${time}`;
}
