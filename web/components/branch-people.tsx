'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';

import { asAt } from '@/components/church-counts';
import { RangeNavigator } from '@/components/my-twelve';
import { CONTROL_BAR } from '@/components/ui/frame';
import { FailureNotice } from '@/components/ui/failure-notice';
import { HeaderCell, Table, rowClasses } from '@/components/ui/table';
import { TextLink } from '@/components/ui/text-link';
import { describeFailure } from '@/lib/messages';
import { getPerson } from '@/lib/people';
import { monthFromQuery } from '@/lib/reporting-month';
import { getBranchPeople } from '@/lib/reports';
import { useScreenAddress } from '@/lib/screen-address';

/**
 * A Full view leader's *# of People*, under Reports (decisions 0364 and 0376): the Senior Pastors' figure
 * one level down, for the reader's own branch or a leader beneath them.
 *
 * **A month at a time**, counted as theirs is: a month that has ended on its last day, the
 * current one as of now, *so far*. The box is everyone in the branch, then one row per direct
 * disciple counting them and everyone beneath them, then the leader's own row, adding up to
 * the box. Rows are in first-name order, never sorted by a figure, never numbered or coloured
 * (sections 13 and 17). A name opens that leader's branch here, as the attendance reports do.
 */
export function BranchPeoplePanel({
  readerId,
  leader,
  month: asked,
}: {
  readerId: string;
  /** A leader opened from a row, or null for the reader's own branch. */
  leader: string | null;
  /** The month in the address, as the first of it. */
  month: string | null;
}) {
  const go = useScreenAddress();
  const current = monthFromQuery(null);
  // A month that has not begun is not reported (decision 0216); the address opens this one.
  const month = monthFromQuery(asked);
  const subject = leader ?? readerId;

  const counts = useQuery({
    queryKey: ['branch-people', subject, month],
    queryFn: ({ signal }) => getBranchPeople(subject, month, signal),
  });
  const opened = useQuery({
    queryKey: ['person', leader],
    queryFn: ({ signal }) => getPerson(leader!, signal),
    enabled: leader !== null,
  });
  const name = leader === null ? null : (opened.data?.full_name ?? 'This leader');
  const heading = name === null ? 'Your Disciples' : `${name}’s Disciples`;
  const data = counts.data;

  return (
    <section aria-label="Number of People">
      <div className={`mt-4 ${CONTROL_BAR}`}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <RangeNavigator
            kind="MONTH"
            start={month}
            current={current}
            open={undefined}
            onChange={(value) => go({ month: value })}
          />
          <span className="text-muted text-sm" aria-live="polite">
            {asAt(month, month === current)}
          </span>
        </div>
      </div>

      {leader !== null ? (
        <p className="mt-4 text-sm">
          <TextLink href={month === current ? '/reports/number-of-people' : `/reports/number-of-people?month=${month}`}>
            Back to your disciples
          </TextLink>
        </p>
      ) : null}

      <div className="mt-4">
        <FailureNotice failure={counts.isError ? describeFailure(counts.error) : null} />
      </div>

      {counts.isPending ? (
        <p className="text-muted mt-4 text-sm">Loading&hellip;</p>
      ) : data ? (
        data.total === null || data.rows === null ? (
          <p className="text-muted mt-6 max-w-2xl text-sm leading-relaxed">
            This month cannot be counted: the pastoral tree it resolves holds a fault that needs
            repair.
          </p>
        ) : (
          <>
            <h2 className="field-label mt-4">{heading}</h2>
            <dl className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div className="border-line border p-3">
                <dt className="text-ink text-sm font-bold">People</dt>
                <dd className="mt-1 text-xl font-bold tabular-nums">{data.total.toLocaleString()}</dd>
              </div>
            </dl>

            <Table caption={name === null ? 'Your 12' : `${name}’s 12`} className="mt-6">
              <thead>
                <tr>
                  <HeaderCell style={{ width: '70%' }}>Leader</HeaderCell>
                  <HeaderCell className="text-right" style={{ width: '30%' }}>
                    People
                  </HeaderCell>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row, index) => (
                  // Every other row shaded, to follow a row across, never numbered (owner, 2026-10-09).
                  <tr key={row.leader?.id ?? `unnamed-${index}`} className={`${rowClasses} even:bg-raised`}>
                    <td className="px-3 py-3">
                      {row.leader === null ? (
                        <span className="text-muted">A leader not named here</span>
                      ) : (
                        <Link
                          href={
                            month === current
                              ? `/reports/number-of-people?leader=${row.leader.id}`
                              : `/reports/number-of-people?month=${month}&leader=${row.leader.id}`
                          }
                          className="text-accent focus-visible:outline-accent inline-flex min-h-6 items-center underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
                        >
                          {row.leader.full_name ?? row.leader.member_id ?? 'A leader'}
                        </Link>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">{row.people}</td>
                  </tr>
                ))}
                <tr className={rowClasses}>
                  <td className="px-3 py-3">{name === null ? 'You' : name}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{data.own}</td>
                </tr>
                <tr className="border-ink border-t-2">
                  <td className="px-3 py-3 font-bold">Total</td>
                  <td className="px-3 py-3 text-right font-bold tabular-nums">{data.total}</td>
                </tr>
              </tbody>
            </Table>
          </>
        )
      ) : null}
    </section>
  );
}
