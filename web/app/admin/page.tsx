'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

import { AppShell, PAGE_WIDTH } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { CursorPager } from '@/components/ui/cursor-pager';
import { FailureNotice } from '@/components/ui/failure-notice';
import { SearchField } from '@/components/ui/field';
import { FilterChip } from '@/components/ui/filter-chip';
import { CONTROL_BAR, FRAME, TAB_GRID, TAB_PANE, TAB_ROW, tabClasses } from '@/components/ui/frame';
import { HeaderCell, Table, rowClasses } from '@/components/ui/table';
import {
  ACCOUNT_FILTERS,
  type AccountFilter,
  type AccountListRow,
  accountStatusLabel,
  getAccountCounts,
  listAccounts,
} from '@/lib/accounts';
import { listApprovalRequests } from '@/lib/cell-approvals';
import { getCellCounts, getPendingCgCells } from '@/lib/cells';
import { useCursorPages } from '@/lib/cursor-pages';
import { getPendingDccLeaders } from '@/lib/dcc';
import { keepPreviousPage, pageTurnProps } from '@/lib/keep-previous-page';
import { getMe, holdsWholeChurch, roleLabel } from '@/lib/me';
import { describeFailure } from '@/lib/messages';
import { awaitingReassignment } from '@/lib/people';
import { getChurchCounts } from '@/lib/reports';
import { reportingMonthOf } from '@/lib/reporting-month';
import { useScreenAddress } from '@/lib/screen-address';
import { useSearchTerm } from '@/lib/search-term';
import { cn } from '@/lib/utils';

/**
 * The Admin area (SKILL.md section 19, ruling of 2026-11-02, decision 0419): what needs the
 * administrator now, and every account. Settings and Audit Log follow with their routes.
 *
 * For a holder of `accounts.manage` at Whole Church, which the screen guard checks and the API
 * enforces on every read below.
 */
const TABS = [
  ['home', 'Home'],
  ['accounts', 'Accounts'],
] as const;

type AdminTab = (typeof TABS)[number][0];

export default function AdminPage() {
  return (
    <Suspense>
      <AdminScreen />
    </Suspense>
  );
}

function AdminScreen() {
  const search = useSearchParams();
  const go = useScreenAddress();
  const me = useQuery({
    queryKey: ['me'],
    queryFn: ({ signal }) => getMe(signal),
  });
  const tab: AdminTab = search.get('tab') === 'accounts' ? 'accounts' : 'home';
  const administers = me.data !== undefined && holdsWholeChurch(me.data, 'accounts.manage');

  return (
    <AppShell>
      <main id="main" className={PAGE_WIDTH.READING}>
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
          <p className="text-muted text-sm">Running DREAMS for the whole church.</p>
        </div>

        <div role="group" aria-label="Admin" className={cn('mt-6 min-h-11', TAB_GRID, TAB_ROW)}>
          {TABS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={tab === key}
              onClick={() => go({ tab: key === 'home' ? null : key, q: null, filter: null })}
              className={tabClasses(tab === key)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className={TAB_PANE}>
          {!administers ? null : tab === 'accounts' ? <Accounts /> : <Home />}
        </div>
      </main>
    </AppShell>
  );
}

/** A count and the list that resolves it. A count not yet read shows an ellipsis. */
function Tile({
  label,
  value,
  note,
  href,
  action,
}: {
  label: string;
  value: string | null;
  note: string;
  href: string;
  action: string;
}) {
  return (
    <div className={cn(FRAME, 'flex flex-col gap-2 p-4')}>
      <h3 className="field-label">{label}</h3>
      <p className="text-3xl font-semibold tabular-nums">{value ?? '…'}</p>
      <p className="text-muted text-sm">{note}</p>
      <Link
        href={href}
        className="text-accent mt-auto inline-flex min-h-6 items-center text-sm font-bold underline underline-offset-4"
      >
        {action}
      </Link>
    </div>
  );
}

/** A first page's length, with a plus where more pages follow, as Record's tabs count. */
function pageCount(page: { data: unknown[]; next_cursor: string | null } | undefined) {
  return page === undefined ? null : `${page.data.length}${page.next_cursor ? '+' : ''}`;
}

function Home() {
  const approvals = useQuery({
    queryKey: ['cell-approvals'],
    queryFn: ({ signal }) => listApprovalRequests(signal),
  });
  const noLeader = useQuery({
    queryKey: ['awaiting-reassignment', 'admin-home'],
    queryFn: ({ signal }) => awaitingReassignment({ limit: 50 }, signal),
  });
  const accounts = useQuery({
    queryKey: ['account-counts'],
    queryFn: ({ signal }) => getAccountCounts(signal),
  });
  const pendingCg = useQuery({
    queryKey: ['pending-cg', 'admin-home'],
    queryFn: ({ signal }) => getPendingCgCells({}, signal),
  });
  const pendingDcc = useQuery({
    queryKey: ['pending-dcc', 'admin-home'],
    queryFn: ({ signal }) => getPendingDccLeaders({}, signal),
  });
  const cells = useQuery({
    queryKey: ['cell-counts'],
    queryFn: ({ signal }) => getCellCounts(signal),
  });
  const month = reportingMonthOf();
  const church = useQuery({
    queryKey: ['church-counts', month],
    queryFn: ({ signal }) => getChurchCounts(month, signal),
  });

  const failed = [approvals, noLeader, accounts, pendingCg, pendingDcc, cells, church].find(
    (query) => query.isError,
  );
  const number = (value: number | undefined) =>
    value === undefined ? null : value.toLocaleString('en-PH');

  return (
    <>
      <FailureNotice failure={failed ? describeFailure(failed.error) : null} />

      <h2 className="mt-5 text-lg font-semibold">Needs you now</h2>
      <p className="text-muted text-sm">Whole Church, as of now. Each one opens its list.</p>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          label="Cells to approve"
          value={approvals.data === undefined ? null : String(approvals.data.length)}
          note="New Cells and handovers waiting for a decision"
          href="/cells?view=APPROVE"
          action="Review"
        />
        <Tile
          label="No Leader Yet"
          value={pageCount(noLeader.data)}
          note="People whose leader has no assignment"
          href="/people/awaiting-leader"
          action="Assign leaders"
        />
        <Tile
          label="Accounts not activated"
          value={number(accounts.data?.pending_activation)}
          note="Activation email sent, account not opened yet"
          href="/admin?tab=accounts&filter=PENDING_ACTIVATION"
          action="Resend or correct"
        />
        <Tile
          label="Sign-ins paused"
          value={number(accounts.data?.paused)}
          note="Paused after 10 wrong passwords in a row"
          href="/admin?tab=accounts&filter=PAUSED"
          action="See who"
        />
      </div>

      <h2 className="mt-8 text-lg font-semibold">Still to record</h2>
      <p className="text-muted text-sm">Whole Church, weeks still open.</p>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          label="Pending CG Records"
          value={pageCount(pendingCg.data)}
          note="Cell Groups with a meeting not recorded"
          href="/dashboard?list=behind"
          action="Open the list"
        />
        <Tile
          label="Pending DCC Records"
          value={pageCount(pendingDcc.data)}
          note="Leaders who owe a Sunday"
          href="/dashboard?list=dcc"
          action="Open the list"
        />
      </div>

      <h2 className="mt-8 text-lg font-semibold">The church</h2>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Area
          title="People and accounts"
          lines={[
            ['People this month', number(church.data?.whole_church.people)],
            ['Accounts', number(accounts.data?.all)],
            ['Active', number(accounts.data?.active)],
            ['Disabled', number(accounts.data?.disabled)],
          ]}
          links={[
            ['Add a person', '/people/new'],
            ['Find a person', '/people'],
            ['All accounts', '/admin?tab=accounts'],
          ]}
        />
        <Area
          title="Cells"
          lines={[
            ['Active Cells', number(cells.data?.in_scope)],
            ['Cell Leaders this month', number(church.data?.whole_church.cell_leaders)],
          ]}
          links={[
            ['New Cell', '/cells/new'],
            ['Under 3 Members', '/cells?view=FEW'],
            ['Inactive 3+ Months', '/cells?view=QUIET'],
            ['Time Clashes', '/cells?view=CLASH'],
            ['Closed Cells', '/cells?view=CLOSED'],
          ]}
        />
      </div>
    </>
  );
}

function Area({
  title,
  lines,
  links,
}: {
  title: string;
  lines: [string, string | null][];
  links: [string, string][];
}) {
  return (
    <section aria-label={title} className={cn(FRAME, 'flex flex-col p-4')}>
      <h3 className="text-base font-semibold">{title}</h3>
      <dl className="mt-3 flex flex-col gap-1.5 text-sm">
        {lines.map(([term, value]) => (
          <div key={term} className="flex justify-between gap-4">
            <dt className="text-muted">{term}</dt>
            <dd className="font-semibold tabular-nums">{value ?? '…'}</dd>
          </div>
        ))}
      </dl>
      <ul className="border-line mt-4 flex flex-col gap-1 border-t pt-3 text-sm">
        {links.map(([label, href]) => (
          <li key={label}>
            <Link
              href={href}
              className="text-accent inline-flex min-h-6 items-center underline underline-offset-4"
            >
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

const FILTER_LABELS: Record<AccountFilter, string> = {
  ALL: 'All',
  ACTIVE: 'Active',
  PENDING_ACTIVATION: 'Waiting for activation',
  PAUSED: 'Sign-ins paused',
  NO_SECOND_STEP: 'Second step not set up',
  DISABLED: 'Disabled',
};

/** What a row's state reads: the account's status, and a paused sign-in beside it. */
function stateOf(row: AccountListRow): string {
  const status = accountStatusLabel(row.status);
  return row.paused_until ? `${status}, sign-in paused` : status;
}

/** What is set on the account, in a few words. */
function detailsOf(row: AccountListRow): string {
  if (row.status === 'PENDING_ACTIVATION') {
    // When the account was given, not when its latest email went: a resend is not recorded here.
    return `Given ${new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'short',
      timeZone: 'Asia/Manila',
    }).format(new Date(row.created_at))}`;
  }
  if (row.second_step.required) {
    return row.second_step.set_up_at ? 'Second step set up' : 'Second step not set up';
  }
  const ticks = [
    row.full_view ? 'Full view' : null,
    row.approves_cells ? 'Approves Cells' : null,
    row.moves_people ? 'Moves people' : null,
  ].filter((tick): tick is string => tick !== null);
  return ticks.length > 0 ? ticks.join(', ') : 'Recording only';
}

function Accounts() {
  const search = useSearchParams();
  const go = useScreenAddress();
  const submitted = search.get('q') ?? '';
  const filterParam = search.get('filter');
  const filter: AccountFilter = ACCOUNT_FILTERS.includes(filterParam as AccountFilter)
    ? (filterParam as AccountFilter)
    : 'ALL';
  const { term, setTerm, trimmed, tooShort, buttonLabel } = useSearchTerm(submitted);
  const pages = useCursorPages(`${submitted}|${filter}`);

  const counts = useQuery({
    queryKey: ['account-counts'],
    queryFn: ({ signal }) => getAccountCounts(signal),
  });
  const key = ['accounts', submitted, filter, pages.cursor];
  const accounts = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => listAccounts({ q: submitted, filter, cursor: pages.cursor }, signal),
    placeholderData: keepPreviousPage(key, 3),
  });

  return (
    <>
      <div className={`mt-4 ${CONTROL_BAR}`}>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!tooShort) {
              go({ q: trimmed });
            }
          }}
          className="flex w-full min-w-0"
          noValidate
        >
          <SearchField
            label="Search accounts by name, username or email"
            name="q"
            autoComplete="off"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            action={
              <Button type="submit" disabled={tooShort}>
                {buttonLabel}
              </Button>
            }
          />
        </form>
        {counts.data ? (
          <p id="account-counts" className="sr-only">
            {ACCOUNT_FILTERS.map(
              (each) =>
                `${FILTER_LABELS[each]} ${counts.data[each.toLowerCase() as Lowercase<AccountFilter>]}`,
            ).join(', ')}
          </p>
        ) : null}
        <div
          role="group"
          aria-label="Show"
          aria-describedby={counts.data ? 'account-counts' : undefined}
          className="flex flex-wrap gap-3"
        >
          {ACCOUNT_FILTERS.map((each) => {
            const count = counts.data?.[each.toLowerCase() as Lowercase<AccountFilter>];
            return (
              <FilterChip
                key={each}
                pressed={filter === each}
                // One on at a time (decision 0419): pressing the one on returns to All.
                onChange={(next) => go({ filter: next && each !== 'ALL' ? each : null })}
              >
                {FILTER_LABELS[each]}
                {/* Hidden from the name, which never changes (the chip's contract); the count
                    is read from the group's description below instead. */}
                {count === undefined ? null : (
                  <span aria-hidden="true" className="tabular-nums">
                    {count}
                  </span>
                )}
              </FilterChip>
            );
          })}
        </div>
      </div>

      <div className="mt-6">
        <FailureNotice failure={accounts.isError ? describeFailure(accounts.error) : null} />
      </div>

      <div {...pageTurnProps(accounts.isPlaceholderData)}>
        {accounts.isPending ? (
          <p className="text-muted mt-6 text-sm">Loading&hellip;</p>
        ) : accounts.data && accounts.data.data.length === 0 ? (
          <p className="text-muted mt-6 text-sm">
            {submitted !== ''
              ? `No account matches “${submitted}”.`
              : 'No account is in this list.'}
          </p>
        ) : accounts.data ? (
          <>
            <Table caption="Accounts" className="mt-6 hidden lg:block">
              <thead>
                <tr>
                  <HeaderCell>Person</HeaderCell>
                  <HeaderCell>Role</HeaderCell>
                  <HeaderCell>State</HeaderCell>
                  <HeaderCell>Details</HeaderCell>
                </tr>
              </thead>
              <tbody>
                {accounts.data.data.map((row) => (
                  <tr key={row.account_id} className={rowClasses}>
                    <td className="px-3 py-3">
                      <Link
                        href={`/people/${row.person_id}`}
                        className="inline-flex min-h-6 items-center underline underline-offset-4"
                      >
                        {row.name}
                      </Link>
                      <span className="text-muted block text-sm">{row.username ?? row.email}</span>
                    </td>
                    <td className="px-3 py-3">{row.roles.map(roleLabel).join(', ')}</td>
                    <td className="px-3 py-3">{stateOf(row)}</td>
                    <td className="text-muted px-3 py-3">{detailsOf(row)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>

            <ul className="mt-6 flex flex-col gap-3 lg:hidden">
              {accounts.data.data.map((row) => (
                <li key={row.account_id} className={cn(FRAME, 'p-4')}>
                  <Link
                    href={`/people/${row.person_id}`}
                    className="inline-flex min-h-6 items-center font-semibold underline underline-offset-4"
                  >
                    {row.name}
                  </Link>
                  <p className="text-muted text-sm break-all">{row.username ?? row.email}</p>
                  <p className="mt-2 text-sm">
                    {row.roles.map(roleLabel).join(', ')} · {stateOf(row)}
                  </p>
                  <p className="text-muted text-sm">{detailsOf(row)}</p>
                </li>
              ))}
            </ul>

            <CursorPager
              label="Accounts"
              page={pages.page}
              nextCursor={accounts.data.next_cursor}
              onPrevious={pages.previous}
              onNext={() => pages.next(accounts.data?.next_cursor)}
            />
          </>
        ) : null}
      </div>
    </>
  );
}
