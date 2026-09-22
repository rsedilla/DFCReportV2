/**
 * A bordered frame around one group of figures or one set of controls (owner's choice,
 * 2026-09-22). Square, like every surface here, and it carries no colour of its own: a
 * frame groups, it never grades (SKILL.md sections 13, 17 and 19).
 */
export const FRAME = 'border-line bg-surface border p-5';

/** The report's controls, in one bar above the figures, so no control reads as a figure. */
export const CONTROL_BAR =
  'border-line bg-raised flex flex-wrap items-end gap-x-6 gap-y-4 border p-4 *:mt-0';
