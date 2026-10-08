'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { FailureNotice } from '@/components/ui/failure-notice';
import { HeaderCell, Table, rowClasses } from '@/components/ui/table';
import { ViewSwitch } from '@/components/ui/view-switch';
import { describeFailure } from '@/lib/messages';
import { rangeGuardMonth, rangeLabel, rangeStartOf, shiftRange } from '@/lib/report-range';
import { todayInManila } from '@/lib/reporting-month';
import {
  getRecordingStatus,
  type RecordingColumn,
  type RecordingRow,
  type RecordingRowStatus,
} from '@/lib/reports';

type Kind = 'WEEK' | 'MONTH';

/**
 * The Senior Pastors' *Recording status* (SKILL.md section 19, decision 0325): whether the
 * church has recorded, for a week or a month, opening on the current week.
 *
 * **Every figure is the server's**, the two percentages included: the boxes are the only
 * recording figures shown as a percentage (point 3), and the client divides nothing. Rows
 * come in surname order and are never sorted by a figure.
 *
 * **Completed is a pale red label** (point 5), an exception to sections 13, 17 and 19 for
 * this word on this screen alone; the word carries the meaning without the colour.
 */
export function RecordingStatusPanel() {
  const today = todayInManila();
  const [kind, setKind] = useState<Kind>('WEEK');
  const current = rangeStartOf(kind, today);
  const [start, setStart] = useState(current);
  const shown = rangeStartOf(kind, start);
  const isCurrent = shown === current;

  const status = useQuery({
    queryKey: ['recording-status', kind, shown],
    queryFn: ({ signal }) =>
      getRecordingStatus(kind, shown, rangeGuardMonth(kind, shown, today), signal),
  });

  const unit = kind === 'WEEK' ? 'week' : 'month';
  const data = status.data;

  return (
    <section aria-labelledby="recording-status-heading">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 id="recording-status-heading" className="text-lg font-bold tracking-tight">
          Recording status
        </h2>
        <p className="text-muted text-sm">Which leaders have recorded what they owe.</p>
      </div>

      <ViewSwitch
        label="Period"
        options={[
          { key: 'WEEK', label: 'Week' },
          { key: 'MONTH', label: 'Month' },
        ]}
        value={kind}
        onChange={(next) => {
          setKind(next);
          setStart(rangeStartOf(next, today));
        }}
      />

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button variant="secondary" onClick={() => setStart(shiftRange(kind, shown, -1))}>
          Previous {unit}
        </Button>
        <p className="text-sm font-bold" aria-live="polite">
          {rangeLabel(kind, shown)}
          {data ? (
            <span className="text-muted font-normal">
              {' '}
              · {data.open ? 'still open' : 'closed'}
            </span>
          ) : null}
        </p>
        <Button
          variant="secondary"
          disabled={isCurrent}
          onClick={() => setStart(shiftRange(kind, shown, 1))}
        >
          Next {unit}
        </Button>
      </div>

      <div className="mt-4">
        <FailureNotice failure={status.isError ? describeFailure(status.error) : null} />
      </div>

      {status.isPending ? (
        <p className="text-muted mt-4 text-sm">Loading&hellip;</p>
      ) : data ? (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <WholeChurchBox
              label="Recorded their Cell group"
              column={data.whole_church.cell}
              previous={data.previous.cell}
              previousName={previousName(kind, data.previous.open)}
            />
            <WholeChurchBox
              label="Recorded their DCC checklist"
              column={data.whole_church.dcc}
              previous={data.previous.dcc}
              previousName={previousName(kind, data.previous.open)}
            />
          </div>

          {data.tables === null ? (
            <p className="text-muted mt-6 max-w-2xl text-sm leading-relaxed">
              The leaders&rsquo; tables cannot be shown for this {unit}: the pastoral tree it
              resolves holds a fault that needs repair. The two figures above stand.
            </p>
          ) : (
            <>
              {data.tables.map((table) => (
                <LeaderTable
                  key={table.root.id}
                  heading={`${table.root.full_name ?? 'A Network root'}’s ${table.rows.length} ${
                    table.rows.length === 1 ? 'leader' : 'leaders'
                  }`}
                  rows={table.rows}
                />
              ))}
              {data.others ? (
                <div className="mt-6">
                  <h3 className="text-base font-bold tracking-tight">Others</h3>
                  <p className="text-muted mt-1 max-w-2xl text-sm">
                    The two Network roots, and any leader who owed a record and sits in neither
                    table.
                  </p>
                  <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
                    <dt className="text-muted">Cell group recorded</dt>
                    <dd>{ofLeaders(data.others.cell)}</dd>
                    <dt className="text-muted">DCC checklist recorded</dt>
                    <dd>{ofLeaders(data.others.dcc)}</dd>
                    <dt className="text-muted">Status</dt>
                    <dd>
                      <StatusLabel status={data.others.status} />
                    </dd>
                  </dl>
                </div>
              ) : null}
            </>
          )}

          <p className="mt-8 text-sm">
            <Link
              href="/reports/filed?behind=1"
              className="text-accent focus-visible:outline-accent inline-flex min-h-6 items-center underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              See which Cells are behind
            </Link>
          </p>
        </>
      ) : null}
    </section>
  );
}

function previousName(kind: Kind, open: boolean): string {
  const name = kind === 'WEEK' ? 'Last week' : 'Last month';

  return open ? `${name} (still open)` : name;
}

function ofLeaders(column: RecordingColumn): string {
  return `${column.recorded} of ${column.owed} ${column.owed === 1 ? 'leader' : 'leaders'}`;
}

/** A Whole Church box: X of Y leaders, the server's percentage, and the period before. */
function WholeChurchBox({
  label,
  column,
  previous,
  previousName,
}: {
  label: string;
  column: RecordingColumn & { percent: number | null };
  previous: RecordingColumn;
  previousName: string;
}) {
  return (
    <div className="border-line border p-3">
      <span className="text-muted block text-sm">
        {label} · Whole Church
      </span>
      <span className="mt-1 block text-xl font-bold tabular-nums">
        {ofLeaders(column)}
        {column.percent === null ? null : ` · ${column.percent}%`}
      </span>
      <span className="text-muted mt-1 block text-xs">
        {previousName}: {ofLeaders(previous)}
      </span>
    </div>
  );
}

function StatusLabel({ status }: { status: RecordingRowStatus }) {
  switch (status.kind) {
    case 'COMPLETED':
      return (
        <span className="bg-accent-tint text-accent inline-block px-2 py-0.5 text-xs font-bold tracking-[0.08em] uppercase">
          Completed
        </span>
      );
    case 'STILL_TO_RECORD':
      return (
        <span>
          {status.leaders} {status.leaders === 1 ? 'leader' : 'leaders'} still to record
        </span>
      );
    case 'NOTHING_OWED':
      return <span className="text-muted">Nothing owed</span>;
  }
}

/** One root's direct leaders, each opening that leader's branch (decision 0325, point 4). */
function LeaderTable({ heading, rows }: { heading: string; rows: readonly RecordingRow[] }) {
  return (
    <div className="mt-6">
      <h3 className="text-base font-bold tracking-tight">{heading}</h3>

      <Table caption={heading} className="mt-2 hidden lg:block">
        <thead>
          <tr>
            <HeaderCell>Leader</HeaderCell>
            <HeaderCell>Cell group recorded</HeaderCell>
            <HeaderCell>DCC checklist recorded</HeaderCell>
            <HeaderCell>Status</HeaderCell>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.leader.id} className={rowClasses}>
              <td className="px-3 py-3 align-top">
                <BranchLink row={row} />
              </td>
              <td className="px-3 py-3 align-top tabular-nums">{ofLeaders(row.cell)}</td>
              <td className="px-3 py-3 align-top tabular-nums">{ofLeaders(row.dcc)}</td>
              <td className="px-3 py-3 align-top">
                <StatusLabel status={row.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </Table>

      <ul className="mt-2 flex flex-col gap-3 lg:hidden">
        {rows.map((row) => (
          <li key={row.leader.id} className="border-line border p-4">
            <BranchLink row={row} />
            <p className="text-muted mt-1 text-sm">Cell group recorded: {ofLeaders(row.cell)}</p>
            <p className="text-muted text-sm">DCC checklist recorded: {ofLeaders(row.dcc)}</p>
            <p className="mt-2 text-sm">
              <StatusLabel status={row.status} />
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function BranchLink({ row }: { row: RecordingRow }) {
  return (
    <Link
      href={`/network?focus=${row.leader.id}`}
      className="focus-visible:outline-accent inline-flex min-h-6 items-center underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      {row.leader.full_name ?? row.leader.member_id ?? 'A leader'}
    </Link>
  );
}
