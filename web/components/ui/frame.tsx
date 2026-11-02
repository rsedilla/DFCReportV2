/**
 * A white card around one group of figures or one set of controls (owner's choice,
 * 2026-09-22; rounded on the grey page since decision 0423). It carries no colour of its
 * own: a frame groups, it never grades (SKILL.md sections 13, 17 and 19).
 */
export const FRAME = 'border-line bg-surface rounded-xl border p-5 shadow-sm';

/** One entry of a list inside a frame: a rule between entries rather than a box round each. */
export const ROW = 'border-line border-t py-3 first:border-t-0';

/**
 * The chosen tab's pane (owner's choice of 2026-10-05). The tab row's lower edge is the
 * pane's top, so the chosen tab and its box read as one shape, and everything belonging to
 * that tab is inside it.
 */
export const TAB_ROW = 'border-line border-b';
// `flow-root` keeps the first child's top margin inside the pane: with no top border to
// stop it, the margin would collapse through and open a gap under the tabs.
export const TAB_PANE =
  'border-line bg-surface flow-root min-w-0 rounded-b-xl border border-t-0 px-4 pb-5 shadow-sm sm:px-5';

/**
 * How every tab row lays out its tabs (decision 0416): one fixed size, 13rem (decision 0417), from `sm`, and
 * two equal tabs to a row on a phone, where a label may wrap only on the narrowest. **On a phone an
 * odd last tab fills its row** (decision 0420), rather than standing half width beside a gap.
 */
export const TAB_GRID =
  'grid grid-cols-2 sm:grid-cols-[repeat(auto-fill,13rem)] [&>:last-child:nth-child(odd)]:col-span-2 sm:[&>:last-child:nth-child(odd)]:col-span-1';

/**
 * One tab of a tab row, the same on every screen: one size (decision 0416), the chosen one
 * filled, its words in title case (decision 0332), centred in the tab. The others' words are
 * in the accent (owner, 2026-10-19), so a tab never reads as body text.
 */
export function tabClasses(active: boolean): string {
  return [
    'focus-visible:outline-accent inline-flex min-h-11 min-w-0 items-center justify-center gap-2 rounded-t-md px-2 py-2 text-center sm:px-3',
    'text-sm font-semibold',
    'focus-visible:outline-2 focus-visible:-outline-offset-2',
    // The chosen tab is underlined in the accent rather than filled (decision 0423): a change of
    // shape as well as of colour, so it never rests on hue alone (1.4.1).
    active
      ? 'text-accent shadow-[inset_0_-3px_0_var(--color-accent)]'
      : 'text-muted hover:bg-surface hover:text-ink',
  ].join(' ');
}

/**
 * The count beside a tab's or a switch's words (owner's choice of 2026-10-19): filled in the
 * accent, and the other way round on the chosen one, so it is the chosen tab's own two
 * colours. Every count looks alike, so it marks how many and grades nothing (SKILL.md
 * sections 13, 17 and 19). `shrink-0`, because a long label squeezed it narrower than its
 * number, which then ran over the edge.
 */
export function countClasses(active: boolean): string {
  return [
    'bg-accent-tint text-accent inline-block min-w-6 shrink-0 rounded-full px-1.5 text-center leading-[1.375rem] tabular-nums',
    active ? 'font-bold' : 'font-semibold',
  ].join(' ');
}

/** The report's controls, in one bar above the figures, so no control reads as a figure. */
export const CONTROL_BAR =
  'border-line bg-surface flex flex-wrap items-end gap-x-6 gap-y-4 rounded-xl border p-4 shadow-sm *:mt-0';
