'use client';

import type { ReactNode } from 'react';

import { useInfiniteQuery, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';

import { AppShell, PAGE_WIDTH } from '@/components/app-shell';
import { PeopleTabs } from '@/components/people-tabs';
import { MoveLeaderDialog } from '@/components/move-leader-dialog';
import { Button } from '@/components/ui/button';
import { FailureNotice } from '@/components/ui/failure-notice';
import { FRAME, ROW } from '@/components/ui/frame';
import { HeaderCell, Table, rowClasses } from '@/components/ui/table';
import {
  getPastoralPath,
  noLeaderLabel,
  type PastoralPath,
  type PathEntry,
} from '@/lib/hierarchy';
import { getMe, type SessionDescription } from '@/lib/me';
import { describeFailure } from '@/lib/messages';
import {
  getBranch,
  getCellFigures,
  getDccBehind,
  getMyBranch,
  type Branch,
  type BranchNode,
} from '@/lib/network';
import { monthLabel } from '@/lib/reporting-month';
import { useScreenAddress } from '@/lib/screen-address';

const LINK =
  'focus-visible:outline-accent inline-flex min-h-6 items-center underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2';


/** How many direct disciples show before "Show 20 more" (decision 0252). */
const STEP = 20;

/**
 * How many are read at once: the API's most. Every page walks the whole branch to count
 * what is beneath each row, so Show more reads from these rather than walking it again
 * (checklist row perf-network-rewalk).
 */
const FETCH = '200';

/**
 * The Network screen: one person's branch of the pastoral tree as it stands now
 * (SKILL.md section 17, decision 0252; the owner's Claude Design, adjusted to the rules).
 *
 * **Where you are lives in the address** — `/network?focus=<id>` — so the browser's Back
 * walks up the way you came, and a reload or a shared link lands in the same place. The
 * API still decides what each reader may see (section 7); the address carries an internal
 * identifier and never a name or Member ID.
 *
 * **Two figures for the current month, never added together**: DCC records behind and
 * Cell meetings behind, each read under its own capability. A reader who lacks one sees
 * a dash rather than a zero, because a zero would claim something the reader was never
 * shown. The month is named and marked open (section 17).
 *
 * **Rows are ordered by name, and nothing is ranked or coloured** (section 13): the
 * design's behind-first order and red tags are gone, and the filter is a filter.
 *
 * **Upline above the reader is context, never navigation.** `people.view_subtree` does
 * not reach a leader's own upline, so a link asking for their branch would be refused for
 * an ordinary leader. Only the part of the path at or below the reader is a control —
 * unless the reader is not on the path at all, which means a Network or Whole Church
 * scope reached the person, and that scope covers the path too.
 */
export default function NetworkPage() {
  return (
    <AppShell>
      {/*
        The address carries the focus, and a static page reading it is rendered on the
        client up to the nearest Suspense boundary. Without one the build refuses.
      */}
      <Suspense fallback={<p className="text-muted p-8 text-sm">Loading&hellip;</p>}>
        <NetworkScreen />
      </Suspense>
    </AppShell>
  );
}

function NetworkScreen() {
  const queryClient = useQueryClient();
  const search = useSearchParams();
  const focusParam = search.get('focus');

  const me = useQuery({
    queryKey: ['me'],
    queryFn: ({ signal }) => getMe(signal),
  });
  const focusId = focusParam ?? me.data?.person_id;

  const branch = useInfiniteQuery<Branch>({
    queryKey: ['network-branch', focusParam ?? 'mine'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      focusParam === null
        ? getMyBranch(pageParam as string | undefined, signal, FETCH)
        : getBranch(focusParam, pageParam as string | undefined, signal, FETCH),
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });

  const path = useQuery({
    queryKey: ['pastoral-path', focusId],
    queryFn: ({ signal }) => getPastoralPath(focusId ?? '', signal),
    enabled: focusId !== undefined,
  });

  const readsDcc = holds(me.data, 'dcc.view_subtree');
  const readsCells = holds(me.data, 'cell.view_subtree');

  // A figure the reader cannot read is shown as a dash, so a refusal here is an absence
  // rather than a failure — `retry: false` so it is not asked three times.
  const dcc = useQuery({
    queryKey: ['network-dcc', focusId],
    queryFn: ({ signal }) => getDccBehind(focusId ?? '', signal),
    enabled: focusId !== undefined && readsDcc,
    retry: false,
  });
  const cells = useQuery({
    queryKey: ['network-cells', focusId],
    queryFn: ({ signal }) => getCellFigures(focusId ?? '', signal),
    enabled: focusId !== undefined && readsCells,
    retry: false,
  });

  // In the address, so Back and a return from a person's page keep it (decision 0252's
  // filter; the rule is the address, as `lib/screen-address.ts` says).
  const go = useScreenAddress();
  const focusHref = useFocusHref();
  // The box follows the click at once and the address a moment later, as on the Cells list.
  const owesInAddress = search.get('owes') === '1';
  const [owesOnly, setOwesOnly] = useState(owesInAddress);
  const [lastOwes, setLastOwes] = useState(owesInAddress);
  if (lastOwes !== owesInAddress) {
    setLastOwes(owesInAddress);
    setOwesOnly(owesInAddress);
  }
  const [moving, setMoving] = useState<{
    id: string;
    name: string;
    leader: string;
  } | null>(null);

  const person = branch.data?.pages[0]?.person;
  const rows = branch.data?.pages.flatMap((page) => page.data) ?? [];
  // A reader outside the tree starts at the roots their scope reaches (decision 0268).
  const roots = focusParam === null ? (branch.data?.pages[0]?.roots ?? []) : [];
  const entries = path.data?.data ?? [];
  const dccOf = (id: string): number | null =>
    dcc.data === undefined ? null : (dcc.data.behind_by_child[id] ?? 0);
  const cellOf = (id: string): number | null =>
    cells.data === undefined ? null : (cells.data.meetings_behind_by_child[id] ?? 0);

  // The filter runs only over figures the reader holds and has received (decision 0252:
  // a reader lacking one "sees neither that figure nor a zero"). A figure still loading,
  // or never readable, is left out rather than counted as nothing owed, and the filter is
  // not offered at all until every figure the reader holds has answered.
  const covered = [
    ...(dcc.data === undefined ? [] : ['DCC records']),
    ...(cells.data === undefined ? [] : ['Cell meetings']),
  ];
  const filterReady =
    covered.length > 0 && !(readsDcc && dcc.isPending) && !(readsCells && cells.isPending);
  const filtering = owesOnly && filterReady;
  // Twenty on screen at a time, from rows already read (checklist row perf-network-rewalk).
  // A new focus starts again at twenty.
  const [visible, setVisible] = useState(STEP);
  const [visibleFor, setVisibleFor] = useState(focusParam);
  if (visibleFor !== focusParam) {
    setVisibleFor(focusParam);
    setVisible(STEP);
  }
  const shown = filtering
    ? rows.filter((row) => (dccOf(row.id) ?? 0) > 0 || (cellOf(row.id) ?? 0) > 0)
    : rows.slice(0, visible);
  const waitingForRows = visible >= rows.length && branch.isFetchingNextPage;
  const showMore = () => {
    setVisible(visible + STEP);
    if (visible + STEP > rows.length && branch.hasNextPage && !branch.isFetchingNextPage) {
      void branch.fetchNextPage();
    }
  };

  // The filter reaches the whole generation rather than the page on screen, so it loads
  // the remaining pages first. The figures already cover every direct disciple.
  useEffect(() => {
    if (filtering && branch.hasNextPage && !branch.isFetchingNextPage) {
      void branch.fetchNextPage();
    }
  }, [filtering, branch]);

  const month = dcc.data?.reporting_month ?? cells.data?.reporting_month ?? null;
  const open = dcc.data?.open ?? cells.data?.open ?? true;
  const mayMove = holds(me.data, 'people.manage_pastoral_assignment');
  const isMe = person !== undefined && person.id === me.data?.person_id;

  const failure = me.isError
    ? describeFailure(me.error)
    : branch.isError
      ? describeFailure(branch.error)
      : path.isError
        ? describeFailure(path.error)
        : null;

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['network-branch'] });
    void queryClient.invalidateQueries({ queryKey: ['network-dcc'] });
    void queryClient.invalidateQueries({ queryKey: ['network-cells'] });
  };

  return (
    <main id="main" className={PAGE_WIDTH.INDEX}>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
      <h1 className="text-2xl font-semibold tracking-tight">Branch</h1>
      <p className="text-muted text-sm">
        The people you oversee, one level at a time.
        {month === null
          ? null
          : ` Figures for ${monthLabel(month)}${open ? ', a month still open' : ''}.`}
      </p>
      </div>

      <PeopleTabs current="/network">

        {/* No trail and no search (owner, 2026-10-15, decision 0354): a person is found from
            Add People, and the reader goes back up with the browser's Back. */}
        <div className="mt-6">
          <FailureNotice failure={failure} />
        </div>

        {branch.isPending && failure === null ? (
          <p className="text-muted mt-6 text-sm">Loading&hellip;</p>
        ) : roots.length > 0 ? (
          <RootsView roots={roots} readsDcc={readsDcc} readsCells={readsCells} />
        ) : person === undefined ? null : (
          <>
            <FocusBlock
              person={person}
              entries={entries}
              noLeaderReason={path.data?.no_leader_reason ?? null}
              isMe={isMe}
              mayMove={mayMove}
              onMove={() =>
                setMoving({
                  id: person.id,
                  name: person.full_name,
                  leader: entries.at(-2)?.full_name ?? '',
                })
              }
            />

            <dl className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Card label="Direct disciples" value={String(person.direct_reports)} />
              {/* Every Cell Leader and Cell member under them is already in it (owner, 2026-09-28). */}
              <Card
                label={isMe ? 'Everyone beneath you' : `Everyone beneath ${person.full_name}`}
                value={String(person.beneath)}
              />
              <Card
                label="Cell Leaders beneath"
                value={cells.data === undefined ? '—' : String(cells.data.cell_leaders_beneath)}
              />
              <Card
                label="Still to record"
                value={
                  <>
                    <StillToRecord count={dcc.data?.branch_behind} unit="DCC" />
                    <span className="text-muted mx-2 text-sm font-normal">·</span>
                    <StillToRecord count={cells.data?.branch_meetings_behind} unit="Cell" />
                  </>
                }
              />
            </dl>

            <section aria-labelledby="reports-to-heading" className={`mt-6 ${FRAME}`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="reports-to-heading" className="field-label">
                {isMe ? 'Your direct disciples' : `${person.full_name}’s direct disciples`}
              </h2>
              {filterReady ? (
                <label className="flex min-h-11 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={owesOnly}
                    onChange={(event) => {
                      setOwesOnly(event.target.checked);
                      go({ owes: event.target.checked ? '1' : null });
                    }}
                    className="size-5"
                  />
                  Only those still to record
                </label>
              ) : null}
            </div>

            {/*
              Why no row carries a Move, for a reader holding no
              `people.manage_pastoral_assignment` grant. It says nothing about anybody on
              the screen: it is a fact about the reader's own permissions, and section 5
              names who may act — an administrator, a leader upline of *the person* acting
              inside their own subtree, or a Senior Pastor. That is why the sentence says a
              leader who pastors them rather than the reader's own leader, who is upline of
              nobody on a branch the reader reached from outside. Once, under the list,
              rather than beside each name.
            */}
            {mayMove ? null : (
              <p className="text-muted mt-2 max-w-2xl text-sm leading-relaxed">
                To move somebody to another pastoral leader, ask a leader who pastors them, or
                an administrator.
              </p>
            )}

            {shown.length === 0 ? (
              <p className="text-muted mt-4 max-w-2xl text-sm leading-relaxed">
                {filtering
                  ? branch.hasNextPage
                    ? 'Loading…'
                    : `Nobody here is behind on ${covered.join(' or ')} this month.`
                  : `${isMe ? 'You have' : `${person.full_name} has`} no direct disciples today.`}
              </p>
            ) : (
              <>
                <Table
                  caption={`Direct disciples of ${person.full_name}`}
                  className="mt-4 hidden lg:block"
                >
                  <thead>
                    <tr>
                      <HeaderCell>Name</HeaderCell>
                      <HeaderCell className="text-right">Beneath</HeaderCell>
                      <HeaderCell className="text-right">DCC records behind</HeaderCell>
                      <HeaderCell className="text-right">Cell meetings behind</HeaderCell>
                      <HeaderCell>
                        <span className="sr-only">Actions</span>
                      </HeaderCell>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((row) => (
                      <tr key={row.id} className={rowClasses}>
                        <td className="px-3 py-3">
                          <Link href={focusHref(row.id)} className={`${LINK} font-medium`}>
                            {row.full_name}
                          </Link>
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">{row.beneath}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{figure(dccOf(row.id))}</td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {figure(cellOf(row.id))}
                        </td>
                        <td className="px-3 py-3 text-right whitespace-nowrap">
                          <RowActions
                            row={row}
                            mayMove={mayMove}
                            onMove={() =>
                              setMoving({
                                id: row.id,
                                name: row.full_name,
                                leader: person.full_name,
                              })
                            }
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>

                <ul className="mt-4 lg:hidden">
                  {shown.map((row) => (
                    <li key={row.id} className={ROW}>
                      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                        <h3 className="text-base font-medium">
                          <Link href={focusHref(row.id)} className={LINK}>
                            {row.full_name}
                          </Link>
                        </h3>
                      </div>
                      <dl className="text-muted mt-2 grid grid-cols-3 items-end gap-2 text-sm">
                        <div>
                          <dt>Beneath</dt>
                          <dd className="text-ink tabular-nums">{row.beneath}</dd>
                        </div>
                        <div>
                          <dt>DCC records behind</dt>
                          <dd className="text-ink tabular-nums">{figure(dccOf(row.id))}</dd>
                        </div>
                        <div>
                          <dt>Cell meetings behind</dt>
                          <dd className="text-ink tabular-nums">{figure(cellOf(row.id))}</dd>
                        </div>
                      </dl>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <RowActions
                          row={row}
                          mayMove={mayMove}
                          onMove={() =>
                            setMoving({
                              id: row.id,
                              name: row.full_name,
                              leader: person.full_name,
                            })
                          }
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}

            <p className="text-muted mt-4 text-sm">
              {filtering
                ? `${shown.length} of ${rows.length} behind on ${covered.join(' or ')} · by name`
                : `Showing ${shown.length} of ${person.direct_reports} · by name`}
            </p>
            {!filtering && (visible < rows.length || branch.hasNextPage) ? (
              <p className="mt-3">
                <Button variant="secondary" onClick={showMore} disabled={waitingForRows}>
                  {waitingForRows ? 'Loading…' : 'Show 20 more'}
                </Button>
              </p>
            ) : null}
            </section>
          </>
        )}

        {moving === null ? null : (
          <MoveLeaderDialog
            open
            personId={moving.id}
            personName={moving.name}
            currentLeaderName={moving.leader || null}
            onClose={() => {
              setMoving(null);
              refresh();
            }}
          />
        )}
      </PeopleTabs>
    </main>
  );
}

/**
 * Where a reader outside the pastoral tree starts (decision 0268): the Network roots their
 * scope reaches, by name, each with their whole branch's figures for the month. A root is
 * never moved (section 5), so a row's name, which opens it, is its only control.
 */
function RootsView({
  roots,
  readsDcc,
  readsCells,
}: {
  roots: BranchNode[];
  readsDcc: boolean;
  readsCells: boolean;
}) {
  const focusHref = useFocusHref();
  const dcc = useQueries({
    queries: roots.map((root) => ({
      queryKey: ['network-dcc', root.id],
      queryFn: ({ signal }: { signal: AbortSignal }) => getDccBehind(root.id, signal),
      enabled: readsDcc,
      retry: false,
    })),
  });
  const cells = useQueries({
    queries: roots.map((root) => ({
      queryKey: ['network-cells', root.id],
      queryFn: ({ signal }: { signal: AbortSignal }) => getCellFigures(root.id, signal),
      enabled: readsCells,
      retry: false,
    })),
  });

  // The month these rows' figures are for, from the rows' own figures rather than the
  // reader's, which a reader outside the tree may not be able to read (section 17).
  const answered = [...dcc, ...cells].find((query) => query.data !== undefined)?.data;

  return (
    <section aria-labelledby="roots-heading" className="mt-6">
      <h2 id="roots-heading" className="text-lg font-semibold">
        Network roots
      </h2>
      <p className="text-muted mt-2 max-w-2xl text-sm leading-relaxed">
        You aren&rsquo;t in the pastoral tree, so this starts at the Network roots, the pastors at the
        top of each Network, that your scope reaches.
        {answered === undefined
          ? null
          : ` Figures for ${monthLabel(answered.reporting_month)}${answered.open ? ', a month still open' : ''}.`}
      </p>
      <ul className="mt-4 flex flex-col gap-3">
        {roots.map((root, index) => (
          <li key={root.id} className="border-line border p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h3 className="text-base font-medium">
                <Link href={focusHref(root.id)} className={LINK}>
                  {root.full_name}
                </Link>
              </h3>
            </div>
            <dl className="text-muted mt-2 grid grid-cols-2 items-end gap-2 text-sm lg:grid-cols-4">
              <div>
                <dt>Direct disciples</dt>
                <dd className="text-ink tabular-nums">{root.direct_reports}</dd>
              </div>
              <div>
                <dt>Beneath</dt>
                <dd className="text-ink tabular-nums">{root.beneath}</dd>
              </div>
              <div>
                <dt>DCC records behind</dt>
                <dd className="text-ink tabular-nums">
                  {figure(dcc[index]?.data?.branch_behind ?? null)}
                </dd>
              </div>
              <div>
                <dt>Cell meetings behind</dt>
                <dd className="text-ink tabular-nums">
                  {figure(cells[index]?.data?.branch_meetings_behind ?? null)}
                </dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
    </section>
  );
}

function holds(me: SessionDescription | undefined, capability: string): boolean {
  return (me?.capabilities ?? []).some((grant) => grant.capability === capability);
}

/**
 * The address of a person's branch, or of the reader's own for `null`. It carries the
 * Owes records filter along, so moving between leaders keeps it, as it did while the
 * filter was component state.
 */
function useFocusHref(): (personId: string | null) => string {
  const owes = useSearchParams().get('owes') === '1';

  return (personId) => {
    const query = new URLSearchParams({
      ...(personId === null ? {} : { focus: personId }),
      ...(owes ? { owes: '1' } : {}),
    }).toString();

    return query === '' ? '/network' : `/network?${query}`;
  };
}

function figure(value: number | null): string {
  return value === null ? '—' : String(value);
}

/**
 * One Still to record figure, a plain number: Filed Reports, which it used to open, is
 * withdrawn (decision 0340).
 */
function StillToRecord({ count, unit }: { count: number | undefined; unit: string }) {
  return (
    <span>
      {count === undefined ? '—' : count}
      <span className="text-muted ml-1 text-sm font-normal">{unit}</span>
    </span>
  );
}

function Card({ label, value, note }: { label: string; value: ReactNode; note?: string }) {
  return (
    <div className="bg-surface border-edge border p-3">
      <dt className="text-accent text-xs font-bold tracking-[0.08em] uppercase">{label}</dt>
      <dd className="mt-1 text-2xl font-bold tabular-nums">{value}</dd>
      {note === undefined ? null : <dd className="text-muted text-xs">{note}</dd>}
    </div>
  );
}

function RowActions({
  row,
  mayMove,
  onMove,
}: {
  row: BranchNode;
  mayMove: boolean;
  onMove: () => void;
}) {
  // The name opens the row, so Move is the one button (owner's choice of 2026-10-05).
  return mayMove ? (
    <Button variant="quiet" onClick={onMove} aria-label={`Move ${row.full_name}`}>
      Move
    </Button>
  ) : null;
}

function FocusBlock({
  person,
  entries,
  noLeaderReason,
  isMe,
  mayMove,
  onMove,
}: {
  person: BranchNode;
  entries: readonly PathEntry[];
  noLeaderReason: PastoralPath['no_leader_reason'];
  isMe: boolean;
  mayMove: boolean;
  onMove: () => void;
}) {
  const parent = entries.length >= 2 ? entries[entries.length - 2] : null;

  return (
    <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h2 className="text-xl font-semibold">{person.full_name}</h2>
        {parent === null ? (
          <p className="text-muted mt-1 text-sm">{noLeaderLabel(entries, noLeaderReason)}</p>
        ) : null}
      </div>
      {mayMove && !isMe ? (
        <Button variant="secondary" onClick={onMove}>
          Move this person
        </Button>
      ) : null}
    </div>
  );
}
