'use client';

import { useQuery } from '@tanstack/react-query';

import { CursorPager } from '@/components/ui/cursor-pager';
import { FailureNotice } from '@/components/ui/failure-notice';
import { HeaderCell, Table, rowClasses } from '@/components/ui/table';
import { cellShortName } from '@/lib/cells';
import { useCursorPages } from '@/lib/cursor-pages';
import { keepPreviousPage, pageTurnProps } from '@/lib/keep-previous-page';
import { getMe } from '@/lib/me';
import { describeFailure } from '@/lib/messages';
import { getMyPeople, getMyPeopleCounts, type MyPeopleRow } from '@/lib/my-people';
import { LoadingBlocks } from '@/components/ui/loading-blocks';

/**
 * A leader's people as one plain list (SKILL.md section 19, decisions 0422 and 0437): every level
 * of their branch without Full view, two levels with it, as the server says. How many, and each
 * person's name, leader and Cell Group with who leads it. Nothing in it is a link: it is for
 * knowing who they are, and a person's page is a search away under Add People.
 *
 * Kept in memory for ten minutes rather than thirty seconds (decision 0437), since it changes
 * only when somebody is added or moved and any save refreshes it; never kept on the device.
 */
const TEN_MINUTES = 10 * 60_000;

export function MyPeopleList() {
  const pages = useCursorPages('mine');
  const me = useQuery({ queryKey: ['me'], queryFn: ({ signal }) => getMe(signal) });
  const counts = useQuery({
    queryKey: ['my-people', 'counts'],
    queryFn: ({ signal }) => getMyPeopleCounts(signal),
    staleTime: TEN_MINUTES,
  });
  const key = ['my-people', pages.cursor];
  const people = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => getMyPeople(pages.cursor, signal),
    placeholderData: keepPreviousPage(key, 1),
    staleTime: TEN_MINUTES,
  });

  const leaderOf = (row: MyPeopleRow) => row.leader?.full_name ?? 'You';
  const cellOf = (row: MyPeopleRow) =>
    row.cell_withheld ? '' : row.cell === null ? 'No Cell yet' : cellShortName(row.cell);
  // "Young Pro · Sat, led by Adrian", by first name, the Leader line above carrying the full
  // name; "led by you" where it names the reader (decision 0437).
  const ledBy = (row: MyPeopleRow) => {
    const leader = row.cell?.led_by ?? null;
    if (leader === null) {
      return '';
    }
    return leader.person_id === me.data?.person_id
      ? ', led by you'
      : `, led by ${leader.first_name}`;
  };
  const cellLedBy = (row: MyPeopleRow) =>
    row.cell === null || row.cell_withheld
      ? cellOf(row)
      : `${cellShortName(row.cell)}${ledBy(row)}`;

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
          {/* In the words the owner chose (decision 0436). */}
          <h2 className="text-2xl font-semibold">
            <span className="text-accent tabular-nums">{counts.data.all}</span>{' '}
            {counts.data.all === 1 ? 'person' : 'people'} in your care
          </h2>
          {/* How deep the list goes, so two screens never read alike (decision 0437). */}
          <p className="text-muted text-sm">
            {counts.data.every_level
              ? 'Your 12, their 12 and everyone after them'
              : 'Your 12 and their 12 · Tree shows every level'}
          </p>
          <p className="text-muted text-sm">Pray for more workers in His harvest.</p>
        </>
      ) : null}

      <div {...pageTurnProps(people.isPlaceholderData)}>
        {people.isPending ? (
          <LoadingBlocks shape="rows" className="mt-4" />
        ) : people.data && people.data.data.length === 0 ? (
          <p className="text-muted mt-4 text-sm">
            No one in your care yet. Pray for the people God will bring.
          </p>
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
                    <td className="px-3 py-3">{cellLedBy(row)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <ul className="border-line mt-4 border-t lg:hidden">
              {people.data.data.map((row) => (
                <li key={row.person_id} className="border-line border-b py-2.5">
                  <p className="font-semibold">{row.full_name}</p>
                  <p className="text-muted text-sm">Leader: {leaderOf(row)}</p>
                  {cellOf(row) ? (
                    <p className="text-muted text-sm">
                      Cell Group: {row.cell === null ? 'none yet' : cellLedBy(row)}
                    </p>
                  ) : null}
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
