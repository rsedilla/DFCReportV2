'use client';

import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';

import { AppShell, PAGE_WIDTH } from '@/components/app-shell';
import { FailureNotice } from '@/components/ui/failure-notice';
import { HeaderCell, Table, rowClasses } from '@/components/ui/table';
import { ViewSwitch } from '@/components/ui/view-switch';
import { describeFailure } from '@/lib/messages';
import { rangeLabel } from '@/lib/report-range';
import { getChurchCounts, getTrends, type TrendFigure, type Trends } from '@/lib/reports';
import { monthFromQuery } from '@/lib/reporting-month';
import { useScreenAddress } from '@/lib/screen-address';

const FIGURES: readonly { key: TrendFigure; label: string; what: string }[] = [
  { key: 'CG', label: 'CG attendance', what: 'the different people who came to a Cell Group in the month' },
  { key: 'DCC', label: 'DCC attendance', what: 'the different people who came to DCC in the month' },
  { key: 'CELLS', label: 'Number of Cells', what: 'the Cell Groups running on the month’s last day' },
  { key: 'PEOPLE', label: 'Number of people', what: 'everyone in the branch on the month’s last day' },
];

/**
 * The Senior Pastors' *Trends* (SKILL.md sections 17 and 19, decision 0326, point 4): one
 * figure over the last twelve months, one point a month, the current month marked *so far*.
 *
 * **Three lines, or one.** The whole church and each root's branch, named by the pastor with
 * their Network beside (decision 0294); or one leader's branch chosen by name. **One leader is
 * drawn at a time, never two**, so the graph cannot rank them (sections 13 and 17). The lines
 * are told apart by weight, dash and a name at each line's end, not by colour, and the same
 * figures follow in a table. A month a figure could not be read for is a gap, and says so.
 */
export default function TrendsPage() {
  return (
    <AppShell>
      <TrendsScreen />
    </AppShell>
  );
}

function TrendsScreen() {
  const search = useSearchParams();
  const go = useScreenAddress();
  const figure = (FIGURES.find((entry) => entry.key === search.get('figure'))?.key ?? 'CG') as TrendFigure;
  const leader = search.get('leader');
  const chosen = FIGURES.find((entry) => entry.key === figure)!;

  const trends = useQuery({
    queryKey: ['trends', figure, leader],
    queryFn: ({ signal }) => getTrends(figure, leader, signal),
  });
  // The roots' direct leaders for the *Show* list, from this month's tables.
  const roster = useQuery({
    queryKey: ['church-counts', monthFromQuery(null)],
    queryFn: ({ signal }) => getChurchCounts(monthFromQuery(null), signal),
  });

  const data = trends.data;

  return (
    <main id="main" className={PAGE_WIDTH.INDEX}>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Trends</h1>
        <p className="text-muted text-sm">The last 12 months, one point a month.</p>
      </div>

      <ViewSwitch
        label="Report"
        className="mt-4"
        options={FIGURES.map((entry) => ({ key: entry.key, label: entry.label }))}
        value={figure}
        onChange={(next) => go({ figure: next === 'CG' ? null : next })}
      />

      <label htmlFor="trends-show" className="field-label mt-4 block">
        Show
      </label>
      <select
        id="trends-show"
        value={leader ?? ''}
        onChange={(event) => go({ leader: event.target.value === '' ? null : event.target.value })}
        className="border-line bg-surface focus-visible:outline-accent mt-2 min-h-11 w-full max-w-sm rounded-md border px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        <option value="">Whole Church and each Network root&rsquo;s branch</option>
        {(roster.data?.tables ?? []).map((table) => (
          <optgroup
            key={table.root.id}
            label={`${table.root.full_name ?? 'A Network root'}’s ${table.rows.length} leaders`}
          >
            {table.rows.map((row) => (
              <option key={row.leader.id} value={row.leader.id}>
                {row.leader.full_name ?? row.leader.member_id}
              </option>
            ))}
          </optgroup>
        ))}
      </select>

      <div className="mt-4">
        <FailureNotice failure={trends.isError ? describeFailure(trends.error) : null} />
      </div>

      {trends.isPending ? (
        <p className="text-muted mt-4 text-sm">Loading&hellip;</p>
      ) : data ? (
        <TrendsChart data={data} label={chosen.label} what={chosen.what} />
      ) : null}
    </main>
  );
}

/** How a line is named: the church, a root's branch by its pastor, or one leader's branch. */
function lineName(line: Trends['lines'][number], index: number, single: boolean): string {
  if (line.leader === null) {
    return 'Whole Church';
  }
  const name = line.leader.full_name ?? line.leader.member_id ?? 'A leader';
  if (single) {
    return name;
  }
  // The second line is the Men's root's branch and the third the Women's (decision 0326).
  return `${name} · ${index === 1 ? 'Men’s' : 'Women’s'}`;
}

function TrendsChart({ data, label, what }: { data: Trends; label: string; what: string }) {
  const single = data.lines.length === 1;
  const lines = data.lines.map((line, index) => ({
    name: lineName(line, index, single),
    values: line.values,
    // Told apart by weight and dash, never by colour (decision 0326, point 4).
    width: index === 0 ? 3 : 1.75,
    dash: index === 2 ? '6 4' : undefined,
  }));
  const short = (month: string) =>
    new Date(`${month}T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });

  const W = 720;
  const H = 260;
  const left = 48;
  const right = 170;
  const top = 16;
  const bottom = 32;
  const known = lines.flatMap((line) => line.values.filter((value): value is number => value !== null));
  const max = Math.max(10, ...known) * 1.08;
  const x = (i: number) => left + (i * (W - left - right)) / (data.months.length - 1);
  const y = (v: number) => top + (H - top - bottom) * (1 - v / max);
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((v) => v >= raw)!;
  const ticks = Array.from({ length: Math.floor(max / step) + 1 }, (_, i) => i * step);
  const last = data.months.length - 1;
  const gaps = data.months.filter((_, i) => lines.some((line) => line.values[i] === null));

  /** Runs of months with a value, so a month that could not be read is a gap in the line. */
  const runs = (values: (number | null)[]) => {
    const out: { i: number; v: number }[][] = [];
    values.forEach((v, i) => {
      if (v === null) {
        return;
      }
      const run = out[out.length - 1];
      if (run && run[run.length - 1].i === i - 1) {
        run.push({ i, v });
      } else {
        out.push([{ i, v }]);
      }
    });
    return out;
  };

  return (
    <section aria-labelledby="trends-heading" className="mt-4">
      <h2 id="trends-heading" className="text-base font-bold tracking-tight">
        {label}
        {single ? ` · ${lines[0].name} and their branch` : null}
      </h2>
      <p className="text-muted text-xs">Each point counts {what}.</p>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="text-ink mt-2 w-full"
        role="img"
        aria-label={`${label}, ${rangeLabel('MONTH', data.months[0])} to ${rangeLabel('MONTH', data.months[last])}: ${lines.map((line) => line.name).join(', ')}. The figures follow in a table.`}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={left} x2={W - right} y1={y(t)} y2={y(t)} className="text-line" stroke="currentColor" />
            <text x={left - 6} y={y(t) + 4} textAnchor="end" className="text-muted fill-current text-[11px]">
              {t.toLocaleString()}
            </text>
          </g>
        ))}
        {data.months.map((month, i) => (
          <text key={month} x={x(i)} y={H - 10} textAnchor="middle" className="text-muted fill-current text-[11px]">
            {short(month)}
          </text>
        ))}
        {lines.map((line) => {
          const end = line.values[last];

          return (
            <g key={line.name}>
              {runs(line.values).map((run) => (
                <polyline
                  key={run[0].i}
                  points={run.map((p) => `${x(p.i)},${y(p.v)}`).join(' ')}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={line.width}
                  strokeDasharray={line.dash}
                />
              ))}
              {line.values.map((v, i) =>
                v === null || i === last ? null : (
                  <circle key={i} cx={x(i)} cy={y(v)} r={2.5} fill="currentColor" />
                ),
              )}
              {end === null ? null : (
                <>
                  {/* The current month is open, so its point is hollow. */}
                  <circle cx={x(last)} cy={y(end)} r={3.5} className="fill-surface" stroke="currentColor" strokeWidth={1.5} />
                  <text x={W - right + 8} y={y(end) + 4} className="fill-current text-[12px] font-bold">
                    {line.name}
                  </text>
                </>
              )}
            </g>
          );
        })}
      </svg>
      <p className="text-muted text-xs">
        The hollow point is {rangeLabel('MONTH', data.months[last])}, still open, so far.
        {gaps.length > 0 ? ' A gap is a month this figure could not be read for.' : ''}
      </p>

      <Table caption={`${label} by month`} className="mt-4">
        <thead>
          <tr>
            <HeaderCell>Month</HeaderCell>
            {lines.map((line) => (
              <HeaderCell key={line.name} className="text-right">
                {line.name}
              </HeaderCell>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.months.map((month, i) => (
            <tr key={month} className={rowClasses}>
              <td className="px-3 py-1.5">
                {rangeLabel('MONTH', month)}
                {i === last ? <span className="text-muted text-xs"> · so far</span> : null}
              </td>
              {lines.map((line, index) => (
                <td
                  key={line.name}
                  className={`px-3 py-1.5 text-right tabular-nums${index === 0 ? ' font-bold' : ''}`}
                >
                  {line.values[i] === null ? (
                    <span className="text-muted">could not be read</span>
                  ) : (
                    line.values[i]!.toLocaleString()
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </Table>
    </section>
  );
}
