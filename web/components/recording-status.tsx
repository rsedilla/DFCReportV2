'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';

import { RangeNavigator } from '@/components/my-twelve';
import { CONTROL_BAR } from '@/components/ui/frame';
import { FailureNotice } from '@/components/ui/failure-notice';
import { HeaderCell, Table, rowClasses } from '@/components/ui/table';
import { ViewSwitch } from '@/components/ui/view-switch';
import { describeFailure } from '@/lib/messages';
import { rangeGuardMonth, rangeStartOf } from '@/lib/report-range';
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

  const status = useQuery({
    queryKey: ['recording-status', kind, shown],
    queryFn: ({ signal }) =>
      getRecordingStatus(kind, shown, rangeGuardMonth(kind, shown, today), signal),
  });

  const unit = kind === 'WEEK' ? 'week' : 'month';
  const data = status.data;

  return (
    // No heading of its own: the tab above names it (owner, 2026-10-09).
    <section aria-label="Recording status">

      <ViewSwitch
        label="Period"
        even
        className="max-w-xs"
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

      {/* The same ‹ › control as Reports, in the same bar (owner, 2026-10-09). */}
      <div className={`mt-4 ${CONTROL_BAR}`}>
        <RangeNavigator
          kind={kind}
          start={shown}
          current={current}
          open={data?.open}
          onChange={setStart}
        />
      </div>

      <div className="mt-4">
        <FailureNotice failure={status.isError ? describeFailure(status.error) : null} />
      </div>

      {status.isPending ? (
        <p className="text-muted mt-4 text-sm">Loading&hellip;</p>
      ) : data ? (
        <>
          <h3 className="field-label mt-4">Whole Church</h3>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
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
                  // No count in the heading (owner, 2026-10-09).
                  heading={`${table.root.full_name ?? 'A Network root'}’s leaders`}
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
      <span className="text-ink block text-sm font-bold">{label}</span>
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
      return <span>Nothing owed</span>;
  }
}

/** One root's direct leaders, each opening that leader's branch (decision 0325, point 4). */
function LeaderTable({ heading, rows }: { heading: string; rows: readonly RecordingRow[] }) {
  return (
    <div className="mt-6">
      <h3 className="text-base font-bold tracking-tight">{heading}</h3>

      <Table caption={heading} className="mt-2 hidden sm:block">
        <thead>
          <tr>
            {/* The roots' direct disciples are their Primaries (owner, 2026-10-09). */}
            <HeaderCell>Primaries</HeaderCell>
            <HeaderCell>Cell group recorded</HeaderCell>
            <HeaderCell>DCC checklist recorded</HeaderCell>
            <HeaderCell>Status</HeaderCell>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            // Every other row shaded, never numbered (owner, 2026-10-09).
            <tr key={row.leader.id} className={`${rowClasses} even:bg-raised`}>
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

      {/* On a phone each leader is a few short lines, shaded every other row (owner, 2026-10-09). */}
      <ul className="mt-2 flex flex-col sm:hidden">
        {rows.map((row) => (
          <li key={row.leader.id} className="border-line even:bg-raised border-b px-2 py-2">
            <BranchLink row={row} />
            <p className="text-muted text-sm">Cell group recorded: {ofLeaders(row.cell)}</p>
            <p className="text-muted text-sm">DCC checklist recorded: {ofLeaders(row.dcc)}</p>
            <p className="mt-1 text-sm">
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
      // Red, as every Primary's name on Reports (owner, 2026-10-09).
      className="text-accent focus-visible:outline-accent inline-flex min-h-6 items-center underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      {row.leader.full_name ?? row.leader.member_id ?? 'A leader'}
    </Link>
  );
}
