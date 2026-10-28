'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';

import { ArchivePersonDialog } from '@/components/archive-person-dialog';
import { ListTable, NAME_LINK, ShowMore } from '@/components/awaiting-lists';
import { Button } from '@/components/ui/button';
import { FailureNotice } from '@/components/ui/failure-notice';
import { ViewSwitch } from '@/components/ui/view-switch';
import { cellShortName, type CellCategory } from '@/lib/cells';
import { idempotencyKeyFor } from '@/lib/idempotency';
import {
  absentPeople,
  archiveReasonLabel,
  archivedPeople,
  monthName,
  restorePerson,
  shortDate,
  type AbsentPerson,
} from '@/lib/lifecycle';
import { getMe, holdsWholeChurch } from '@/lib/me';
import { describeFailure } from '@/lib/messages';

/** A Cell as the lists name it, "Young Pro · Sat" (decision 0259). */
function cellName(cell: { cell_id: string; category: string | null; day_of_week: number | null }) {
  return cellShortName({ ...cell, category: cell.category as CellCategory | null });
}

/**
 * People's *Absent 3+ Months* tab (SKILL.md section 19, decision 0397). A Full view leader reads
 * their branch; the Admin reads the church, with Archive on each row, and has an *Absent 3+
 * Months | Archived* switch. No count on the tab (owner, 2026-10-16).
 */
export function AbsentPanel() {
  const me = useQuery({ queryKey: ['me'], queryFn: ({ signal }) => getMe(signal) });
  // The Admin's alone; the API checks it again on every archive and restore.
  const mayArchive = holdsWholeChurch(me.data, 'people.manage_lifecycle');
  const [view, setView] = useState<'ABSENT' | 'ARCHIVED'>('ABSENT');

  return (
    <section className="min-w-0 pt-5" aria-labelledby="absent-heading">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 id="absent-heading" className="text-lg font-bold tracking-tight">
          {view === 'ABSENT' ? 'Absent 3+ Months' : 'Archived'}
        </h2>
      </div>
      {mayArchive ? (
        <ViewSwitch
          label="Show"
          options={[
            { key: 'ABSENT', label: 'Absent 3+ Months' },
            { key: 'ARCHIVED', label: 'Archived' },
          ]}
          value={view}
          onChange={setView}
        />
      ) : null}
      {view === 'ABSENT' ? <AbsentList mayArchive={mayArchive} /> : <ArchivedList />}
    </section>
  );
}

function AbsentList({ mayArchive }: { mayArchive: boolean }) {
  const [archiving, setArchiving] = useState<AbsentPerson | null>(null);
  const pages = useInfiniteQuery({
    queryKey: ['people-absent'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => absentPeople({ cursor: pageParam, limit: 50 }, signal),
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
  const data = pages.data?.pages.flatMap((page) => page.data);
  const months = pages.data?.pages[0]?.months ?? [];

  const columns = ['Name', 'Leader', 'Cell', 'Last at Cell', 'Last at DCC', ...(mayArchive ? [''] : [])];

  return (
    <>
      {months.length === 3 ? (
        <p className="text-muted mt-3 text-sm leading-relaxed">
          Nobody marked Present at a Cell meeting or DCC Sunday in {monthName(months[0])},{' '}
          {monthName(months[1])} and {monthName(months[2])}, and marked Absent at least once in
          each. Only months they were in a Cell or under a leader all month count, so nobody new
          is listed. Not the Participation report, which looks back over a rolling window.
        </p>
      ) : null}
      {!mayArchive ? (
        <p className="text-muted mt-2 text-sm">The administrator archives, after talking with the Senior Pastors.</p>
      ) : null}
      <div className="mt-3">
        <FailureNotice failure={pages.isError ? describeFailure(pages.error) : null} />
      </div>
      {pages.isPending ? (
        <p className="text-muted mt-3 text-sm">Loading&hellip;</p>
      ) : data ? (
        <>
          <ListTable
            caption="Absent 3+ Months"
            columns={columns}
            empty="Nobody you oversee has been away three months."
            rows={data.map((person) => ({
              key: person.id,
              cells: [
                <Link key="name" href={`/people/${person.id}`} className={NAME_LINK}>
                  {person.full_name}
                </Link>,
                person.leader?.full_name ?? '—',
                person.leads.length > 0
                  ? `Leads ${person.leads.map(cellName).join(', ')}`
                  : person.cell
                    ? cellName(person.cell)
                    : 'None',
                person.last_at_cell ? shortDate(person.last_at_cell) : 'Never',
                person.last_at_dcc ? shortDate(person.last_at_dcc) : 'Never',
                ...(mayArchive
                  ? [
                      person.leads.length > 0 ? (
                        // Section 3 refuses it; the row says what to resolve first (choice 5).
                        <span key="action" className="text-sm">
                          Leads{' '}
                          {person.leads.map((cell, index) => (
                            <span key={cell.id}>
                              {index > 0 ? ', ' : null}
                              <Link href={`/cells/${cell.id}/members`} className={NAME_LINK}>
                                {cell.cell_id}
                              </Link>{' '}
                              ({cell.members} {cell.members === 1 ? 'member' : 'members'})
                            </span>
                          ))}
                          : hand {person.leads.length === 1 ? 'it' : 'them'} over or close{' '}
                          {person.leads.length === 1 ? 'it' : 'them'} first
                        </span>
                      ) : person.pastors > 0 ? (
                        // Refused while they pastor anyone (owner, 2026-10-28, decision 0397).
                        <span key="action" className="text-sm">
                          Pastors {person.pastors} {person.pastors === 1 ? 'person' : 'people'}: move them to another
                          leader first
                        </span>
                      ) : (
                        <Button key="action" variant="secondary" onClick={() => setArchiving(person)}>
                          Archive
                        </Button>
                      ),
                    ]
                  : []),
              ],
            }))}
          />
          <ShowMore pages={pages} />
        </>
      ) : null}
      {archiving ? (
        <ArchivePersonDialog open onClose={() => setArchiving(null)} person={archiving} />
      ) : null}
    </>
  );
}

function ArchivedList() {
  const queryClient = useQueryClient();
  const pages = useInfiniteQuery({
    queryKey: ['people-archived'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => archivedPeople({ cursor: pageParam, limit: 50 }, signal),
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
  const data = pages.data?.pages.flatMap((page) => page.data);
  const restore = useMutation({
    mutationFn: (person: { id: string; archived_at: string }) =>
      restorePerson(person.id, idempotencyKeyFor('restore-person', person.id, person.archived_at)),
    onSuccess: async (_, person) => {
      await queryClient.invalidateQueries({ queryKey: ['people-archived'] });
      await queryClient.invalidateQueries({ queryKey: ['people-absent'] });
      await queryClient.invalidateQueries({ queryKey: ['person', person.id] });
    },
  });

  return (
    <>
      <p className="text-muted mt-3 text-sm leading-relaxed">
        Everyone archived, newest first. Restoring brings them back into every count from that
        day; their Cell, leader and account are each given back separately.
      </p>
      <div className="mt-3">
        <FailureNotice
          failure={
            pages.isError
              ? describeFailure(pages.error)
              : restore.isError
                ? describeFailure(restore.error)
                : null
          }
        />
      </div>
      {pages.isPending ? (
        <p className="text-muted mt-3 text-sm">Loading&hellip;</p>
      ) : data ? (
        <>
          <ListTable
            caption="Archived"
            columns={['Name', 'Leader', 'Was in Cell', 'Archived on', 'Why', '']}
            empty="Nobody is archived."
            rows={data.map((person) => ({
              key: person.id,
              cells: [
                <Link key="name" href={`/people/${person.id}`} className={NAME_LINK}>
                  {person.full_name}
                </Link>,
                person.leader?.full_name ?? '—',
                person.cell ? cellName(person.cell) : 'None',
                shortDate(person.archived_at),
                person.note
                  ? `${archiveReasonLabel(person.reason)}: ${person.note}`
                  : archiveReasonLabel(person.reason),
                <Button
                  key="action"
                  variant="secondary"
                  disabled={restore.isPending}
                  onClick={() => restore.mutate(person)}
                >
                  Restore
                </Button>,
              ],
            }))}
          />
          <ShowMore pages={pages} />
        </>
      ) : null}
    </>
  );
}
