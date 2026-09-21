'use client';

import { useInfiniteQuery, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, type FormEvent } from 'react';

import { AppShell, PAGE_WIDTH } from '@/components/app-shell';
import { MoveLeaderDialog } from '@/components/move-leader-dialog';
import { Button, buttonClasses } from '@/components/ui/button';
import { FailureNotice } from '@/components/ui/failure-notice';
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
import { MINIMUM_SEARCH_LENGTH, searchPeople } from '@/lib/people';
import { monthLabel } from '@/lib/reporting-month';

const LINK =
  'focus-visible:outline-accent inline-flex min-h-6 items-center underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2';

/** How many search results show before "Show 10 more" (decision 0252). */
const SEARCH_STEP = 10;

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
        ? getMyBranch(pageParam as string | undefined, signal)
        : getBranch(focusParam, pageParam as string | undefined, signal),
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

  const [owesOnly, setOwesOnly] = useState(false);
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
  const shown = filtering
    ? rows.filter((row) => (dccOf(row.id) ?? 0) > 0 || (cellOf(row.id) ?? 0) > 0)
    : rows;

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
      <h1 className="text-2xl font-semibold tracking-tight">Network</h1>
      <p className="text-muted mt-2 max-w-2xl text-sm leading-relaxed">
        The people under your care, one level at a time.
        {month === null
          ? null
          : ` Figures for ${monthLabel(month)}${open ? ', a month still open' : ''}.`}
      </p>

      <Search />

      <div className="mt-6">
        <FailureNotice failure={failure} />
      </div>

      <Breadcrumb entries={entries} meId={me.data?.person_id} />

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
            meId={me.data?.person_id}
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
            <Card label="Direct reports" value={String(person.direct_reports)} />
            <Card label="People beneath" value={String(person.beneath)} />
            <Card
              label="Cell Leaders beneath"
              value={cells.data === undefined ? '—' : String(cells.data.cell_leaders_beneath)}
            />
            <Card
              label={`Behind${month === null ? '' : ` in ${monthLabel(month)}`}`}
              value={`${dcc.data === undefined ? '—' : dcc.data.branch_behind} · ${
                cells.data === undefined ? '—' : cells.data.branch_meetings_behind
              }`}
              note="DCC records · Cell meetings"
            />
          </dl>

          <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">
              {isMe ? 'Reports to you' : `Reports to ${person.full_name}`}
            </h2>
            {filterReady ? (
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={owesOnly}
                  onChange={(event) => setOwesOnly(event.target.checked)}
                  className="size-5"
                />
                Owes records
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
                : `Nobody reports to ${isMe ? 'you' : person.full_name} today.`}
            </p>
          ) : (
            <>
              <Table
                caption={`People reporting to ${person.full_name}`}
                className="mt-4 hidden lg:block"
              >
                <thead>
                  <tr>
                    <HeaderCell>Name</HeaderCell>
                    <HeaderCell className="text-right">Beneath</HeaderCell>
                    <HeaderCell className="text-right">DCC behind</HeaderCell>
                    <HeaderCell className="text-right">Cell behind</HeaderCell>
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
                        <div className="text-muted text-xs">{row.member_id}</div>
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

              <ul className="mt-4 flex flex-col gap-3 lg:hidden">
                {shown.map((row) => (
                  <li key={row.id} className="border-line border p-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <h3 className="text-base font-medium">
                        <Link href={focusHref(row.id)} className={LINK}>
                          {row.full_name}
                        </Link>
                      </h3>
                      <span className="text-muted text-xs">{row.member_id}</span>
                    </div>
                    <dl className="text-muted mt-2 grid grid-cols-3 gap-2 text-sm">
                      <div>
                        <dt>Beneath</dt>
                        <dd className="text-ink tabular-nums">{row.beneath}</dd>
                      </div>
                      <div>
                        <dt>DCC behind</dt>
                        <dd className="text-ink tabular-nums">{figure(dccOf(row.id))}</dd>
                      </div>
                      <div>
                        <dt>Cell behind</dt>
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
              : `Showing ${rows.length} of ${person.direct_reports} · by name`}
          </p>
          {!filtering && branch.hasNextPage ? (
            <p className="mt-3">
              <Button
                variant="secondary"
                onClick={() => void branch.fetchNextPage()}
                disabled={branch.isFetchingNextPage}
              >
                {branch.isFetchingNextPage ? 'Loading…' : 'Show 20 more'}
              </Button>
            </p>
          ) : null}
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
    </main>
  );
}

/**
 * Where a reader outside the pastoral tree starts (decision 0268): the Network roots their
 * scope reaches, by name, each with their whole branch's figures for the month. A root is
 * never moved (section 5), so a row offers Open and nothing else.
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
        You aren&rsquo;t in the pastoral tree, so this starts at the Network roots your scope
        reaches.
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
              <span className="text-muted text-xs">{root.member_id}</span>
            </div>
            <dl className="text-muted mt-2 grid grid-cols-2 gap-2 text-sm lg:grid-cols-4">
              <div>
                <dt>Direct reports</dt>
                <dd className="text-ink tabular-nums">{root.direct_reports}</dd>
              </div>
              <div>
                <dt>Beneath</dt>
                <dd className="text-ink tabular-nums">{root.beneath}</dd>
              </div>
              <div>
                <dt>DCC behind</dt>
                <dd className="text-ink tabular-nums">
                  {figure(dcc[index]?.data?.branch_behind ?? null)}
                </dd>
              </div>
              <div>
                <dt>Cell behind</dt>
                <dd className="text-ink tabular-nums">
                  {figure(cells[index]?.data?.branch_meetings_behind ?? null)}
                </dd>
              </div>
            </dl>
            <div className="mt-3">
              <Link
                href={focusHref(root.id)}
                className={buttonClasses('secondary')}
                aria-label={`Open ${root.full_name}`}
              >
                Open
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function holds(me: SessionDescription | undefined, capability: string): boolean {
  return (me?.capabilities ?? []).some((grant) => grant.capability === capability);
}

function focusHref(personId: string): string {
  return `/network?${new URLSearchParams({ focus: personId }).toString()}`;
}

function figure(value: number | null): string {
  return value === null ? '—' : String(value);
}

function Card({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="border-line border p-3">
      <dt className="text-muted text-xs font-bold tracking-[0.07em] uppercase">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tabular-nums">{value}</dd>
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
  return (
    <span className="inline-flex gap-2">
      {mayMove ? (
        <Button variant="quiet" onClick={onMove} aria-label={`Move ${row.full_name}`}>
          Move
        </Button>
      ) : null}
      <Link
        href={focusHref(row.id)}
        className={buttonClasses('secondary')}
        aria-label={`Open ${row.full_name}`}
      >
        Open
      </Link>
    </span>
  );
}

/**
 * Where the reader is on the path to the focus person. The reader's own position and
 * everything beneath it are links; anything above is plain text (see the page comment).
 */
function Breadcrumb({
  entries,
  meId,
}: {
  entries: readonly PathEntry[];
  meId: string | undefined;
}) {
  if (entries.length === 0) {
    return null;
  }

  const meIndex = entries.findIndex((entry) => entry.id === meId);
  const firstLink = meIndex === -1 ? 0 : meIndex;

  return (
    <nav aria-label="Where this person sits" className="mt-6">
      <ol className="text-muted flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm">
        {entries.map((entry, index) => {
          const current = index === entries.length - 1;

          return (
            <li key={entry.id} className="flex items-center gap-1.5">
              {current ? (
                <span aria-current="page" className="text-ink font-medium">
                  {entry.full_name}
                </span>
              ) : index >= firstLink ? (
                <Link
                  href={entry.id === meId ? '/network' : focusHref(entry.id)}
                  className={`${LINK} text-accent min-w-6 justify-center`}
                >
                  {entry.full_name}
                </Link>
              ) : (
                <span>{entry.full_name}</span>
              )}
              {current ? null : <ChevronRight aria-hidden="true" className="size-3.5 shrink-0" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function FocusBlock({
  person,
  entries,
  noLeaderReason,
  meId,
  isMe,
  mayMove,
  onMove,
}: {
  person: BranchNode;
  entries: readonly PathEntry[];
  noLeaderReason: PastoralPath['no_leader_reason'];
  meId: string | undefined;
  isMe: boolean;
  mayMove: boolean;
  onMove: () => void;
}) {
  const parent = entries.length >= 2 ? entries[entries.length - 2] : null;
  const meIndex = entries.findIndex((entry) => entry.id === meId);
  // Up is offered only where the level above is one the reader may open: never from the
  // reader's own node, and never past it.
  const canGoUp = parent !== null && !isMe && (meIndex === -1 || meIndex < entries.length - 1);

  return (
    <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h2 className="text-xl font-semibold">{person.full_name}</h2>
        <p className="text-muted mt-1 text-sm">
          {person.member_id} &middot;{' '}
          {parent === null ? noLeaderLabel(entries, noLeaderReason) : `reports to ${parent.full_name}`}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {canGoUp && parent !== null ? (
          <Link
            href={parent.id === meId ? '/network' : focusHref(parent.id)}
            className={buttonClasses('secondary')}
          >
            Up one level
          </Link>
        ) : (
          <Button variant="secondary" disabled>
            Up one level
          </Button>
        )}
        {mayMove && !isMe ? (
          <Button variant="secondary" onClick={onMove}>
            Move this person
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Search by name over the reader's own scope — the People search decision 0244 already
 * limits — ten at a time. Choosing a result focuses them.
 */
function Search() {
  const [term, setTerm] = useState('');
  const [asked, setAsked] = useState<string | null>(null);
  const [visible, setVisible] = useState(SEARCH_STEP);

  const results = useInfiniteQuery({
    queryKey: ['network-search', asked],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => searchPeople(asked ?? '', pageParam, signal),
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled: asked !== null,
  });

  const found = results.data?.pages.flatMap((page) => page.data) ?? [];

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setAsked(term.trim());
    setVisible(SEARCH_STEP);
  };

  const more = () => {
    if (visible + SEARCH_STEP > found.length && results.hasNextPage) {
      void results.fetchNextPage();
    }
    setVisible((current) => current + SEARCH_STEP);
  };

  return (
    <div className="mt-6">
      <form role="search" onSubmit={submit} className="flex flex-wrap gap-2">
        <label htmlFor="network-search" className="sr-only">
          Search by name
        </label>
        <input
          id="network-search"
          type="search"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Search by name"
          className="border-edge bg-surface min-h-11 w-full max-w-xs rounded-md border px-3 text-sm"
        />
        <Button
          type="submit"
          variant="secondary"
          disabled={term.trim().length < MINIMUM_SEARCH_LENGTH}
        >
          Search
        </Button>
        {asked === null ? null : (
          <Button
            variant="quiet"
            onClick={() => {
              setAsked(null);
              setTerm('');
            }}
          >
            Clear search
          </Button>
        )}
      </form>

      {asked === null ? null : (
        <div className="mt-4">
          <FailureNotice failure={results.isError ? describeFailure(results.error) : null} />
          {results.isPending ? (
            <p className="text-muted text-sm">Searching&hellip;</p>
          ) : found.length === 0 ? (
            <p className="text-muted text-sm">Nobody by that name in your scope.</p>
          ) : (
            <>
              <ul className="border-line flex flex-col divide-y border">
                {found.slice(0, visible).map((result) => (
                  <li
                    key={result.id}
                    className="flex flex-wrap items-center justify-between gap-2 p-3"
                  >
                    <span>
                      <span className="font-medium">{result.full_name}</span>{' '}
                      <span className="text-muted text-xs">{result.member_id}</span>
                    </span>
                    <Link href={focusHref(result.id)} className={buttonClasses('secondary')}>
                      Open
                    </Link>
                  </li>
                ))}
              </ul>
              {visible < found.length || results.hasNextPage ? (
                <p className="mt-3">
                  <Button variant="secondary" onClick={more} disabled={results.isFetchingNextPage}>
                    Show 10 more
                  </Button>
                </p>
              ) : null}
            </>
          )}
        </div>
      )}
    </div>
  );
}
