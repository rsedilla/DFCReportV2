'use client';

import { useQuery } from '@tanstack/react-query';

import { CursorPager } from '@/components/ui/cursor-pager';
import { FailureNotice } from '@/components/ui/failure-notice';
import { HeaderCell, Table, rowClasses } from '@/components/ui/table';
import { cellShortName } from '@/lib/cells';
import { useCursorPages } from '@/lib/cursor-pages';
import { keepPreviousPage, pageTurnProps } from '@/lib/keep-previous-page';
import { describeFailure } from '@/lib/messages';
import { getMyPeople, getMyPeopleCounts, type MyPeopleRow } from '@/lib/my-people';

/**
 * A leader's people two levels down, as one plain list (SKILL.md section 19, decision 0422):
 * how many, and each person's name, leader and Cell Group. Nothing in it is a link: it is for
 * knowing who they are, and a person's page is a search away under Add People.
 */
export function MyPeopleList() {
  const pages = useCursorPages('mine');
  const counts = useQuery({
    queryKey: ['my-people', 'counts'],
    queryFn: ({ signal }) => getMyPeopleCounts(signal),
  });
  const key = ['my-people', pages.cursor];
  const people = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => getMyPeople(pages.cursor, signal),
    placeholderData: keepPreviousPage(key, 1),
  });

  const leaderOf = (row: MyPeopleRow) => row.leader?.full_name ?? 'You';
  const cellOf = (row: MyPeopleRow) =>
    row.cell_withheld ? '' : row.cell === null ? 'No Cell yet' : cellShortName(row.cell);

  return (
    <section aria-label="My People" className="mt-5">
      <FailureNotice
        failure={
          people.isError
            ? describeFailure(people.error)
            : counts.isError
              ? describeFailure(counts.error)
              : null
        }
      />
      {counts.data ? (
        <>
          <h2 className="text-2xl font-semibold">
            <span className="text-accent tabular-nums">{counts.data.all}</span>{' '}
            {counts.data.all === 1 ? 'person' : 'people'} under you
          </h2>
          <p className="text-muted text-sm">
            {counts.data.direct} directly under you · {counts.data.beneath} beneath them · as of
            today
          </p>
        </>
      ) : null}

      <div {...pageTurnProps(people.isPlaceholderData)}>
        {people.isPending ? (
          <p className="text-muted mt-4 text-sm">Loading&hellip;</p>
        ) : people.data && people.data.data.length === 0 ? (
          <p className="text-muted mt-4 text-sm">Nobody is under you yet.</p>
        ) : people.data ? (
          <>
            <Table caption="My People" className="mt-4 hidden lg:block">
              <thead>
                <tr>
                  <HeaderCell>Name</HeaderCell>
                  <HeaderCell>Leader</HeaderCell>
                  <HeaderCell>Cell Group</HeaderCell>
                </tr>
              </thead>
              <tbody>
                {people.data.data.map((row) => (
                  <tr key={row.person_id} className={rowClasses}>
                    <td className="px-3 py-3">{row.full_name}</td>
                    <td className="px-3 py-3">{leaderOf(row)}</td>
                    <td className="px-3 py-3">{cellOf(row)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <ul className="border-line mt-4 border-t lg:hidden">
              {people.data.data.map((row) => (
                <li key={row.person_id} className="border-line border-b py-2.5">
                  <p className="font-semibold">{row.full_name}</p>
                  <p className="text-muted text-sm">
                    Leader: {leaderOf(row)}
                    {cellOf(row) ? ` · ${cellOf(row)}` : ''}
                  </p>
                </li>
              ))}
            </ul>
            {people.data.next_cursor || pages.page > 0 ? (
              <CursorPager
                label="My People"
                page={pages.page}
                nextCursor={people.data.next_cursor}
                onPrevious={pages.previous}
                onNext={() => pages.next(people.data?.next_cursor)}
              />
            ) : null}
          </>
        ) : null}
      </div>
    </section>
  );
}
