'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { FailureNotice } from '@/components/ui/failure-notice';
import { HeaderCell, Table, rowClasses } from '@/components/ui/table';
import { describeFailure } from '@/lib/messages';
import { getCoverageByLeader, type ByLeaderRow, type ReportScope } from '@/lib/reports';

const LINK =
  'focus-visible:outline-accent inline-flex min-h-6 items-center underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2';

const SHOWN = 10;
const READ = '200';

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
 * Ten rows a page, with Previous and Next, as the design pages it. **Read 200 at a time**:
 * every request works out the whole month and checks every leader, so Previous and Next page
 * through rows already read rather than doing that again for each ten (checklist row
 * perf-filed-by-leader).
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
  const read = useInfiniteQuery({
    queryKey: ['coverage-by-leader', report, month, scope],
    initialPageParam: null as string | null,
    queryFn: ({ signal, pageParam }) =>
      getCoverageByLeader(report, month, scope, pageParam, signal, READ),
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });

  // The page on screen, from the first. A new report, month or scope starts again at the first.
  const asked = JSON.stringify([report, month, scope]);
  const [shownPage, setShownPage] = useState(0);
  const [shownFor, setShownFor] = useState(asked);
  if (shownFor !== asked) {
    setShownFor(asked);
    setShownPage(0);
  }

  const first = read.data?.pages[0];
  const rows = read.data?.pages.flatMap((loaded) => loaded.data) ?? [];
  // A later read that failed leaves the ten before it on screen, under the failure, and Next
  // asks again.
  if (
    read.isFetchNextPageError &&
    !read.isFetchingNextPage &&
    shownPage > 0 &&
    shownPage * SHOWN >= rows.length
  ) {
    setShownPage(shownPage - 1);
  }
  const start = shownPage * SHOWN;
  const hasNext = start + SHOWN < rows.length || read.hasNextPage;
  // The rows of a later read have not arrived yet.
  const waiting = start >= rows.length && read.hasNextPage;
  const page = {
    isPending: read.isPending || waiting,
    isError: read.isError,
    error: read.error,
    data:
      first === undefined || waiting
        ? undefined
        : { ...first, data: rows.slice(start, start + SHOWN) },
  };

  const next = () => {
    if (start + 2 * SHOWN > rows.length && read.hasNextPage && !read.isFetchingNextPage) {
      void read.fetchNextPage();
    }
    setShownPage(shownPage + 1);
  };

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
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">{row.filed}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{row.owed}</td>
                  </tr>
                ))}
                {page.data.others === null ? null : (
                  <tr className={rowClasses}>
                    <td className="text-muted px-3 py-3">Leaders you don’t oversee</td>
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
              {/*
                Why the Branch screen's Still to record can differ from this table, said where
                its link lands (decisions 0239 and 0298 point 4; owner, 2026-10-05).
              */}
              {report === 'cells'
                ? ' Owed is the whole month’s schedule, meetings still to come included. The Branch screen’s Still to record counts only meetings whose day has come and have no record, and counts the branch as it stands today, so the two can differ.'
                : ' The Branch screen’s Still to record counts the branch as it stands today, so it can differ from this table where somebody changed leader during the month.'}
            </p>

            {shownPage > 0 || hasNext ? (
              <div className="mt-3 flex gap-2">
                <Button
                  variant="secondary"
                  disabled={shownPage === 0}
                  onClick={() => setShownPage(shownPage - 1)}
                >
                  Previous
                </Button>
                <Button variant="secondary" disabled={!hasNext} onClick={next}>
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
