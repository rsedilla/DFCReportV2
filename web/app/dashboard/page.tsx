'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { AppShell, PAGE_WIDTH } from '@/components/app-shell';
import {
  LeaderRecordingStatusPanel,
  RecordingStatusPanel,
  type OpenPending,
} from '@/components/recording-status';
import {
  DccBranchQueue,
  DccChecklistGrid,
  LeaderChecklistGrid,
  LeaderGroups,
  NO_PENDING_FILTER,
  LIST,
  PendingCgPane,
  PendingDccPane,
  QueueList,
  TabBar,
  groupByLeader,
  shownCount,
  type ChosenLeader,
} from '@/components/record-lists';
import {
  usePendingRecords,
  useUpdateRecordsQueue,
  type QueueFilter,
  type Whose,
} from '@/components/record-queue';
import { isBranchReader } from '@/components/reports-tabs';
import { SentRequests } from '@/components/sent-requests';
import { FailureNotice } from '@/components/ui/failure-notice';
import { CONTROL_BAR, TAB_PANE, TAB_ROW } from '@/components/ui/frame';
import { RadioGroup } from '@/components/ui/radio-group';
import { ViewSwitch } from '@/components/ui/view-switch';
import { getMe, holdsWholeChurch } from '@/lib/me';
import { describeFailure } from '@/lib/messages';
import {
  dayLabel,
  monthLabel,
  reportingMonthOf,
  shiftMonth,
  todayInManila,
} from '@/lib/reporting-month';
import { useScreenAddress } from '@/lib/screen-address';
import { mayStillBeOpen, monthOpenUntilLabel } from '@/lib/weekly-deadline';
import { cn } from '@/lib/utils';

/**
 * Where a signed-in leader lands (SKILL.md section 19).
 *
 * **Outstanding work, and that is the whole design.** Section 19 is blunt about it:
 * "A dashboard of counts tells a leader nothing to act on." So the screen opens on three
 * lists of recording work, one at a time, each with its count (decisions 0290 and 0336):
 * what awaits a record, the Cells behind and the leaders behind on DCC. The people needing a
 * new leader and the people not in a Cell are on People and Cells (decision 0381). It carries
 * no month figures (decision 0343).
 *
 * **The queue shows the leader's own work by default, and their branch's on request**
 * (decision 0258, reversing the owner's choice of 2026-09-15).
 *
 * **Nothing here is ranked or colour-graded** (sections 13, 17 and 19). The queue is
 * in date order, oldest first, and says so; the other lists are filtered rather than
 * sorted, in the order the API returns.
 */
export default function DashboardPage() {
  return (
    <AppShell>
      <Dashboard />
    </AppShell>
  );
}

function Dashboard() {
  const month = reportingMonthOf();
  const today = todayInManila();
  const previousMonth = shiftMonth(month, -1);

  // **While last month may still be open**: until its last week closes, between the 22nd
  // and the 28th (section 13, decisions 0335 and 0387), or the 7th for a month before the weekly
  // rule. Section 13 has every leader see their own outstanding work "always" (owner's
  // choice of 2026-09-15). The browser's clock only decides whether to ask; the server's
  // `open` flag and each row's own week decide what is shown.
  const inCloseWeek = mayStillBeOpen(previousMonth, today);

  // Which list, which kind and whose are in the address, so Back from a meeting or a
  // checklist returns to the list it was opened from. The defaults drop out of it.
  const search = useSearchParams();
  const go = useScreenAddress();
  const tab: RecordTab = RECORD_TABS.find((key) => key === search.get('list')) ?? 'awaiting';
  const filter: QueueFilter = search.get('kind') === 'dcc' ? 'DCC' : 'CELLS';
  // The reader's own work is the default (decision 0258). The radio follows the click at
  // once and the address a moment later, as on the Cells list; the address still decides,
  // so Back moves it.
  const whoseInAddress: Whose = search.get('whose') === 'branch' ? 'branch' : 'mine';
  const [whose, setWhose] = useState(whoseInAddress);
  const [lastWhose, setLastWhose] = useState(whoseInAddress);
  if (lastWhose !== whoseInAddress) {
    setLastWhose(whoseInAddress);
    setWhose(whoseInAddress);
  }
  const me = useQuery({ queryKey: ['me'], queryFn: ({ signal }) => getMe(signal) });
  const router = useRouter();
  // **The two Awaiting lists left Record** (decision 0381): an address that still names one,
  // a saved link or Back, opens it where it now is.
  const moved = search.get('list');
  useEffect(() => {
    if (moved === 'nocell') {
      router.replace('/cells?view=NOCELL');
    } else if (moved === 'leader') {
      router.replace('/people/awaiting-leader');
    }
  }, [moved, router]);

  // **A Recording-only account sees Awaiting a record and nothing else** (section 19,
  // decision 0323): no other list, and Leaders Under Me only while the
  // server says a leader holding an account sits directly beneath it.
  const recordingOnly = me.data?.screens === 'RECORDING';
  // **The Senior Pastors' Record has two tabs, Recording Progress first** (decision 0325):
  // their own Awaiting a record with no Leaders Under Me, and none of the other lists.
  const seniorPastor = me.data?.screens === 'SENIOR_PASTOR';
  const spTab: 'status' | 'awaiting' = search.get('list') === 'awaiting' ? 'awaiting' : 'status';
  const fullRecord = me.data !== undefined && !recordingOnly && !seniorPastor;
  // **Recording Progress, last, for a reader who reads reports over their own branch**
  // (decision 0334): a Full view leader, whose Leader default gives `reports.view_subtree` that scope.
  const leaderStatus =
    fullRecord &&
    (me.data?.capabilities ?? []).some(
      (grant) => grant.capability === 'reports.view_subtree' && grant.scope_type === 'OWN_SUBTREE',
    );
  // **An Admin's Record carries the church-wide one, last** (decision 0335): the reader who
  // amends a closed week sees what went late. Keyed on the capability, never on the role.
  const churchStatus = fullRecord && holdsWholeChurch(me.data, 'reports.view_subtree');
  const listTab: RecordTab =
    recordingOnly || seniorPastor || (tab === 'status' && !leaderStatus && !churchStatus)
      ? 'awaiting'
      : tab;
  // **Leaders Under Me is hidden from a Full view leader** (decision 0382): their branch's work
  // is on Pending CG Records and Pending DCC Records. Hidden rather than removed, the owner
  // planning it as a feature later. The Admin keeps it, and a Leader without Full view sees it
  // while a leader holding an account sits directly beneath them (decision 0323).
  const mayOversee = me.data?.people_i_oversee !== false && !isBranchReader(me.data);
  const shownWhose: Whose = mayOversee ? whose : 'mine';
  const branchView = shownWhose === 'branch';
  // The branch is asked for only once the account says the reader may have one.
  const whoseKnown = !branchView || me.data !== undefined;

  // The leader whose DCC checklist is open under the branch view (decision 0301). Cleared
  // when the list or the view changes, so a list switched away from does not come back open.
  const [chosenLeader, setChosenLeader] = useState<ChosenLeader | null>(null);
  // The leader whose checklist is open under Pending DCC Records (decision 0336).
  const [pendingChosen, setPendingChosen] = useState<ChosenLeader | null>(null);
  const [chosenFor, setChosenFor] = useState(`${filter}|${whose}`);
  if (chosenFor !== `${filter}|${whose}`) {
    setChosenFor(`${filter}|${whose}`);
    setChosenLeader(null);
  }

  const {
    pendingFilter,
    setPendingFilter,
    pendingDccPages,
    pendingDcc,
    cgFilter,
    setCgFilter,
    pendingCgPages,
    pendingCg,
  } = usePendingRecords(fullRecord);

  // **A Recording Progress figure opens its Pending list for that leader's branch** (decision
  // 0370), filtered afresh so a search or Late only left from before does not hide it.
  const openPending: OpenPending = (list, leader) => {
    if (list === 'cell') {
      setCgFilter({ ...NO_PENDING_FILTER, leader });
    } else {
      setPendingFilter({ ...NO_PENDING_FILTER, leader });
    }
    go({ list: list === 'cell' ? 'behind' : 'dcc' });
  };

  const {
    awaiting,
    dccEvents,
    recordableEvents,
    checklists,
    checklistFailed,
    previousFailed,
    queue,
    queuePending,
    queueFailed,
    owedRows,
    owedPending,
    owedFailure,
  } = useUpdateRecordsQueue({
    month,
    previousMonth,
    inCloseWeek,
    shownWhose,
    branchView,
    whoseKnown,
  });

  const shown = queue.filter((item) => (filter === 'CELLS') === (item.kind === 'cell'));

  const failure = awaiting.isError
    ? describeFailure(awaiting.error)
    : dccEvents.isError
      ? describeFailure(dccEvents.error)
      : checklistFailed
        ? describeFailure(checklistFailed.error)
        : previousFailed
          ? describeFailure(previousFailed.error)
          : owedFailure
            ? describeFailure(owedFailure.error)
          : pendingCgPages.isError
              ? describeFailure(pendingCgPages.error)
              : pendingDccPages.isError
                ? describeFailure(pendingDccPages.error)
                      : me.isError
                        ? describeFailure(me.error)
                        : null;

  // The DCC count follows Whose, as the Cell count does: the branch's owed records, or the
  // reader's own Sundays with somebody unmarked.
  const dccCount = branchView
    ? owedRows.length
    : queue.filter((item) => item.kind === 'dcc').length;
  const tabs: readonly { key: RecordTab; label: string; count: string | null }[] = [
    {
      key: 'awaiting',
      label: 'Update Records',
      count:
        queuePending || queueFailed || owedPending || owedFailure
          ? null
          : String(queue.filter((item) => item.kind === 'cell').length + dccCount),
    },
    {
      key: 'behind',
      label: 'Pending CG Records',
      count: pendingCg ? `${pendingCg.length}${pendingCgPages.hasNextPage ? '+' : ''}` : null,
    },
    {
      key: 'dcc',
      label: 'Pending DCC Records',
      // Leaders, not rows: a leader whose Sundays have two recorders is two rows (decision 0403).
      count: pendingDcc
        ? `${new Set(pendingDcc.map((row) => row.leader.person_id)).size}${pendingDccPages.hasNextPage ? '+' : ''}`
        : null,
    },
    ...(leaderStatus || churchStatus
      ? [{ key: 'status' as const, label: 'Recording Progress', count: null }]
      : []),
  ];

  return (
    <main id="main" className={PAGE_WIDTH.INDEX}>
      <p className="text-muted text-xs font-bold tracking-[0.08em] uppercase">
        Record · {monthLabel(month)}
      </p>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="text-2xl font-bold tracking-tight">
          {me.data?.first_name ? `Welcome, ${me.data.first_name}` : 'Dashboard'}
        </h1>
        {/* A Full view leader's tabs already say what is recorded here and who is behind,
            so their heading carries no line (decision 0402). */}
        {me.data === undefined || !(recordingOnly || seniorPastor) ? null : (
          <p className="text-muted text-sm">
            {recordingOnly
              ? 'Record your Cell Group meetings and DCC Sundays here. Each week is due by 12 noon on the second Monday after it.'
              : 'Whether the church has recorded, and your own work.'}
          </p>
        )}
      </div>

      <div className="mt-6">
        <FailureNotice failure={failure} />
      </div>

      {/* A Recording-only account has one list (decision 0323), shown as one tab in the same
          frame as everyone else's (owner, 2026-10-19), so the screen does not float on the page.
          None until the server names the account's screens, so no account sees another's tabs
          flash. */}
      {me.data === undefined ? null : recordingOnly ? (
        <TabBar
          label="Record"
          className={cn('mt-6', TAB_ROW)}
          tabs={[tabs[0]]}
          current="awaiting"
          onChoose={() => go({ list: null })}
        />
      ) : seniorPastor ? (
        <TabBar
          label="Record"
          className={cn('mt-6', TAB_ROW)}
          tabs={[
            { key: 'status', label: 'Recording Progress', count: null },
            { key: 'awaiting', label: 'Update Records', count: tabs[0].count },
          ]}
          current={spTab}
          onChoose={(next) => go({ list: next === 'status' ? null : 'awaiting' })}
        />
      ) : (
        <TabBar
          label="Outstanding work"
          className={cn('mt-6', TAB_ROW)}
          tabs={tabs}
          current={tab}
          onChoose={(next) => go({ list: next === 'awaiting' ? null : next })}
        />
      )}

      {/* The chosen list's pane. */}
      <div className={TAB_PANE}>
        {seniorPastor && spTab === 'status' ? <RecordingStatusPanel /> : null}
        {listTab === 'status' && me.data ? (
          <div className={LIST}>
            <p className="text-sm leading-relaxed">
              {churchStatus
                ? 'How many leaders in the church recorded on time, week by week or month by month.'
                : 'How many leaders in your branch recorded on time, week by week or month by month.'}
            </p>
            {churchStatus ? (
              <RecordingStatusPanel onPending={openPending} />
            ) : (
              <LeaderRecordingStatusPanel leaderId={me.data.person_id} onPending={openPending} />
            )}
          </div>
        ) : null}
        {listTab === 'awaiting' && !(seniorPastor && spTab === 'status') ? (
          // The tab names the list, so its pane repeats no heading (decision 0362), for a
          // Recording-only account too, whose one tab names it.
          <section aria-label="Update Records" className={LIST}>
            {/* What the tab is for; a Recording-only account reads it in the heading above. */}
            {recordingOnly ? null : (
              <p className="mb-4 text-sm leading-relaxed">
                Your own meetings and Sundays still to record. Each week is due by 12 noon on the
                second Monday after it.
              </p>
            )}
            <ViewSwitch
              label="Update Records"
              options={[
                {
                  key: 'CELLS',
                  label: 'Cell Group',
                  // A 0 shows no box, as on the tabs above (decision 0350).
                  count:
                    queuePending || queueFailed
                      ? null
                      : shownCount(queue.filter((item) => item.kind === 'cell').length),
                },
                {
                  key: 'DCC',
                  label: 'DCC',
                  count:
                    queuePending || queueFailed || owedPending || owedFailure
                      ? null
                      : shownCount(dccCount),
                },
              ]}
              value={filter}
              onChange={(next) => go({ kind: next === 'DCC' ? 'dcc' : null })}
            />

            {mayOversee ? (
            <div className={`mt-4 ${CONTROL_BAR}`}>
              <RadioGroup
                legend="Whose"
                name="queue-whose"
                value={shownWhose}
                onChange={(next) => {
                  setWhose(next);
                  go({ whose: next === 'branch' ? 'branch' : null });
                }}
                // Named by decision 0333; the second choice names what each half holds.
                options={[
                  { value: 'branch', label: 'Leaders Under Me' },
                  { value: 'mine', label: filter === 'DCC' ? 'Own 12' : 'Own Cell' },
                ]}
              />
            </div>
            ) : null}

            {/*
              The close of last month's open work, once, above the branch view (decision
              0311). Each row still carries its own month label.
            */}
            {branchView &&
            (filter === 'CELLS'
              ? shown.some((item) => item.month === previousMonth)
              : owedRows.some((row) => row.month === previousMonth)) ? (
              <p className="mt-4 text-sm">
                {monthOpenUntilLabel(previousMonth).endsWith('12NN')
                  ? `${monthLabel(previousMonth).split(' ')[0]} is ${monthOpenUntilLabel(previousMonth).replace(/^Open/, 'open')}.`
                  : `${monthLabel(previousMonth).split(' ')[0]} is open until the end of ${dayLabel(`${month.slice(0, 8)}07`)}.`}
              </p>
            ) : null}

            {filter === 'DCC' && branchView ? (
              owedFailure ? null : owedPending ? (
                <p className="text-muted mt-4 text-sm">Loading&hellip;</p>
              ) : (
                <DccBranchQueue
                  rows={owedRows}
                  today={today}
                  chosenId={chosenLeader?.id ?? null}
                  onChoose={setChosenLeader}
                />
              )
            ) : queueFailed ? null : queuePending ? (
              <p className="text-muted mt-4 text-sm">Loading&hellip;</p>
            ) : shown.length === 0 ? (
              <p className="text-muted mt-4 max-w-2xl text-sm leading-relaxed">
                Nothing to record. You&rsquo;re up to date.
              </p>
            ) : branchView ? (
              <LeaderGroups
                groups={groupByLeader(
                  shown.flatMap((item) => (item.kind === 'cell' ? [item] : [])),
                  (item) => ({
                    id: item.leaderId,
                    name: item.leaderName ?? 'Its leader',
                    lastName: item.leaderLastName,
                    firstName: item.leaderFirstName,
                    memberId: item.leaderMemberId,
                    isActor: item.isActor,
                  }),
                ).map((group) => ({
                  ...group,
                  content: (
                    <QueueList
                      caption={`Update Records, ${group.title}`}
                      items={group.items}
                      today={today}
                    />
                  ),
                }))}
              />
            ) : (
              <QueueList
                caption="Update Records"
                items={shown}
                today={today}
              />
            )}

            {filter === 'DCC' ? (
              branchView && chosenLeader !== null ? (
                <LeaderChecklistGrid leader={chosenLeader} onBack={() => setChosenLeader(null)} />
              ) : (
                <DccChecklistGrid events={recordableEvents} checklists={checklists} month={month} />
              )
            ) : null}

            {/*
              **Record is where DCC attendance is recorded from** (section 19, ruling of
              2026-09-14). The queue lists the Sundays with something outstanding. The month
              of every Sunday at `/dcc` is not linked from here (owner, 2026-10-23), and since
              decision 0379 it opens for no account (owner, 2026-10-27).
            */}
          </section>
        ) : null}

        {listTab === 'behind' ? (
          <PendingCgPane
            filter={cgFilter}
            onFilter={setCgFilter}
            pages={pendingCgPages}
            rows={pendingCg}
            wholeChurch={holdsWholeChurch(me.data, 'cell.view_subtree')}
          />
        ) : null}

        {listTab === 'dcc' ? (
          <PendingDccPane
            filter={pendingFilter}
            onFilter={setPendingFilter}
            pages={pendingDccPages}
            rows={pendingDcc}
            wholeChurch={holdsWholeChurch(me.data, 'dcc.view_subtree')}
            chosen={pendingChosen}
            onChoose={setPendingChosen}
          />
        ) : null}

      </div>

      {/* The reader's own requests, below their own work (decision 0269); on the recording
          screens they are on My Cell, beside asking for one (decision 0323). */}
      {recordingOnly || seniorPastor ? null : <SentRequests />}
    </main>
  );
}

/** Which of Record's lists, or Recording Progress, is open (decisions 0290 and 0336). */
const RECORD_TABS = ['awaiting', 'behind', 'dcc', 'status'] as const;

type RecordTab = (typeof RECORD_TABS)[number];
