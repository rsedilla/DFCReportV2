import { CLASSIFICATION_LABELS, type AttendanceBucket, type Classification } from '@/lib/reports';

/**
 * Section 9's classification, as five counts that sum to the population.
 *
 * **The total is shown beside them because section 20 says it must add up.**
 * Classification carries no denominator, so the five buckets sum to the
 * unique-people total at every scope — and a reader who cannot see both cannot
 * check it. Showing the total is not a second figure; it is the one the five are
 * a partition of.
 *
 * **Nothing here is ordered by size or coloured by value.** These are stages of a
 * journey, not a ranking: a Cell of five VIPs is a Cell doing the thing the
 * ministry exists for, and one of five Regulars is a different thing rather than a
 * better one. Sections 13, 17 and 19 forbid grading either in colour.
 */
export function ClassificationFigures({
  classification,
  total,
}: {
  classification: Classification;
  total: number;
}) {
  return (
    <section aria-labelledby="classification-heading">
      <h2 id="classification-heading" className="text-lg font-medium">
        Where people are in their journey
      </h2>
      <p className="text-muted mt-1 max-w-2xl text-sm leading-relaxed">
        Counted from how many times each person has attended in total, as it stood at the end
        of this month. The five add up to the {total} {total === 1 ? 'person' : 'people'} who
        attended.
      </p>

      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-5">
        {CLASSIFICATION_LABELS.map(({ key, label }) => (
          <div key={key} className="border-line rounded-lg border p-3">
            <dt className="text-muted text-sm">{label}</dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums">{classification[key]}</dd>
          </div>
        ))}
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
 * months needs the same columns in both.
 *
 * **Buckets reach this component only at Cell scope** (section 12), which the
 * report's own type enforces — an aggregate report carries no `buckets` field for
 * a caller to pass.
 */
export function AttendanceBuckets({ buckets, n }: { buckets: AttendanceBucket[]; n: number }) {
  return (
    <section aria-labelledby="buckets-heading">
      <h2 id="buckets-heading" className="text-lg font-medium">
        How often people came
      </h2>
      <p className="text-muted mt-1 max-w-2xl text-sm leading-relaxed">
        {n === 1
          ? 'One meeting was recorded this month.'
          : `${n} meetings were recorded this month.`}{' '}
        Each column counts the people who attended that many of them.
      </p>

      <dl className="mt-4 flex flex-wrap gap-3">
        {buckets.map((bucket) => (
          <div key={bucket.times} className="border-line min-w-24 rounded-lg border p-3">
            <dt className="text-muted text-sm">
              {bucket.times === 1 ? 'Once' : `${bucket.times} times`}
              {/*
                The word, from the flag the API sent. Not a colour and not a badge:
                completing the month is not a grade, and section 13 forbids
                rendering one as such.
              */}
              {bucket.completed ? <span className="text-ink"> — all of them</span> : null}
            </dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums">{bucket.people}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
