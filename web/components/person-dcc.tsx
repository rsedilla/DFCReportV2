'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { useId } from 'react';

import { Button } from '@/components/ui/button';
import { FailureNotice } from '@/components/ui/failure-notice';
import { Tag } from '@/components/ui/tag';
import { TextLink } from '@/components/ui/text-link';
import { ApiRequestError } from '@/lib/api-client';
import { classificationLabel, getPersonDccAttendance, type PersonDccRecord } from '@/lib/dcc';
import { describeFailure } from '@/lib/messages';
import { dayLabel } from '@/lib/reporting-month';

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
 * (section 22), so older Sundays are fetched on request rather than counted. The stage
 * tag is solid, which `docs/DESIGN_RECONCILIATION.md` settles, and every stage carries
 * the same colour.
 */
export function PersonDcc({ personId }: { personId: string }) {
  const headingId = useId();

  const attendance = useInfiniteQuery({
    queryKey: ['person-dcc', personId],
    queryFn: ({ pageParam, signal }) => getPersonDccAttendance(personId, pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
  });

  return (
    <section aria-labelledby={headingId} className="border-line mt-8 border-t pt-6">
      <h2 id={headingId} className="text-lg font-semibold tracking-tight">
        DCC stage
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
        <DccHistory
          classification={attendance.data.pages[0].classification}
          attended={attendance.data.pages[0].attended}
          records={attendance.data.pages.flatMap((page) => page.data)}
          more={attendance.hasNextPage}
          loadingMore={attendance.isFetchingNextPage}
          onMore={() => attendance.fetchNextPage()}
        />
      )}
    </section>
  );
}

function DccHistory({
  classification,
  attended,
  records,
  more,
  loadingMore,
  onMore,
}: {
  classification: Parameters<typeof classificationLabel>[0] | null;
  attended: number;
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
    <>
      <p className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        {classification ? <Tag>{classificationLabel(classification)}</Tag> : null}
        <span>
          {attended === 0
            ? 'No Sundays attended yet'
            : `${attended} ${attended === 1 ? 'Sunday' : 'Sundays'} attended`}
        </span>
      </p>
      <p className="text-muted mt-2 max-w-2xl text-sm leading-relaxed">
        Worked out from the Sundays below. If it looks wrong, correct the Sunday it comes from.
      </p>

      {records.length === 0 ? (
        <p className="text-muted mt-4 text-sm">No Sundays recorded.</p>
      ) : (
        [...years].map(([year, lines]) => (
          <div key={year} className="mt-6">
            <h3 className="text-sm font-semibold">{year}</h3>
            <ul className="border-line divide-line mt-2 divide-y border-t border-b">
              {lines.map((line) => (
                <li
                  key={line.event_id}
                  // The link keeps its place on the right at every width, so a thumb finds
                  // "Open Sunday" in the same spot on each row; on a phone the removed tag
                  // goes under the date instead of pushing the link onto a line of its own.
                  className="flex items-start justify-between gap-4 py-1 sm:items-center"
                >
                  <div className="flex flex-col items-start gap-1 py-2.5 text-sm sm:flex-row sm:items-center sm:gap-x-3 sm:py-0">
                    <span>
                      <span className="font-medium">{dayLabel(line.event_date)}</span>
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
    </>
  );
}
