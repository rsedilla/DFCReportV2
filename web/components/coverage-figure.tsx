/**
 * A coverage line, as the two figures it is and never as one (SKILL.md sections
 * 12, 13 and 17).
 *
 * **It exists so that no screen has the arithmetic available to it.** Section 13
 * forbids a percentage, a composite score, or any figure derived from these two;
 * section 17 restates the prohibition for scope and section 19 for the dashboard.
 * The reliable way to keep a rule like that is to give every screen a component
 * that takes two numbers and renders two numbers, rather than to rely on nobody
 * reaching for a division.
 *
 * **No colour grades it, at any ratio.** Sections 13, 17 and 19 forbid encoding a
 * coverage figure or a leader in colour whatever its contrast ratio, and a Cell
 * reading `0 of 4` has not necessarily done anything wrong — a leader may have
 * been ill, or the Cell may have closed. So this renders in the ordinary text
 * colour at every value, and nothing here takes a variant.
 *
 * **`0 of 0` is shown rather than suppressed** (decisions 0224 and 0225). Section
 * 5 treats it as evidence rather than as an absence — "the coverage line being
 * the evidence that its leader reported nothing" — and suppressing it removes the
 * one figure that explains a row showing nothing.
 *
 * **A null figure is not a zero** (decision 0229). Where nobody owes a record
 * yet, the caller passes `null` and gets words rather than numbers: `0 of 0`
 * would say the obligations were all discharged, which is a different claim.
 */
export function CoverageFigure({
  recorded,
  scheduled,
  unit,
  nothingOwed,
}: {
  recorded: number | null;
  scheduled: number | null;
  /** What is being counted — "meetings recorded", "leaders have recorded". */
  unit: string;
  /** What to say when nobody owes a record yet. Required when either figure is null. */
  nothingOwed?: string;
}) {
  if (recorded === null || scheduled === null) {
    return <span className="text-muted text-sm">{nothingOwed ?? 'Nothing owed yet'}</span>;
  }

  return (
    <span className="text-sm">
      <span className="font-medium tabular-nums">{recorded}</span>
      <span className="text-muted"> of </span>
      <span className="font-medium tabular-nums">{scheduled}</span>
      <span className="text-muted"> {unit}</span>
    </span>
  );
}
