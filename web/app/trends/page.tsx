'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { AppShell, PAGE_WIDTH } from '@/components/app-shell';
import { FailureNotice } from '@/components/ui/failure-notice';
import { CONTROL_BAR, TAB_PANE, TAB_ROW } from '@/components/ui/frame';
import { HeaderCell, Table, rowClasses } from '@/components/ui/table';
import { ViewSwitch } from '@/components/ui/view-switch';
import { describeFailure } from '@/lib/messages';
import { cn } from '@/lib/utils';
import { rangeLabel } from '@/lib/report-range';
import { getChurchCounts, getTrends, type TrendFigure, type Trends } from '@/lib/reports';
import { monthFromQuery } from '@/lib/reporting-month';
import { useScreenAddress } from '@/lib/screen-address';

/** The same five names as Reports (owner, 2026-10-09); a `#` label keeps its words as its name. */
const FIGURES: readonly { key: TrendFigure; label: string; name?: string; what: string }[] = [
  { key: 'CG', label: 'CG attendance', what: 'the different people who came to a Cell Group in the month' },
  { key: 'DCC', label: 'DCC attendance', what: 'the different people who came to DCC in the month' },
  { key: 'CELLS', label: '# of Cells', name: 'Number of Cells', what: 'the Cell Groups running on the month’s last day' },
  {
    key: 'CELL_LEADERS',
    label: '# of Cell Leaders',
    name: 'Number of Cell Leaders',
    what: 'the people leading a Cell on the month’s last day',
  },
  { key: 'PEOPLE', label: '# of people', name: 'Number of people', what: 'everyone in the branch on the month’s last day' },
];

/**
 * The Senior Pastors' *Trends* (SKILL.md sections 17 and 19, decision 0326, point 4): one
 * figure over the last twelve months, one point a month, the current month marked *so far*.
 *
 * **Three lines, or one.** The whole church and each root's branch, named by the pastor with
 * their Network beside (decision 0294); or one leader's branch chosen by name. **One leader is
 * drawn at a time, never two**, so the graph cannot rank them (sections 13 and 17). The lines
 * are told apart by weight and dash, and by colour beside them (owner, 2026-10-09): green the
 * church, blue the Men's root's branch, pink the Women's, a single leader's line in ink. Named in a key above the graph
 * rather than at their ends, where two lines ending on one value overlapped (owner,
 * 2026-10-09); the same figures follow in a table. A month a figure could not be read for is a gap, and says so.
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
  // One Primary takes their pastor's branch colour, blue or pink (owner, 2026-10-09).
  const leaderTable = (roster.data?.tables ?? []).find((table) =>
    table.rows.some((row) => row.leader.id === leader),
  );
  const singleTone =
    leaderTable === undefined
      ? 'text-ink'
      : leaderTable.network === 'WOMENS'
        ? 'text-chart-pink'
        : 'text-chart-blue';

  return (
    <main id="main" className={PAGE_WIDTH.INDEX}>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Trends</h1>
        <p className="text-muted text-sm">The last 12 months, one point a month.</p>
      </div>

      {/* The same tabs and red pane as Reports (owner, 2026-10-09), so the two read as one kind
          of page. Links, as on Reports: each figure keeps an address of its own. */}
      <nav aria-label="Which figure" className={cn('mt-6 grid grid-cols-2 sm:grid-cols-5', TAB_ROW)}>
        {FIGURES.map((entry) => {
          const active = entry.key === figure;
          const query = new URLSearchParams({
            ...(entry.key === 'CG' ? {} : { figure: entry.key }),
            ...(leader ? { leader } : {}),
          }).toString();

          return (
            <Link
              key={entry.key}
              href={query ? `/trends?${query}` : '/trends'}
              aria-current={active ? 'page' : undefined}
              aria-label={entry.name}
              className={cn(
                'focus-visible:outline-accent inline-flex min-h-11 items-center justify-center border border-b-0 px-3 py-2 text-center',
                'text-xs font-bold tracking-[0.08em] uppercase focus-visible:outline-2 focus-visible:-outline-offset-2',
                active ? 'bg-accent text-surface border-accent' : 'border-line text-ink hover:bg-raised',
              )}
            >
              {entry.label}
            </Link>
          );
        })}
      </nav>
      <div className={TAB_PANE}>
        <div className={`mt-4 ${CONTROL_BAR}`}>
          <div>
            <label htmlFor="trends-show" className="field-label block">
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
                  label={`${table.root.full_name ?? 'A Network root'}’s leaders`}
                >
                  {table.rows.map((row) => (
                    <option key={row.leader.id} value={row.leader.id}>
                      {row.leader.full_name ?? row.leader.member_id}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-4">
          <FailureNotice failure={trends.isError ? describeFailure(trends.error) : null} />
        </div>

        {trends.isPending ? (
          <p className="text-muted mt-4 text-sm">Loading&hellip;</p>
        ) : data ? (
          <TrendsChart
          data={data}
          label={chosen.name ?? chosen.label}
          what={chosen.what}
          singleTone={singleTone}
        />
        ) : null}
      </div>
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

type Kind = 'LINE' | 'BARS';

/** What a viewer last chose, on this device only (owner, 2026-10-09); a blocked store is ignored. */
function remembered<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function remember(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private windows and blocked storage: the choice simply is not kept.
  }
}

function TrendsChart({
  data,
  label,
  what,
  singleTone,
}: {
  data: Trends;
  label: string;
  what: string;
  /** One leader's colour: their pastor's branch, or ink for a leader in neither table. */
  singleTone: string;
}) {
  const [shown, setShown] = useState(false);
  const frame = useRef<HTMLDivElement>(null);
  const [drawn, setDrawn] = useState(720);
  // Line or bars, and which of the three are ticked, kept on this device (owner, 2026-10-09).
  // Read when the graph first draws, which is only ever in the browser, after its figures load.
  const [kind, setKind] = useState<Kind>(() =>
    remembered<Kind>('trends-kind', 'LINE') === 'BARS' ? 'BARS' : 'LINE',
  );
  const [hidden, setHidden] = useState<number[]>(() => {
    const stored = remembered<unknown>('trends-hidden', []);
    const kept = Array.isArray(stored) ? stored.filter((n): n is number => n === 0 || n === 1 || n === 2) : [];
    // A stored choice hiding all three is ignored, so the graph is never empty.
    return new Set(kept).size >= 3 ? [] : kept;
  });
  useEffect(() => {
    const element = frame.current;
    if (!element) {
      return;
    }
    const observer = new ResizeObserver(([entry]) =>
      setDrawn(Math.max(280, Math.round(entry.contentRect.width))),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const single = data.lines.length === 1;
  const all = data.lines.map((line, index) => ({
    index,
    name: lineName(line, index, single),
    values: line.values,
    // Lines are told apart by weight and dash as well as colour, because lines cross (1.4.1).
    // Bars are solid and always in this order, the key's, with the figures one click away.
    width: index === 0 ? 3 : 1.75,
    dash: index === 2 ? '6 4' : undefined,
    tone: single ? singleTone : (['text-chart-green', 'text-chart-blue', 'text-chart-pink'][index] ?? 'text-ink'),
  }));
  // One always stays ticked, so the graph is never empty.
  const lines = single ? all : all.filter((line) => !hidden.includes(line.index));
  const toggle = (index: number) => {
    const next = hidden.includes(index) ? hidden.filter((n) => n !== index) : [...hidden, index];
    if (next.length >= all.length) {
      return;
    }
    setHidden(next);
    remember('trends-hidden', next);
  };
  const short = (month: string) =>
    new Date(`${month}T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });

  // Drawn at the width it is shown at, so its labels stay 12px on a phone rather than
  // shrinking with a fixed drawing (owner's request to tidy, 2026-10-09).
  const W = drawn;
  const H = W < 520 ? 220 : 260;
  const narrow = W < 520;
  const left = 48;
  const right = 16;
  const top = 16;
  const bottom = 32;
  const known = lines.flatMap((line) => line.values.filter((value): value is number => value !== null));
  const max = Math.max(10, ...known) * 1.08;
  // Each month has a slot of its own, so a bar group and a point sit in the same place.
  const slot = (W - left - right) / data.months.length;
  const x = (i: number) => left + slot * (i + 0.5);
  const y = (v: number) => top + (H - top - bottom) * (1 - v / max);
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((v) => v >= raw)!;
  const ticks = Array.from({ length: Math.floor(max / step) + 1 }, (_, i) => i * step);
  const last = data.months.length - 1;
  const gaps = data.months.filter((_, i) => lines.some((line) => line.values[i] === null));
  const group = slot * 0.72;
  const barWidth = group / lines.length;

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
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="trends-heading" className="text-base font-bold tracking-tight">
            {label}
            {single ? ` · ${all[0].name} and their branch` : null}
          </h2>
          <p className="text-muted text-xs">Each point counts {what}.</p>
        </div>
        <ViewSwitch
          label="Graph"
          className="mt-0"
          options={[
            { key: 'LINE', label: 'Line' },
            { key: 'BARS', label: 'Bars' },
          ]}
          value={kind}
          onChange={(next) => {
            setKind(next);
            remember('trends-kind', next);
          }}
        />
      </div>

      {single ? null : (
        <fieldset className="mt-3">
          <legend className="sr-only">Show on the graph</legend>
          <div className="flex flex-wrap gap-x-6 text-sm">
            {all.map((line) => {
              const ticked = !hidden.includes(line.index);

              return (
                <label key={line.name} className="flex min-h-11 cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    className="accent-accent size-5"
                    checked={ticked}
                    // The last one ticked stays ticked (toggle refuses it), so the graph is never
                    // empty; not greyed out, which reads as broken.
                    onChange={() => toggle(line.index)}
                  />
                  <svg width="32" height="12" aria-hidden="true" className={`${line.tone} shrink-0`}>
                    {kind === 'LINE' ? (
                      <line
                        x1="0"
                        x2="32"
                        y1="6"
                        y2="6"
                        stroke="currentColor"
                        strokeWidth={line.width}
                        strokeDasharray={line.dash}
                      />
                    ) : (
                      <rect x="9" y="1" width="14" height="10" fill="currentColor" />
                    )}
                  </svg>
                  {line.name}
                </label>
              );
            })}
          </div>
        </fieldset>
      )}

      <div ref={frame} className="mt-2 w-full">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width={W}
          height={H}
          className="text-ink block max-w-full"
          role="img"
          aria-label={`${label}, ${rangeLabel('MONTH', data.months[0])} to ${rangeLabel('MONTH', data.months[last])}: ${lines.map((line) => line.name).join(', ')}. The figures are under Show the figures.`}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={left} x2={W - right} y1={y(t)} y2={y(t)} className="text-line" stroke="currentColor" />
              <text x={left - 6} y={y(t) + 4} textAnchor="end" className="text-muted fill-current text-[12px]">
                {t.toLocaleString()}
              </text>
            </g>
          ))}
          {data.months.map((month, i) =>
            // On a phone every other month is named, and always the last, so the names never touch.
            narrow && (last - i) % 2 === 1 ? null : (
              <text key={month} x={x(i)} y={H - 10} textAnchor="middle" className="text-muted fill-current text-[12px]">
                {short(month)}
              </text>
            ),
          )}
          {kind === 'BARS'
            ? lines.map((line, k) => (
                <g key={line.name} className={line.tone}>
                  {line.values.map((v, i) =>
                    v === null || v === 0 ? null : (
                      <rect
                        key={i}
                        x={x(i) - group / 2 + k * barWidth + 1}
                        y={y(v)}
                        width={Math.max(2, barWidth - 2)}
                        height={y(0) - y(v)}
                        fill="currentColor"
                        stroke="currentColor"
                        // The current month is open, so its bar is a lighter shade with a solid edge.
                        fillOpacity={i === last ? 0.45 : 1}
                      />
                    ),
                  )}
                </g>
              ))
            : lines.map((line) => {
                const end = line.values[last];

                return (
                  <g key={line.name} className={line.tone}>
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
                    {/* The current month is open, so its point is hollow. */}
                    {end === null ? null : (
                      <circle cx={x(last)} cy={y(end)} r={3.5} className="fill-surface" stroke="currentColor" strokeWidth={1.5} />
                    )}
                  </g>
                );
              })}
        </svg>
      </div>
      <p className="text-muted text-xs">
        {kind === 'LINE' ? 'The hollow point is' : 'The lighter bars are'}{' '}
        {rangeLabel('MONTH', data.months[last])}, still open, so far.
        {gaps.length > 0 ? ' A gap is a month this figure could not be read for.' : ''}
      </p>

      {/* The graph alone until the reader asks for the figures (owner, 2026-10-09): the table
          is the graph's text alternative (1.1.1) and the exact figure where two lines meet. */}
      <details className="mt-4" onToggle={(event) => setShown(event.currentTarget.open)}>
        <summary className="border-edge focus-visible:outline-accent inline-flex min-h-11 cursor-pointer items-center rounded-md border px-3.5 text-sm focus-visible:outline-2 focus-visible:outline-offset-2">
          {shown ? 'Hide the figures' : 'Show the figures'}
        </summary>
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
                {lines.map((line) => (
                  <td
                    key={line.name}
                    className={`px-3 py-1.5 text-right tabular-nums${line.index === 0 ? ' font-bold' : ''}`}
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
      </details>
    </section>
  );
}

