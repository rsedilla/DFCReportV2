'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { FailureNotice } from '@/components/ui/failure-notice';
import { HeaderCell, Table, rowClasses } from '@/components/ui/table';
import { describeFailure } from '@/lib/messages';
import { getCoverageByLeader, type ByLeaderRow, type ReportScope } from '@/lib/reports';

const LINK =
  'focus-visible:outline-accent inline-flex min-h-6 items-center underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2';

/**
 * A report's coverage, one row per leader who owns an obligation in it (SKILL.md section 17,
 * decision 0254; the owner's design, adjusted to the rules).
 *
 * **Each row counts that leader's own obligations**, so the rows, the unnamed line and the
 * total add up. The reader comes first, then everyone else by name: never ordered by how far
 * behind anybody is, never coloured, never "N behind" (section 13). A name opens that
 * leader's report for the same month, the leader carried in the address so Back returns.
 *
 * **The report it opens counts the leader's whole branch**, so its figures can be larger than
 * the row — which the table says, rather than letting a reader find it.
 *
 * Ten rows a page, with Previous and Next, as the design pages it.
 */
export function CoverageByLeader({
  report,
  month,
  scope,
  unit,
}: {
  report: 'dcc' | 'cells';
  month: string;
  scope: ReportScope;
  unit: string;
}) {
  // A stack of the cursors that opened each page, so Previous returns to the one before.
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const cursor = cursors[cursors.length - 1];

  const page = useQuery({
    queryKey: ['coverage-by-leader', report, month, scope, cursor],
    queryFn: ({ signal }) => getCoverageByLeader(report, month, scope, cursor, signal),
  });

  const openHref = (row: ByLeaderRow) =>
    `/reports/${report}?${new URLSearchParams({ month, leader: row.leader.id }).toString()}`;

  return (
    <div className="mt-4">
      <FailureNotice failure={page.isError ? describeFailure(page.error) : null} />

      {page.isPending ? (
        <p className="text-muted text-sm">Loading&hellip;</p>
      ) : page.data ? (
        page.data.data.length === 0 && page.data.others === null ? (
          <p className="text-muted max-w-2xl text-sm leading-relaxed">
            Nobody owed any {unit} in this report this month.
          </p>
        ) : (
          <>
            <Table caption={`Recording coverage by leader, ${unit}`}>
              <thead>
                <tr>
                  <HeaderCell>Leader</HeaderCell>
                  <HeaderCell className="text-right">Filed</HeaderCell>
                  <HeaderCell className="text-right">Owed</HeaderCell>
                </tr>
              </thead>
              <tbody>
                {page.data.data.map((row) => (
                  <tr key={row.leader.id} className={rowClasses}>
                    <td className="px-3 py-3">
                      <Link href={openHref(row)} className={`${LINK} text-accent font-medium`}>
                        {row.leader.full_name}
                      </Link>
                      <div className="text-muted text-xs">{row.leader.member_id}</div>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">{row.filed}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{row.owed}</td>
                  </tr>
                ))}
                {page.data.others === null ? null : (
                  <tr className={rowClasses}>
                    <td className="text-muted px-3 py-3">Leaders outside your reach</td>
                    <td className="px-3 py-3 text-right tabular-nums">{page.data.others.filed}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{page.data.others.owed}</td>
                  </tr>
                )}
                <tr className="border-edge border-t-2 font-semibold">
                  <td className="px-3 py-3">Report coverage</td>
                  <td className="px-3 py-3 text-right tabular-nums">{page.data.total.filed}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{page.data.total.owed}</td>
                </tr>
              </tbody>
            </Table>

            <p className="text-muted mt-3 max-w-2xl text-sm leading-relaxed">
              You first, then by name. Each row counts only that leader&rsquo;s own {unit}, so the
              rows add up to the total. A leader&rsquo;s own report counts their whole branch, so
              its figures can be larger than their row.
            </p>

            {cursors.length > 1 || page.data.next_cursor !== null ? (
              <div className="mt-3 flex gap-2">
                <Button
                  variant="secondary"
                  disabled={cursors.length === 1}
                  onClick={() => setCursors((stack) => stack.slice(0, -1))}
                >
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  disabled={page.data.next_cursor === null}
                  onClick={() => {
                    const next = page.data?.next_cursor;
                    if (next) {
                      setCursors((stack) => [...stack, next]);
                    }
                  }}
                >
                  Next
                </Button>
              </div>
            ) : null}
          </>
        )
      ) : null}
    </div>
  );
}

/**
 * The design's "By Sunday / By Cell | By leader" switch over a report's coverage rows.
 * A radio group rather than two buttons, so a screen reader hears one choice of two.
 */
export function CoverageSwitch({
  first,
  value,
  onChange,
}: {
  first: string | null;
  value: 'first' | 'leader';
  onChange: (value: 'first' | 'leader') => void;
}) {
  if (first === null) {
    return null;
  }

  const option = (key: 'first' | 'leader', label: string) => (
    <label
      className={`focus-within:outline-accent flex min-h-11 cursor-pointer items-center gap-2 border px-3 text-sm focus-within:outline-2 focus-within:outline-offset-2 ${
        value === key ? 'border-ink bg-ink text-surface' : 'border-line'
      }`}
    >
      <input
        type="radio"
        name="coverage-by"
        className="sr-only"
        checked={value === key}
        onChange={() => onChange(key)}
      />
      {label}
    </label>
  );

  return (
    <div role="radiogroup" aria-label="Group coverage by" className="mt-4 inline-flex">
      {option('first', first)}
      {option('leader', 'By leader')}
    </div>
  );
}
