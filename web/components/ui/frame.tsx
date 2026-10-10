/**
 * A bordered frame around one group of figures or one set of controls (owner's choice,
 * 2026-09-22). Square, like every surface here, and it carries no colour of its own: a
 * frame groups, it never grades (SKILL.md sections 13, 17 and 19).
 */
export const FRAME = 'border-line bg-surface border p-5';

/** One entry of a list inside a frame: a rule between entries rather than a box round each. */
export const ROW = 'border-line border-t py-3 first:border-t-0';

/**
 * The chosen tab's pane (owner's choice of 2026-10-05). The tab row's lower edge is the
 * pane's top, so the chosen tab and its box read as one shape, and everything belonging to
 * that tab is inside it.
 */
export const TAB_ROW = 'border-accent border-b-2';
// `flow-root` keeps the first child's top margin inside the pane: with no top border to
// stop it, the margin would collapse through and open a gap under the tabs.
export const TAB_PANE = 'border-accent flow-root min-w-0 border-2 border-t-0 px-4 pb-5 sm:px-5';

/**
 * One tab of a tab row, the same on every screen (owner's choice of 2026-10-10): sized to
 * its words, the chosen one filled. `px-3` below `sm` lets three tabs fit a 320px phone.
 */
export function tabClasses(active: boolean): string {
  return [
    'focus-visible:outline-accent inline-flex min-h-11 items-center gap-2 border border-b-0 px-3 sm:px-4',
    'text-xs font-bold tracking-[0.08em] uppercase',
    'focus-visible:outline-2 focus-visible:-outline-offset-2',
    active ? 'bg-accent text-surface border-accent' : 'border-line text-ink hover:bg-raised',
  ].join(' ');
}

/** The report's controls, in one bar above the figures, so no control reads as a figure. */
export const CONTROL_BAR =
  'border-line bg-raised flex flex-wrap items-end gap-x-6 gap-y-4 border p-4 *:mt-0';
