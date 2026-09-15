import { CLASSIFICATION_LABELS, type AttendanceBucket, type Classification } from '@/lib/reports';

/**
 * One row of a figures list: a name and its count.
 *
 * Rows rather than cards, so the names line up down one side and the counts down the
 * other, and a reader can add them.
 *
 * **A direct child of the `<dl>`, and the rule sits above it.** axe allows a `<dl>` only
 * `<dt>`/`<dd>` groups wrapped in one `<div>` each, so the rows cannot share a wrapper —
 * and without one the last row is not the list's last child, so a rule below each row
 * would stack against the Total's. A rule above each row but the first does not.
 */
function FigureRow({ label, value }: { label: React.ReactNode; value: number }) {
  return (
    <div className="border-line flex items-baseline justify-between gap-4 border-t py-2 first:border-t-0">
      <dt className="text-sm">{label}</dt>
      <dd className="text-base font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

/**
 * The row that closes a list: the sum of the rows above it.
 *
 * **It is added up here, and it is meant to agree with the people who attended.**
 * Section 20 requires classification and monthly attendance each to sum to the same
 * unique-people total, so a Total that differs from that figure on the same screen is
 * the data-integrity defect section 20 names, shown rather than hidden. Adding counts
 * divides nothing, so it is not the arithmetic section 13 forbids.
 */
function TotalRow({ value }: { value: number }) {
  return (
    <div className="border-edge flex items-baseline justify-between gap-4 border-t-2 pt-2">
      <dt className="text-accent text-xs font-bold tracking-[0.08em] uppercase">Total</dt>
      <dd className="text-base font-bold tabular-nums">{value}</dd>
    </div>
  );
}

/**
 * Section 9's classification, as five counts that sum to the population.
 *
 * **Nothing here is ordered by size or coloured by value.** These are stages of a
 * journey, not a ranking: a Cell of five VIPs is a Cell doing the thing the
 * ministry exists for, and one of five Regulars is a different thing rather than a
 * better one. Sections 13, 17 and 19 forbid grading either in colour.
 */
export function ClassificationFigures({ classification }: { classification: Classification }) {
  const total = CLASSIFICATION_LABELS.reduce((sum, { key }) => sum + classification[key], 0);

  return (
    <section aria-labelledby="classification-heading">
      <h2 id="classification-heading" className="field-label">
        Where people are in their journey
      </h2>
      <p className="text-muted mt-1 max-w-2xl text-sm leading-relaxed">
        Counted from how many times each person has attended in total, as it stood at the end
        of this month.
      </p>

      <dl className="mt-3">
        {CLASSIFICATION_LABELS.map(({ key, label }) => (
          <FigureRow key={key} label={label} value={classification[key]} />
        ))}
        <TotalRow value={total} />
      </dl>
    </section>
  );
}

/**
 * Section 9's monthly-attendance buckets — how many people came once, twice, and
 * so on up to N.
 *
 * **`Completed` is the API's label and never this screen's arithmetic.** Section 9
 * is explicit that it means every applicable event and is never a fixed number,
 * and section 12 repeats it: "Never label buckets from the calendar count." So the
 * `completed` flag is read from the response, and nothing here compares `times`
 * against `n`.
 *
 * **A bucket with nobody in it is still shown**, because the shape of the view is
 * a property of the month rather than of who turned up: a reader comparing two
 * months needs the same rows in both.
 *
 * **Both domains reach this component, and N does not mean the same thing in each**,
 * which is why the sentence below is the caller's rather than this file's. Section 12
 * makes a Cell's N "the meetings that actually took place and were recorded"; section 9
 * makes DCC's N the applicable events — the Sundays the calendar carries a service on,
 * recorded or not.
 */
export function AttendanceBuckets({
  buckets,
  n,
  summary,
}: {
  buckets: AttendanceBucket[];
  n: number;
  /** What N counts, in this domain's own words. See the docblock above. */
  summary: (n: number) => string;
}) {
  const total = buckets.reduce((sum, bucket) => sum + bucket.people, 0);

  return (
    <section aria-labelledby="buckets-heading">
      <h2 id="buckets-heading" className="field-label">
        How often people came
      </h2>
      <p className="text-muted mt-1 max-w-2xl text-sm leading-relaxed">
        {summary(n)} Each row counts the people who attended that many of them.
      </p>

      <dl className="mt-3">
        {buckets.map((bucket) => (
          <FigureRow
            key={bucket.times}
            label={
              <>
                {bucket.times === 1 ? 'Once' : `${bucket.times} times`}
                {/*
                  The word, from the flag the API sent. Not a colour and not a badge:
                  completing the month is not a grade, and section 13 forbids
                  rendering one as such.
                */}
                {bucket.completed ? ' — all of them' : null}
              </>
            }
            value={bucket.people}
          />
        ))}
        <TotalRow value={total} />
      </dl>
    </section>
  );
}
