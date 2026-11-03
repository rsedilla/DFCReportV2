'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';

import { AppShell, PAGE_WIDTH } from '@/components/app-shell';
import { EncounterSeasonsFrame } from '@/components/encounter-seasons-frame';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
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
import {
  AUDIT_KINDS,
  AUDIT_KIND_LABELS,
  type AuditEntry,
  type AuditKind,
  type AuditLogPage,
  SEARCH_PEOPLE_CEILING,
  describeEntry,
  entryAbout,
  entryActor,
  entryWhen,
  listAuditLog,
} from '@/lib/audit-log';
import { listApprovalRequests } from '@/lib/cell-approvals';
import { getCellCounts, getPendingCgCells } from '@/lib/cells';
import { useCursorPages } from '@/lib/cursor-pages';
import { getPendingDccLeaders } from '@/lib/dcc';
import { dayLabel } from '@/lib/encounters';
import { idempotencyKeyFor } from '@/lib/idempotency';
import { keepPreviousPage, pageTurnProps } from '@/lib/keep-previous-page';
import { getMe, holdsWholeChurch, roleLabel } from '@/lib/me';
import { describeFailure } from '@/lib/messages';
import { awaitingReassignment } from '@/lib/people';
import { getChurchCounts } from '@/lib/reports';
import { reportingMonthOf } from '@/lib/reporting-month';
import { useScreenAddress } from '@/lib/screen-address';
import { useSearchTerm } from '@/lib/search-term';
import {
  closeInitialEncoding,
  getSettings,
  setCellAttentionMonths,
  setRecordVerse,
  type RecordVerse,
} from '@/lib/settings';
import { cn } from '@/lib/utils';

/**
 * The Admin area (SKILL.md section 19, ruling of 2026-11-02, decision 0419): what needs the
 * administrator now, every account, the church-wide settings (decision 0425), and the audit
 * log (decision 0428).
 *
 * For a holder of `accounts.manage` at Whole Church, which the screen guard checks and the API
 * enforces on every read below; the Audit Log is read under `audit.view` at Whole Church,
 * which the Admin role holds beside it.
 */
const TABS = [
  ['home', 'Home'],
  ['accounts', 'Accounts'],
  ['settings', 'Settings'],
  ['audit', 'Audit Log'],
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
  const asked = search.get('tab');
  const tab: AdminTab =
    asked === 'accounts' || asked === 'settings' || asked === 'audit' ? asked : 'home';
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
              onClick={() =>
                go({ tab: key === 'home' ? null : key, q: null, filter: null, kind: null })
              }
              className={tabClasses(tab === key)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className={TAB_PANE}>
          {!administers ? null : tab === 'accounts' ? (
            <Accounts />
          ) : tab === 'settings' ? (
            <Settings />
          ) : tab === 'audit' ? (
            <AuditLog />
          ) : (
            <Home />
          )}
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
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: ({ signal }) => getSettings(signal),
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
      {/* How far the DCC calendar reaches (section 9), read beside the settings that keep it. */}
      {settings.data ? (
        <p
          className={cn(
            FRAME,
            'mt-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3 text-sm',
          )}
        >
          <span>
            <span className="font-semibold">DCC calendar</span>{' '}
            <span className="text-muted">Sundays added ahead every month</span>
          </span>
          <span className="font-semibold">
            {settings.data.dcc_calendar_through
              ? `Ready to ${dayLabel(settings.data.dcc_calendar_through)}`
              : 'Not generated yet'}{' '}
            <Link
              href="/admin?tab=settings"
              className="text-accent ml-2 inline-flex min-h-6 items-center font-semibold underline underline-offset-4"
            >
              Settings
            </Link>
          </span>
        </p>
      ) : null}
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
            [`Inactive ${cells.data?.attention_months ?? 3}+ Months`, '/cells?view=QUIET'],
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

/**
 * The whole audit log, newest first (decision 0428): searched by a person's name or Member ID
 * or a Cell ID, and narrowed by one chip at a time. Reading it is not itself logged.
 */
function AuditLog() {
  const search = useSearchParams();
  const go = useScreenAddress();
  const submitted = search.get('q') ?? '';
  const kindParam = search.get('kind');
  const kind: AuditKind = AUDIT_KINDS.includes(kindParam as AuditKind)
    ? (kindParam as AuditKind)
    : 'EVERYTHING';
  const { term, setTerm, trimmed, tooShort, buttonLabel } = useSearchTerm(submitted);
  const pages = useCursorPages(`${submitted}|${kind}`);

  const key = ['audit-log', submitted, kind, pages.cursor];
  const log = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => listAuditLog({ q: submitted, kind, cursor: pages.cursor }, signal),
    placeholderData: keepPreviousPage(key, 3),
  });
  const names = log.data?.names ?? {};

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
            label="Search by person, Member ID or Cell ID"
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
        <div role="group" aria-label="Show" className="flex flex-wrap gap-3">
          {AUDIT_KINDS.map((each) => (
            <FilterChip
              key={each}
              pressed={kind === each}
              // One on at a time: pressing the one on returns to Everything.
              onChange={(next) => go({ kind: next && each !== 'EVERYTHING' ? each : null })}
            >
              {AUDIT_KIND_LABELS[each]}
            </FilterChip>
          ))}
        </div>
      </div>

      <p className="text-muted mt-4 text-sm">
        Everything recorded, newest first. Reading it is not itself recorded.
      </p>

      {/* A search that matched more people than are looked through says so (decision 0429). */}
      {log.data?.truncated ? (
        <p role="status" className="mt-4 text-sm font-medium">
          More than {SEARCH_PEOPLE_CEILING.toLocaleString('en-US')} people match “{submitted}”, so
          some entries may not be shown. Type more of the name, or use a Member ID.
        </p>
      ) : null}

      <div className="mt-6">
        <FailureNotice failure={log.isError ? describeFailure(log.error) : null} />
      </div>

      <div {...pageTurnProps(log.isPlaceholderData)}>
        {log.isPending ? (
          <p className="text-muted mt-6 text-sm">Loading&hellip;</p>
        ) : log.data && log.data.data.length === 0 ? (
          <p className="text-muted mt-6 text-sm">
            {submitted !== '' ? `Nothing in the log matches “${submitted}”.` : 'Nothing is in this list.'}
          </p>
        ) : log.data ? (
          <>
            <Table caption="Audit Log" className="mt-6 hidden lg:block">
              <thead>
                <tr>
                  <HeaderCell>When</HeaderCell>
                  <HeaderCell>Who did it</HeaderCell>
                  <HeaderCell>What</HeaderCell>
                  <HeaderCell>About</HeaderCell>
                </tr>
              </thead>
              <tbody>
                {log.data.data.map((entry) => {
                  const { what, detail } = describeEntry(entry, names);
                  return (
                    <tr key={entry.id} className={rowClasses}>
                      <td className="px-3 py-3 text-sm whitespace-nowrap">{entryWhen(entry.occurred_at)}</td>
                      <td className="px-3 py-3">{entryActor(entry, names)}</td>
                      <td className="px-3 py-3">
                        {what}
                        {detail ? <span className="text-muted block text-sm">{detail}</span> : null}
                      </td>
                      <td className="px-3 py-3">
                        <EntryAbout entry={entry} names={names} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>

            <ul className="mt-6 flex flex-col gap-3 lg:hidden">
              {log.data.data.map((entry) => {
                const { what, detail } = describeEntry(entry, names);
                return (
                  <li key={entry.id} className={cn(FRAME, 'p-4')}>
                    <p className="text-muted text-sm">{entryWhen(entry.occurred_at)}</p>
                    <p className="mt-1 font-semibold">{what}</p>
                    {detail ? <p className="text-muted text-sm break-words">{detail}</p> : null}
                    <p className="mt-2 text-sm">
                      About <EntryAbout entry={entry} names={names} /> · by {entryActor(entry, names)}
                    </p>
                  </li>
                );
              })}
            </ul>

            <CursorPager
              label="Audit Log"
              page={pages.page}
              nextCursor={log.data.next_cursor}
              onPrevious={pages.previous}
              onNext={() => pages.next(log.data?.next_cursor)}
            />
          </>
        ) : null}
      </div>
    </>
  );
}

/** What an entry was about, linked where it has a page. */
function EntryAbout({ entry, names }: { entry: AuditEntry; names: AuditLogPage['names'] }) {
  const about = entryAbout(entry, names);
  return about.href === null ? (
    <span>{about.label}</span>
  ) : (
    <Link href={about.href} className="inline-flex min-h-6 items-center underline underline-offset-4">
      {about.label}
    </Link>
  );
}

/** Two to six months, three the usual (decision 0425). */
const MONTH_CHOICES = [2, 3, 4, 5, 6];

/**
 * The church-wide settings (SKILL.md section 7, decision 0425), each changed under
 * `settings.manage` and kept in the Audit Log with its old and new value. The DCC calendar's
 * first Sunday is shown and not changed here: the scheduled command sets it once, and moving
 * it changes which months are filled. Initial encoding is closed once and never reopened.
 */
function Settings() {
  const queries = useQueryClient();
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: ({ signal }) => getSettings(signal),
  });
  const [months, setMonths] = useState<number | null>(null);
  // One per opening of an editor: every save of that edit, retries included, sends one key,
  // and the next edit another, so changing back to an earlier value is never a replay of it.
  const [editKey, setEditKey] = useState(() => crypto.randomUUID());
  const [verse, setVerse] = useState<{ text: string; reference: string } | null>(null);
  const [confirming, setConfirming] = useState(false);

  // Both left empty clears the verse; the API refuses one without the other.
  const verseBody = (draft: { text: string; reference: string }): RecordVerse =>
    draft.text.trim() === '' && draft.reference.trim() === ''
      ? { text: null, reference: null }
      : { text: draft.text.trim(), reference: draft.reference.trim() };
  // **Each key carries the edit it belongs to.** The server answers a key it has seen with the
  // stored answer for a day, so a key built from the value alone made changing back to an
  // earlier value replay that earlier save and store nothing (found on the live site,
  // 2026-11-02). A retry of the same save still sends the same key.
  const saveVerse = useMutation({
    mutationFn: (draft: { text: string; reference: string }) =>
      setRecordVerse(verseBody(draft), idempotencyKeyFor('record-verse', editKey, verseBody(draft))),
    onSuccess: async (data) => {
      queries.setQueryData(['settings'], data);
      setVerse(null);
      await queries.invalidateQueries({ queryKey: ['record-verse'] });
    },
  });

  const saveMonths = useMutation({
    mutationFn: (value: number) =>
      setCellAttentionMonths(
        value,
        idempotencyKeyFor('cell-attention-months', editKey, value),
      ),
    onSuccess: async (data) => {
      queries.setQueryData(['settings'], data);
      setMonths(null);
      await queries.invalidateQueries({ queryKey: ['cells'] });
    },
  });
  const close = useMutation({
    mutationFn: () => closeInitialEncoding(idempotencyKeyFor('close-initial-encoding')),
    onSuccess: (data) => {
      queries.setQueryData(['settings'], data);
      setConfirming(false);
    },
  });

  const data = settings.data;

  return (
    <>
      <FailureNotice failure={settings.isError ? describeFailure(settings.error) : null} />

      <h2 className="mt-5 text-lg font-semibold">Church-wide settings</h2>
      <p className="text-muted text-sm">
        Each change applies to the whole church and is kept in the Audit Log with its old and new
        value.
      </p>

      {!data ? (
        settings.isPending ? (
          <p className="text-muted mt-3 text-sm">Loading&hellip;</p>
        ) : null
      ) : (
        <div className={cn(FRAME, 'mt-3 py-0')}>
          <SettingRow
            title="Verse on Record"
            help="Encouragement shown under the welcome on Record, to every leader."
            value={data.record_verse.reference ?? 'No verse'}
            action={
              verse === null ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    saveVerse.reset();
                    setEditKey(crypto.randomUUID());
                    setVerse({
                      text: data.record_verse.text ?? '',
                      reference: data.record_verse.reference ?? '',
                    });
                  }}
                >
                  Change
                </Button>
              ) : null
            }
          >
            {verse !== null ? (
              <form
                className="mt-3 flex max-w-3xl flex-col gap-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  saveVerse.mutate(verse);
                }}
              >
                <label className="flex flex-col gap-1 text-sm">
                  <span className="field-label">Verse</span>
                  <textarea
                    value={verse.text}
                    rows={4}
                    maxLength={600}
                    onChange={(event) => setVerse({ ...verse, text: event.target.value })}
                    className="border-edge bg-surface focus-visible:outline-accent rounded-md border px-3 py-2 leading-relaxed focus-visible:outline-2 focus-visible:outline-offset-2"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="field-label">Reference</span>
                  <input
                    value={verse.reference}
                    maxLength={60}
                    onChange={(event) => setVerse({ ...verse, reference: event.target.value })}
                    className="border-edge bg-surface focus-visible:outline-accent min-h-11 rounded-md border px-3 focus-visible:outline-2 focus-visible:outline-offset-2"
                  />
                </label>
                <p className="text-muted text-xs">
                  Shown to every account under the welcome on Record, with its translation, such
                  as 1 Peter 5:2 (NIV). Leave both empty to show no verse.
                </p>
                <FailureNotice
                  failure={saveVerse.isError ? describeFailure(saveVerse.error) : null}
                />
                <div className="flex flex-wrap gap-3">
                  <Button type="submit" disabled={saveVerse.isPending}>
                    {saveVerse.isPending ? 'Saving…' : 'Save'}
                  </Button>
                  <Button variant="secondary" onClick={() => setVerse(null)}>
                    Cancel
                  </Button>
                </div>
              </form>
            ) : null}
          </SettingRow>

          <SettingRow
            title="No meeting in"
            help="A Cell with no meeting held for this long is listed under Cells, Needs Attention."
            value={`${data.cell_attention_months} ${data.cell_attention_months === 1 ? 'month' : 'months'}`}
            action={
              months === null ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    saveMonths.reset();
                    setEditKey(crypto.randomUUID());
                    setMonths(data.cell_attention_months);
                  }}
                >
                  Change
                </Button>
              ) : null
            }
          >
            {months !== null ? (
              <form
                className="mt-3 flex flex-wrap items-end gap-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  saveMonths.mutate(months);
                }}
              >
                <label className="flex flex-col gap-1 text-sm">
                  <span className="field-label">Months</span>
                  <select
                    value={months}
                    onChange={(event) => setMonths(Number(event.target.value))}
                    className="border-edge bg-surface focus-visible:outline-accent min-h-11 rounded-md border px-3 focus-visible:outline-2 focus-visible:outline-offset-2"
                  >
                    {MONTH_CHOICES.map((choice) => (
                      <option key={choice} value={choice}>
                        {choice} months{choice === 3 ? ' (usual)' : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="text-muted w-full text-xs">
                  3 is the usual. Choose 2 for closer care, 4 to 6 for a long break such as the
                  holidays.
                </p>
                <Button type="submit" disabled={saveMonths.isPending}>
                  {saveMonths.isPending ? 'Saving…' : 'Save'}
                </Button>
                <Button variant="secondary" onClick={() => setMonths(null)}>
                  Cancel
                </Button>
                <div className="w-full">
                  <FailureNotice
                    failure={saveMonths.isError ? describeFailure(saveMonths.error) : null}
                  />
                </div>
              </form>
            ) : null}
          </SettingRow>

          <SettingRow
            title="DCC calendar"
            help="Sundays are added a year ahead, every month, without anyone doing it."
            note={
              data.dcc_calendar_start
                ? `Starts Sunday ${dayLabel(data.dcc_calendar_start)}.`
                : 'No Sunday has been added yet.'
            }
            value={
              data.dcc_calendar_through
                ? `Ready to ${dayLabel(data.dcc_calendar_through)}`
                : 'Not generated yet'
            }
          />

          <SettingRow
            title="Initial encoding"
            help="While open, an administrator may add a Cell directly, without a request."
            note={
              data.initial_encoding_open
                ? 'Closing it is done once and cannot be undone.'
                : 'Closed. Every new Cell goes through request and approval.'
            }
            value={data.initial_encoding_open ? 'Open' : 'Closed'}
            action={
              data.initial_encoding_open ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    close.reset();
                    setConfirming(true);
                  }}
                >
                  Close Encoding
                </Button>
              ) : null
            }
          />
        </div>
      )}

      <h2 className="mt-8 text-lg font-semibold">Encounter God Weekend</h2>
      <p className="text-muted text-sm">
        Shown to each Network’s leaders on SUYNL’s Getting Ready for the Encounter.
      </p>
      <EncounterSeasonsFrame editable />

      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Close initial encoding?"
      >
        <p className="text-sm leading-relaxed">
          After this, an administrator can no longer add a Cell directly: every new Cell is
          requested and approved. It cannot be opened again.
        </p>
        <div className="mt-3">
          <FailureNotice failure={close.isError ? describeFailure(close.error) : null} />
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          <Button onClick={() => close.mutate()} disabled={close.isPending}>
            {close.isPending ? 'Closing…' : 'Close Encoding'}
          </Button>
          <Button variant="secondary" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        </div>
      </Dialog>
    </>
  );
}

function SettingRow({
  title,
  help,
  note,
  value,
  action,
  children,
}: {
  title: string;
  help: string;
  note?: string;
  value: string;
  action?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <section aria-label={title} className="border-line border-t py-4 first:border-t-0">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <div className="min-w-0 flex-[1_1_16rem]">
          <h3 className="font-semibold">{title}</h3>
          <p className="text-muted mt-1 text-sm">{help}</p>
          {note ? <p className="text-muted mt-1 text-xs">{note}</p> : null}
        </div>
        <p className="font-bold sm:min-w-32 sm:text-right">{value}</p>
        {action}
      </div>
      {children}
    </section>
  );
}
