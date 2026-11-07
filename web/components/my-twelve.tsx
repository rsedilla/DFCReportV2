import Link from 'next/link';

import { FRAME } from '@/components/ui/frame';
import { ShortText } from '@/components/ui/short-text';
import { HeaderCell, Table, rowClasses } from '@/components/ui/table';
import { shortNames } from '@/lib/names';
import { usePhone } from '@/lib/phone';
import { cn } from '@/lib/utils';
import type { CellTwelve, Classification, TwelveFigure } from '@/lib/reports';
import {
  rangeEndOf,
  rangeLabel,
  shiftRange,
  shortRangeLabel,
  type RangeKind,
} from '@/lib/report-range';
import { periodOpenUntilLabel } from '@/lib/weekly-deadline';

const STAGES: readonly [keyof Classification, string][] = [
  ['vip', 'VIP'],
  ['second_timer', '2nd Timer'],
  ['third_timer', '3rd Timer'],
  ['fourth_timer', '4th Timer'],
  ['regular', 'Regular'],
];

/** Each stage's heading on a phone (decision 0451). */
const STAGE_SHORT: Record<keyof Classification, string> = {
  vip: 'VIP',
  second_timer: '2nd',
  third_timer: '3rd',
  fourth_timer: '4th',
  regular: 'Reg',
};

/**
 * A phone table's cells (decision 0451): close-set so seven columns fit 320px, the headings
 * untracked; from `lg` the spacing every table has.
 */
export const NAME_HEAD = 'px-2 tracking-normal lg:px-3 lg:tracking-[0.08em]';
export const FIGURE_HEAD =
  'px-0.5 text-right text-[10px] tracking-normal min-[360px]:px-1 min-[360px]:text-[11px] lg:px-3 lg:text-xs lg:tracking-[0.08em]';
export const NAME_CELL = 'px-2 py-3 text-[13px] leading-snug min-[360px]:text-sm lg:px-3';
export const FIGURE_CELL =
  'px-0.5 py-3 text-right text-[13px] tabular-nums min-[360px]:px-1 min-[360px]:text-sm lg:px-3';

/** The label above a labelled navigator (decision 0363). */
const RANGE_NOUN: Record<RangeKind, string> = {
  WEEK: 'Week',
  MONTH: 'Month',
  QUARTER: 'Quarter',
  YEAR: 'Year',
};

const WHAT: Record<RangeKind, string> = {
  WEEK: 'in the week',
  MONTH: 'in the month',
  QUARTER: 'in the quarter',
  YEAR: 'in the year',
};

/**
 * The period being shown and the way to the one before and after it. Forward stops at the
 * current period, because a period that has not begun is not reported (decision 0216).
 */
export function RangeNavigator({
  kind,
  start,
  current,
  earliest,
  open,
  onChange,
  quiet = false,
  labelled = false,
  asOfToday = false,
}: {
  kind: RangeKind;
  start: string;
  current: string;
  /**
   * Labelled above, with the period between the arrows and no tag (a Full view leader, decision
   * 0363): whether it is open is said in the note under the controls. `bare` is the same
   * without the label, beside the one switch, for every reader who has it (decision 0398); with
   * `quiet`, an open period says *As of today* (decision 0451).
   */
  labelled?: boolean | 'bare';
  /** The earliest period this reader is offered, where there is one (decision 0310). */
  earliest?: string;
  open: boolean | undefined;
  onChange: (start: string) => void;
  /**
   * An open period says *As of today* in plain words, and a closed one says nothing (the Senior
   * Pastors, owner 2026-10-09; the words decision 0451's, which were *so far*). Still the open
   * flag sections 17 and 19 ask for; they do not record, so the window's last day is not theirs.
   */
  quiet?: boolean;
  /**
   * Under Reports (decision 0451): an open period says *As of today* and a finished one nothing,
   * and a phone names a week shortly. Record's *Recording Progress* leaves it off and keeps its
   * closing time and *Closed* tag, because recording is what that time is for.
   */
  asOfToday?: boolean;
}) {
  const phone = usePhone();
  const button =
    'border-line focus-visible:outline-accent inline-flex min-h-11 min-w-12 shrink-0 items-center justify-center border text-lg focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-40 lg:min-w-11';
  const label =
    phone && (labelled || asOfToday) ? shortRangeLabel(kind, start) : rangeLabel(kind, start);
  const before = (
    <button
      type="button"
      className={button}
      aria-label="The period before"
      disabled={earliest !== undefined && start <= earliest}
      onClick={() => onChange(shiftRange(kind, start, -1))}
    >
      ‹
    </button>
  );
  const after = (
    <button
      type="button"
      className={button}
      aria-label="The period after"
      disabled={start >= current}
      onClick={() => onChange(shiftRange(kind, start, 1))}
    >
      ›
    </button>
  );

  if (labelled) {
    return (
      // A row of its own on a phone, so the bar can take the width (decision 0451).
      <div className="w-full lg:w-auto">
        {/* Beside the one switch, which carries no label either (decision 0398). */}
        {labelled === 'bare' ? null : <p className="field-label">{RANGE_NOUN[kind]}</p>}
        {/* On a phone the bar is its box's width, ‹ and › at the two ends and the period
            between them on one line (decision 0451); from `lg` it sits beside its switch. */}
        <div
          className={cn(
            'flex w-full items-center lg:w-auto lg:flex-wrap',
            labelled === 'bare' ? null : 'mt-2',
          )}
        >
          {before}
          {/* One width for every month, so the arrows do not move as it steps (decision 0398). */}
          <span className="border-line bg-surface inline-flex min-h-11 min-w-0 flex-1 items-center justify-center border-y px-3 text-base font-bold whitespace-nowrap lg:min-w-36 lg:flex-none lg:text-sm">
            {label}
          </span>
          {after}
          {quiet && open ? (
            <span className="text-muted ml-3 hidden text-sm whitespace-nowrap lg:inline">
              As of today
            </span>
          ) : null}
        </div>
        {/* A phone says it under the bar, where it has the room (decision 0451). */}
        {quiet && open ? <p className="text-muted mt-2 text-sm lg:hidden">As of today</p> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      {before}
      {after}
      <span className="text-accent text-sm font-bold">{label}</span>
      {asOfToday ? (
        // Under Reports a period still open says so in two words, and a finished one says
        // nothing (decision 0451, replacing its closing time and a "Closed" tag).
        open ? (
          <span className="text-muted text-sm">· As of today</span>
        ) : null
      ) : open === undefined ? null : (
        <span className="border-line bg-surface rounded-full border px-2.5 py-0.5 text-xs font-semibold">
          {open ? periodOpenUntilLabel(rangeEndOf(kind, start)) : 'Closed'}
        </span>
      )}
    </div>
  );
}

/**
 * My 12 (SKILL.md sections 9, 12, 13, 17 and 20; decisions 0293 and 0294).
 *
 * **The subject's direct disciples, then their own row, then the total**, each a count of
 * different people who came in the period, once each, split by the stage each had reached by
 * its last day. The own row is the subject's own Cell groups for Cell Groups, and the subject
 * alone for DCC, whose attendance nobody records for themselves. Rows are in the API's order
 * (first name, or Network for a whole-church reader), never numbered, never sorted by a figure,
 * never coloured (section 13). Each name opens that
 * leader's report, which shows their 12. A whole-church reader's rows are the Network roots,
 * named by the pastor with their Network beside, since that reader disciples neither.
 *
 * **Each row is that leader's own figure**, so somebody at Cells in two branches is in both
 * rows; a line takes off each count beyond a person's first, and another adds those in no
 * row, so the People column adds up to the total in plain sight.
 */
export function TwelveTable({
  twelve,
  kind,
  subjectName,
  openHref,
  where = 'a Cell',
  title: heading,
}: {
  /** The table's own title, where it is neither the reader's nor an opened leader's 12. */
  title?: string;
  /** `own.cells` is present for Cell Groups; DCC's own row is the subject alone. */
  twelve: Omit<CellTwelve, 'own' | 'coverage'> & {
    own: (TwelveFigure & { cells?: number }) | null;
  };
  kind: RangeKind;
  /** What people came to: "a Cell" or "DCC". */
  where?: string;
  /** Null for the reader's own view; the leader's name when one was opened. */
  subjectName: string | null;
  openHref: (leaderId: string) => string;
}) {
  const cell = 'px-3 py-3 text-right tabular-nums';
  const own = twelve.own;
  // A whole-church reader's rows are the two roots, each named by the pastor with their
  // Network beside (decision 0294): a Network's own figure is its membership, not a root's 12.
  const byRoot = twelve.rows.length > 0 && twelve.rows.every((row) => row.network);
  const title =
    heading ?? (subjectName !== null ? `${subjectName}’s 12` : byRoot ? 'Whole Church' : 'My 12');
  const ownLabel = ownLabelOf(own, subjectName);

  return (
    <section aria-labelledby="twelve-heading" className={FRAME}>
      <h2 id="twelve-heading" className="field-label">
        {title} · their journey
      </h2>
      <p className="text-muted mt-1 text-sm leading-relaxed">
        Everyone who came to {where} {WHAT[kind]}, counted once, at their stage{' '}
        {twelve.open ? 'so far' : 'by its end'}.
        {twelve.rows.length > 0 ? ' Open a name to see their 12.' : ''}
      </p>

      <Table caption={title} className="mt-3">
        <thead>
          <tr>
            <HeaderCell>Leader</HeaderCell>
            {STAGES.map(([key, label]) => (
              <HeaderCell key={key} className="text-right">
                {label}
              </HeaderCell>
            ))}
            <HeaderCell className="text-right">People</HeaderCell>
          </tr>
        </thead>
        <tbody>
          {twelve.rows.map((row, index) => (
            <tr key={row.leader?.id ?? `unnamed-${index}`} className={rowClasses}>
              <td className="px-3 py-3">
                {row.leader === null ? (
                  <span className="text-muted">A leader you don’t oversee</span>
                ) : (
                  <Link
                    href={openHref(row.leader.id)}
                    className="text-accent focus-visible:outline-accent inline-flex min-h-6 items-center underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
                  >
                    {row.network
                      ? `${row.leader.full_name} · ${row.network === 'MENS' ? "Men's" : "Women's"}`
                      : row.leader.full_name}
                  </Link>
                )}
              </td>
              {STAGES.map(([key]) => (
                <td key={key} className={cell}>
                  {row.classification[key]}
                </td>
              ))}
              <td className={`${cell} font-bold`}>{row.unique_people}</td>
            </tr>
          ))}

          {own === null ? null : (
            <tr className={rowClasses}>
              <td className="px-3 py-3">{ownLabel}</td>
              {own.cells === 0 ? (
                <td className="text-muted px-3 py-3" colSpan={STAGES.length + 1} />
              ) : (
                <>
                  {STAGES.map(([key]) => (
                    <td key={key} className={cell}>
                      {own.classification[key]}
                    </td>
                  ))}
                  <td className={`${cell} font-bold`}>{own.unique_people}</td>
                </>
              )}
            </tr>
          )}

          {twelve.overlap === 0 ? null : (
            <tr className={rowClasses}>
              <td className="text-muted px-3 py-3 italic" colSpan={STAGES.length + 1}>
                Counted under more than one leader
              </td>
              <td className={`${cell} text-muted italic`}>−{twelve.overlap}</td>
            </tr>
          )}

          {twelve.elsewhere === 0 ? null : (
            <tr className={rowClasses}>
              <td className="text-muted px-3 py-3 italic" colSpan={STAGES.length + 1}>
                {subjectName === null && twelve.own === null ? 'Under none of these leaders' : 'Elsewhere in this branch'}
              </td>
              <td className={`${cell} text-muted italic`}>+{twelve.elsewhere}</td>
            </tr>
          )}

          <tr className="border-edge border-t-2 font-bold">
            <td className="px-3 py-3">Total</td>
            {STAGES.map(([key]) => (
              <td key={key} className={cell}>
                {twelve.total.classification[key]}
              </td>
            ))}
            <td className={cell}>{twelve.total.unique_people}</td>
          </tr>
        </tbody>
      </Table>

      {kind === 'MONTH' ? null : (
        <p className="text-muted mt-3 text-sm">
          Periods are never added together: somebody who came in three{' '}
          {kind === 'WEEK' ? 'weeks counts once in the month' : 'months counts once here'}.
        </p>
      )}
    </section>
  );
}

/** The own row's label: the subject, and for Cell Groups how many Cells of their own. */
function ownLabelOf(
  own: { cells?: number } | null,
  subjectName: string | null,
): string | null {
  if (own === null) {
    return null;
  }
  if (own.cells === undefined) {
    return subjectName ?? 'You';
  }
  const whose = subjectName === null ? 'your' : 'their';
  return `${subjectName === null ? 'You' : subjectName} · ${
    own.cells === 0
      ? `no Cell of ${whose} own`
      : own.cells === 1
        ? `${whose} own Cell Group`
        : `${whose} own Cell Groups (${own.cells})`
  }`;
}

/**
 * The own row's label on a phone (decision 0451): short, still saying whether they lead a Cell
 * and how many, which the figures beside it depend on.
 */
function ownShortOf(own: { cells?: number } | null, subjectName: string | null): string {
  const who = subjectName ?? 'You';
  if (own === null || own.cells === undefined) {
    return who;
  }
  return own.cells === 0
    ? `${who} · no Cell`
    : `${who} · ${own.cells} Cell${own.cells === 1 ? '' : 's'}`;
}

/**
 * A Full view leader's My 12 (decision 0340), laid out as the Senior Pastors' for one branch:
 * the branch's figures as cards, then the leader's 12 with Total first and their own row.
 *
 * **Decision 0293's two lines stay, under the rows**: somebody in two branches is in both
 * rows, so one line takes off each count beyond a person's first and another adds those in no
 * row, and Total adds up in plain sight, which a branch's cards alone would not show.
 */
export function BranchTwelve({
  twelve,
  kind,
  subjectName,
}: {
  twelve: Omit<CellTwelve, 'own' | 'coverage'> & {
    own: (TwelveFigure & { cells?: number }) | null;
  };
  kind: RangeKind;
  /** Null for the reader's own branch; the leader's name when one was opened. */
  subjectName: string | null;
}) {
  const phone = usePhone();
  const own = twelve.own;
  const ownLabel = ownLabelOf(own, subjectName);
  const heading = subjectName === null ? 'Your 12' : `${subjectName}’s 12`;
  const short = shortNames(twelve.rows.map((row) => row.leader ?? { full_name: null }));
  const figures = (figure: TwelveFigure) => (
    <>
      <td className={`${FIGURE_CELL} font-bold`}>{figure.unique_people}</td>
      {STAGES.map(([key]) => (
        <td key={key} className={FIGURE_CELL}>
          {figure.classification[key]}
        </td>
      ))}
    </>
  );
  /** Text that a phone shortens, said in full to a screen reader (decision 0451). */
  const said = (full: string, brief: string | null) =>
    phone ? <ShortText full={full} short={brief} /> : full;

  return (
    // No cards and no heading (decision 0365): the table's Total row carries the branch's
    // figures, and the section keeps its name for a screen reader (section 23).
    <section aria-label={subjectName === null ? 'Your Disciples' : `${subjectName}’s Disciples`}>
      {/* One table at every width (decision 0451, replacing decision 0365's two lines a leader
          on a phone): every figure in its column and in view, the headings and the names
          shortened on a phone, the number columns equal. No visible label: the Leader column
          says what the rows are (decision 0363), and the caption names the table for a screen
          reader (section 23). */}
      <Table caption={heading} tableClassName="table-fixed">
        <thead>
          <tr>
            <HeaderCell className={NAME_HEAD} style={{ width: '32%' }}>
              Leader
            </HeaderCell>
            <HeaderCell className={FIGURE_HEAD} style={{ width: '13%' }}>
              Total
            </HeaderCell>
            {STAGES.map(([key, label]) => (
              <HeaderCell key={key} className={FIGURE_HEAD} style={{ width: '11%' }}>
                {said(label, STAGE_SHORT[key])}
              </HeaderCell>
            ))}
          </tr>
        </thead>
        <tbody>
          {twelve.rows.map((row, index) => (
            <tr key={row.leader?.id ?? `unnamed-${index}`} className={rowClasses}>
              <td className={NAME_CELL}>
                {row.leader === null ? (
                  <span className="text-muted">A leader you don’t oversee</span>
                ) : (
                  // A name, not a link (decision 0380).
                  said(row.leader.full_name, short[index])
                )}
              </td>
              {figures(row)}
            </tr>
          ))}

          {own === null ? null : (
            <tr className={rowClasses}>
              <td className={NAME_CELL}>
                {ownLabel === null ? null : said(ownLabel, ownShortOf(own, subjectName))}
              </td>
              {own.cells === 0 ? (
                <td className="text-muted px-3 py-3" colSpan={STAGES.length + 1} />
              ) : (
                figures(own)
              )}
            </tr>
          )}

          {twelve.overlap === 0 ? null : (
            <tr className={rowClasses}>
              <td className={`${NAME_CELL} text-muted italic`}>
                {said('Counted under more than one leader', 'Under 2+ leaders')}
              </td>
              <td className={`${FIGURE_CELL} text-muted italic`}>−{twelve.overlap}</td>
              <td colSpan={STAGES.length} />
            </tr>
          )}

          {twelve.elsewhere === 0 ? null : (
            <tr className={rowClasses}>
              <td className={`${NAME_CELL} text-muted italic`}>
                {said('Elsewhere in this branch', 'Elsewhere in branch')}
              </td>
              <td className={`${FIGURE_CELL} text-muted italic`}>+{twelve.elsewhere}</td>
              <td colSpan={STAGES.length} />
            </tr>
          )}

          <tr className="border-edge border-t-2 font-bold">
            <td className={NAME_CELL}>Total</td>
            {figures(twelve.total)}
          </tr>
        </tbody>
      </Table>

      {kind === 'MONTH' ? null : <p className="text-muted mt-3 text-sm">{notAdded(kind)}</p>}
    </section>
  );
}

/**
 * Why the periods are not added up, in one short line (decision 0451): somebody who came in
 * three weeks is one person in the month, as section 20 states.
 */
export function notAdded(kind: RangeKind): string {
  return kind === 'WEEK'
    ? 'Weeks don’t add up to the month: a person counts once.'
    : `Months don’t add up to the ${kind === 'QUARTER' ? 'quarter' : 'year'}: a person counts` +
        ' once.';
}

/**
 * The two Senior Pastors' My 12 (decision 0326, point 3): the whole church's figures as cards,
 * then one table for each root's direct leaders, the Men's root first, each headed by the
 * root's title and name. Each Senior Pastor sees both tables in full.
 *
 * **Decision 0293's two lines sit once, under both tables**: somebody at Cells in two branches
 * is in both rows, so one line takes off each count beyond a person's first and another adds
 * those in no row, the roots among them, and the Total column adds up to the total.
 *
 * **Total comes first and there is no People column** (owner, 2026-10-09): a row's Total is
 * its unique people, which is VIP through Regular added, everyone being in one stage.
 */
export function RootLeadersTwelve({
  twelve,
  openHref,
}: {
  twelve: Omit<CellTwelve, 'own' | 'coverage'>;
  kind: RangeKind;
  openHref: (leaderId: string) => string;
  where?: string;
}) {
  const cell = 'px-3 py-3 text-right tabular-nums';
  const roots = twelve.roots ?? [];
  const phone = usePhone();

  return (
    // Unframed, so the tables take the whole width, and headed in two words (owner, 2026-10-09).
    // *As of today* beside the period above says when a figure is still open (section 17,
    // decision 0451).
    <section aria-labelledby="root-leaders-heading">
      <h2 id="root-leaders-heading" className="field-label">
        Whole Church
      </h2>

      <dl className="mt-3 grid grid-cols-3 gap-2 lg:grid-cols-6">
        <div className="border-line border p-2">
          <dt className="text-ink text-sm font-bold">Total</dt>
          <dd className="text-xl font-bold tabular-nums">{twelve.total.unique_people}</dd>
        </div>
        {STAGES.map(([key, label]) => (
          <div key={key} className="border-line border p-2">
            <dt className="text-ink text-sm font-bold">{label}</dt>
            <dd className="text-xl font-bold tabular-nums">{twelve.total.classification[key]}</dd>
          </div>
        ))}
      </dl>

      {roots.map((root) => {
        const rows = twelve.rows.filter((row) => row.root_id === root.id);
        // No count in the heading (owner, 2026-10-09): the rows are there to see.
        const heading = `${root.full_name ?? 'A Network root'}’s leaders`;
        // Short names on a phone, worked out within this table (decision 0451).
        const short = shortNames(rows.map((row) => row.leader ?? { full_name: null }));

        return (
          <div key={root.id} className="mt-5">
            <h3 className="text-base font-bold tracking-tight">{heading}</h3>
            <Table caption={heading} className="mt-2" tableClassName="table-fixed">
              <thead>
                <tr>
                  <HeaderCell className={NAME_HEAD} style={{ width: '32%' }}>
                    Primaries
                  </HeaderCell>
                  {/* The six figures share the rest of the row equally (owner, 2026-10-09). */}
                  <HeaderCell className={FIGURE_HEAD} style={{ width: '13%' }}>
                    Total
                  </HeaderCell>
                  {STAGES.map(([key, label]) => (
                    <HeaderCell key={key} className={FIGURE_HEAD} style={{ width: '11%' }}>
                      {phone ? <ShortText full={label} short={STAGE_SHORT[key]} /> : label}
                    </HeaderCell>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  // Every other row shaded, to follow a row across, never numbered (owner, 2026-10-09).
                  <tr key={row.leader?.id ?? `unnamed-${index}`} className={rowClasses}>
                    <td className={NAME_CELL}>
                      {row.leader === null ? (
                        <span className="text-muted">A leader you don’t oversee</span>
                      ) : (
                        <Link
                          href={openHref(row.leader.id)}
                          // A short name keeps the words it shows first in its name, so speaking
                          // them selects it (decision 0451; WCAG 2.5.3).
                          aria-label={
                            phone && short[index] && short[index] !== row.leader.full_name
                              ? `${short[index]}, ${row.leader.full_name}`
                              : undefined
                          }
                          className="text-accent focus-visible:outline-accent inline-flex min-h-6 items-center underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
                        >
                          {phone ? (short[index] ?? row.leader.full_name) : row.leader.full_name}
                        </Link>
                      )}
                    </td>
                    <td className={`${FIGURE_CELL} font-bold`}>{row.unique_people}</td>
                    {STAGES.map(([key]) => (
                      <td key={key} className={FIGURE_CELL}>
                        {row.classification[key]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        );
      })}

      <Table caption="Under both tables" className="mt-5">
        <tbody>
          {twelve.overlap === 0 ? null : (
            <tr className={rowClasses}>
              <td className="text-muted px-3 py-3 italic">Counted under more than one leader</td>
              <td className={`${cell} text-muted italic`}>−{twelve.overlap}</td>
            </tr>
          )}
          {twelve.elsewhere === 0 ? null : (
            <tr className={rowClasses}>
              <td className="text-muted px-3 py-3 italic">
                Under none of these leaders, the two Network roots among them
              </td>
              <td className={`${cell} text-muted italic`}>+{twelve.elsewhere}</td>
            </tr>
          )}
          <tr className="border-edge border-t-2 font-bold">
            <td className="px-3 py-3">Total</td>
            <td className={cell}>{twelve.total.unique_people}</td>
          </tr>
        </tbody>
      </Table>
    </section>
  );
}