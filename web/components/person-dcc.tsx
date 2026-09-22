'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useId } from 'react';

import { Button } from '@/components/ui/button';
import { FailureNotice } from '@/components/ui/failure-notice';
import { FRAME } from '@/components/ui/frame';
import { Tag } from '@/components/ui/tag';
import { TextLink } from '@/components/ui/text-link';
import { ApiRequestError } from '@/lib/api-client';
import {
  classificationLabel,
  getPersonDccAttendance,
  listDccEvents,
  type DccEvent,
  type PersonDccRecord,
} from '@/lib/dcc';
import { describeFailure } from '@/lib/messages';
import { dayLabel, monthLabel, reportingMonthOf, shiftMonth } from '@/lib/reporting-month';

/**
 * A person's DCC stage and the Sundays it is made from (SKILL.md section 9; decision 0247).
 *
 * **The stage sits beside the Sundays behind it and has no override.** Section 9 derives
 * classification from attendance and says not to let leaders maintain it by hand, so a
 * stage that looks wrong is changed by correcting the Sunday it comes from, which is
 * what each row opens.
 *
 * **A Sunday later removed is listed and marked, not hidden.** It is not counted, and
 * saying so beside it explains a stage that would otherwise look one short.
 *
 * **Grouped by year, newest first, and paged by cursor.** The route returns no total
 * (section 22), so older Sundays are fetched on request rather than counted.
 *
 * **Two cards lead it, the owner's design adjusted** (decision 0260): the stage with the
 * Sundays it counts, and this month's Sundays attended out of section 9's N, with last
 * month's beside it, each naming its month and saying so while it is open. The month's Sundays are read under `dcc.view_subtree`
 * against the reader rather than the person, so a grant that reaches the person and not the
 * reader leaves the figure out and says so. There is no Cell card: nothing reads one person's Cell
 * attendance, a Cell record being read one meeting at a time (decision 0246).
 */
export function PersonDcc({ personId }: { personId: string }) {
  const headingId = useId();

  const attendance = useInfiniteQuery({
    queryKey: ['person-dcc', personId],
    queryFn: ({ pageParam, signal }) => getPersonDccAttendance(personId, pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
  });

  const thisMonth = reportingMonthOf();
  const lastMonth = shiftMonth(thisMonth, -1);
  const current = useQuery({
    queryKey: ['dcc-events', thisMonth],
    queryFn: ({ signal }) => listDccEvents(thisMonth, signal),
  });
  const previous = useQuery({
    queryKey: ['dcc-events', lastMonth],
    queryFn: ({ signal }) => listDccEvents(lastMonth, signal),
  });

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      <h2 id={headingId} className="sr-only">
        DCC
      </h2>

      {attendance.isPending ? (
        <p className="text-muted mt-3 text-sm">Loading&hellip;</p>
      ) : attendance.isError &&
        attendance.error instanceof ApiRequestError &&
        (attendance.error.code === 'CAPABILITY_DENIED' ||
          attendance.error.code === 'SCOPE_DENIED') ? (
        // A refusal of this reader rather than a failure: a plain sentence, not the API's
        // own wording, which names a capability a leader has no reason to know.
        <p className="text-muted mt-3 text-sm">
          Your account can&rsquo;t see this person&rsquo;s DCC attendance.
        </p>
      ) : attendance.isError ? (
        <div className="mt-3">
          <FailureNotice failure={describeFailure(attendance.error)} />
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Card kicker="Journey">
              <p className="text-xl font-bold">
                {attendance.data.pages[0].classification
                  ? classificationLabel(attendance.data.pages[0].classification)
                  : 'No stage yet'}
              </p>
              <p className="text-muted mt-1 text-sm">
                {sundaysAttended(attendance.data.pages[0].attended)}
              </p>
            </Card>
            <Card kicker={`Sundays in ${monthName(thisMonth)}`}>
              <MonthFigure
                records={attendance.data.pages.flatMap((page) => page.data)}
                events={monthEvents(current)}
                month={thisMonth}
                big
              />
              {current.data?.open ? (
                <p className="text-muted mt-1 text-sm">{openUntil(thisMonth)}</p>
              ) : null}
              <p className="text-muted mt-1 text-sm">
                {monthName(lastMonth)}:{' '}
                <MonthFigure
                  records={attendance.data.pages.flatMap((page) => page.data)}
                  events={monthEvents(previous)}
                  month={lastMonth}
                />
                {previous.data?.open ? ` · ${openUntil(lastMonth).toLowerCase()}` : ''}
              </p>
            </Card>
          </div>
          <DccHistory
            records={attendance.data.pages.flatMap((page) => page.data)}
            more={attendance.hasNextPage}
            loadingMore={attendance.isFetchingNextPage}
            onMore={() => attendance.fetchNextPage()}
          />
        </>
      )}
    </section>
  );
}

function Card({ kicker, children }: { kicker: string; children: React.ReactNode }) {
  return (
    <div className={FRAME}>
      <p className="field-label">{kicker}</p>
      <div className="mt-1">{children}</div>
    </div>
  );
}

/** The month's Sundays, or why they are not shown: a refusal is not a failure. */
function monthEvents(query: {
  data?: { data: DccEvent[] };
  isError: boolean;
  error: unknown;
}): DccEvent[] | 'denied' | 'failed' | undefined {
  if (!query.isError) {
    return query.data?.data;
  }

  return query.error instanceof ApiRequestError &&
    (query.error.code === 'CAPABILITY_DENIED' || query.error.code === 'SCOPE_DENIED')
    ? 'denied'
    : 'failed';
}

/** "September". */
function monthName(month: string): string {
  return monthLabel(month).split(' ')[0];
}

/** "Open until 7 October": the 7th of the month after (section 13, decision 0170). */
function openUntil(month: string): string {
  return `Open until 7 ${monthName(shiftMonth(month, 1))}`;
}

function sundaysAttended(attended: number): string {
  return attended === 0
    ? 'No Sundays attended yet'
    : `${attended} ${attended === 1 ? 'Sunday' : 'Sundays'} attended`;
}

/**
 * "1 of 4": Sundays attended out of section 9's N, the month's Sundays that were not
 * removed, those still to come included, so it agrees with the monthly report (decision
 * 0260). Nothing until both are read.
 * The first page of records covers both months: fifty, newest first, one per Sunday.
 */
function MonthFigure({
  records,
  events,
  month,
  big = false,
}: {
  records: PersonDccRecord[];
  /** `undefined` while loading; a refusal or a failure is said in words. */
  events: DccEvent[] | 'denied' | 'failed' | undefined;
  month: string;
  big?: boolean;
}) {
  if (events === undefined) {
    return <span className={big ? 'text-xl font-bold' : undefined}>&hellip;</span>;
  }
  if (events === 'denied') {
    return <span className="text-muted text-sm">Not available to your account</span>;
  }
  if (events === 'failed') {
    return <span className="text-muted text-sm">Couldn&rsquo;t load this month&rsquo;s Sundays</span>;
  }

  const prefix = month.slice(0, 8);
  const held = events.filter((event) => !event.removed).length;
  const attended = records.filter(
    (record) => record.event_date.startsWith(prefix) && record.present && !record.removed,
  ).length;

  return big ? (
    <p className="text-xl font-bold">
      {attended} of {held}
    </p>
  ) : (
    <span>
      {attended} of {held}
    </span>
  );
}

function DccHistory({
  records,
  more,
  loadingMore,
  onMore,
}: {
  records: PersonDccRecord[];
  more: boolean;
  loadingMore: boolean;
  onMore: () => void;
}) {
  const years = new Map<string, PersonDccRecord[]>();
  for (const record of records) {
    const year = record.event_date.slice(0, 4);
    years.set(year, [...(years.get(year) ?? []), record]);
  }

  return (
    <div className={FRAME}>
      <h3 className="field-label">Recent Sundays</h3>
      <p className="text-muted mt-1 max-w-2xl text-sm leading-relaxed">
        The stage is worked out from these. If it looks wrong, correct the Sunday it comes from.
      </p>

      {records.length === 0 ? (
        <p className="text-muted mt-4 text-sm">No Sundays recorded.</p>
      ) : (
        [...years].map(([year, lines]) => (
          <div key={year} className="mt-4">
            <h4 className="text-sm font-semibold">{year}</h4>
            <ul className="border-line divide-line mt-2 divide-y border-t border-b">
              {lines.map((line) => (
                <li
                  key={line.event_id}
                  // The link keeps its place on the right at every width, so a thumb finds
                  // "Open Sunday" in the same spot on each row; on a phone the removed tag
                  // goes under the date instead of pushing the link onto a line of its own.
                  className="flex items-start justify-between gap-4 py-1"
                >
                  {/* The removed tag under the date at every width: the column is narrow from `lg`. */}
                  <div className="flex flex-col items-start gap-1 py-2.5 text-sm">
                    <span>
                      <span className="text-accent font-medium">{dayLabel(line.event_date)}</span>
                      <span className={line.removed ? 'text-muted ml-3' : 'ml-3'}>
                        {line.present ? 'Present' : 'Absent'}
                      </span>
                    </span>
                    {line.removed ? (
                      // Allowed to wrap: at 320px the words on one line would push the
                      // link past the edge of the screen.
                      <Tag appearance="outline" className="leading-tight whitespace-normal">
                        Service removed · not counted
                      </Tag>
                    ) : null}
                  </div>
                  <TextLink href={`/dcc/${line.event_id}`} className="shrink-0 text-sm">
                    Open Sunday<span className="sr-only">, {line.event_date}</span>
                  </TextLink>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}

      {more ? (
        <Button variant="secondary" className="mt-4" onClick={onMore} disabled={loadingMore}>
          {loadingMore ? 'Loading…' : 'Show older Sundays'}
        </Button>
      ) : null}
    </div>
  );
}
