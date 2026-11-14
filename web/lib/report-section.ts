/**
 * Which of the Senior Pastors' report items a page belongs to (decision 0488): *People*, *Cells*
 * or *Services*. A report's own address says which, except the twelve-month view, `/trends`,
 * whose figure is in its query; the page tells the menu here, so the menu can mark the item
 * without reading the query itself.
 *
 * A plain store rather than React state, so the page sets it from an effect and the menu reads it
 * with `useSyncExternalStore`.
 */
export type ReportSection = 'people' | 'cells' | 'services';

let section: ReportSection | null = null;
const listeners = new Set<() => void>();

export function setReportSection(next: ReportSection | null): void {
  if (next === section) {
    return;
  }
  section = next;
  listeners.forEach((listener) => listener());
}

export function subscribeReportSection(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function reportSection(): ReportSection | null {
  return section;
}

/** No section before the page says, on the server and on the first paint. */
export function noReportSection(): ReportSection | null {
  return null;
}
