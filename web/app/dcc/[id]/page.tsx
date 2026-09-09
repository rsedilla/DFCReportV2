'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo, useState } from 'react';

import { AppShell, PAGE_WIDTH } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { FailureNotice } from '@/components/ui/failure-notice';
import { RadioGroup } from '@/components/ui/radio-group';
import {
  getDccRoster,
  notRecordableLabel,
  submitDccAttendance,
  type DccRecordInput,
  type DccRosterLine,
} from '@/lib/dcc';
import { idempotencyKeyFor } from '@/lib/idempotency';
import { describeFailure } from '@/lib/messages';
import { dayLabel } from '@/lib/reporting-month';

/**
 * A leader's DCC checklist for one Sunday (SKILL.md sections 9, 13, 14 and 22;
 * decisions 0127 and 0194).
 *
 * **The whole checklist is shown with what is already marked**, which decision 0194
 * settles as deliberate rather than as a disclosure to be closed: a leader marking a
 * checklist must see who is already recorded, or they re-ask people already counted.
 * Section 9 says as much — a submission is one leader's whole checklist, "so most of
 * its lines repeat what is already recorded".
 *
 * **A version per person, not one for the event** (section 14). A DCC event is
 * church-wide, so two leaders recording different people must never conflict; the
 * unit is `(event, person)` and each line carries the version that line was read at.
 * That is the opposite of a Cell meeting, whose submission carries one version for
 * the meeting, and the two are deliberately not built from one shape.
 *
 * **Only marked lines are sent.** A line the leader has not touched and that has no
 * record is not a declaration, and sending it as absent would manufacture one.
 *
 * **An event that takes no record is read-only here**, and the reason is stated: a
 * removed Sunday, a Sunday that has not happened, and a closed month are three
 * different things, and only the last of them is about a deadline.
 */
export default function DccRosterPage() {
  return (
    <AppShell>
      <DccChecklist />
    </AppShell>
  );
}

type Mark = 'present' | 'absent';

function DccChecklist() {
  const params = useParams<{ id: string }>();
  const queryClient = useQueryClient();

  const roster = useQuery({
    queryKey: ['dcc-roster', params.id],
    queryFn: ({ signal }) => getDccRoster(params.id, signal),
  });

  const [edits, setEdits] = useState<Record<string, Mark>>({});

  const lines = useMemo(() => roster.data?.data ?? [], [roster.data]);
  const event = roster.data?.event ?? null;
  const recordable = event?.recordable ?? false;

  /**
   * What is recorded, overlaid with what this leader has changed since.
   *
   * Derived rather than seeded into state by an effect, for the reason the Cell
   * screen gives: re-seeding on a refetch would discard marks the leader has made
   * and not yet saved.
   */
  const markFor = (line: DccRosterLine): Mark | undefined =>
    edits[line.person_id] ??
    (line.record === null ? undefined : line.record.present ? 'present' : 'absent');

  const records = useMemo((): DccRecordInput[] => {
    return lines
      .filter((line) => edits[line.person_id] !== undefined || line.record !== null)
      .map((line) => ({
        person_id: line.person_id,
        present:
          (edits[line.person_id] ??
            (line.record !== null && line.record.present ? 'present' : 'absent')) === 'present',
        // Null is this person's first record; a number is the version this
        // client read, which section 14 compares per line.
        version: line.record?.version ?? null,
      }));
  }, [lines, edits]);

  const idempotencyKey = useMemo(() => idempotencyKeyFor(params.id, records), [params.id, records]);

  const save = useMutation({
    mutationFn: () => submitDccAttendance(params.id, records, idempotencyKey),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['dcc-roster', params.id] });
      await queryClient.invalidateQueries({ queryKey: ['dcc-events'] });
    },
  });

  return (
    <main id="main" className={PAGE_WIDTH.READING}>
      <p className="mb-4">
        <Link
          href="/dcc"
          className="focus-visible:outline-accent text-muted inline-flex min-h-6 items-center rounded-sm text-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          Back to the calendar
        </Link>
      </p>

      <h1 className="text-2xl font-semibold tracking-tight">
        {event ? dayLabel(event.event_date) : 'DCC attendance'}
      </h1>
      <p className="text-muted mt-2 max-w-2xl text-sm leading-relaxed">
        Everyone you are responsible for, and what is recorded for them. Lines somebody else
        has already recorded are shown as they stand, so you are not asked twice.
      </p>

      <div className="mt-8">
        <FailureNotice
          failure={
            roster.isError
              ? describeFailure(roster.error)
              : save.isError
                ? describeFailure(save.error)
                : null
          }
        />
      </div>

      {roster.isPending ? (
        <p className="text-muted mt-6 text-sm">Loading&hellip;</p>
      ) : roster.data && event ? (
        <>
          {!recordable && event.not_recordable_reason ? (
            <p className="border-line mt-6 max-w-2xl rounded-lg border p-4 text-sm leading-relaxed">
              This Sunday takes no record: {notRecordableLabel(event.not_recordable_reason)}.
              {event.removed && event.removal_reason ? ` ${event.removal_reason}` : ''}
            </p>
          ) : null}

          {save.isSuccess ? (
            <p aria-live="polite" className="mt-6 text-sm font-medium">
              Saved.
            </p>
          ) : null}

          {lines.length === 0 ? (
            <p className="text-muted mt-6 max-w-2xl text-sm leading-relaxed">
              Nobody is on your checklist for this Sunday. Attendance is recorded by each
              person&rsquo;s direct pastoral leader, so this is empty if you disciple nobody.
            </p>
          ) : (
            <ul className="mt-6 flex flex-col gap-4">
              {lines.map((line) => (
                <PersonMark
                  key={line.person_id}
                  line={line}
                  mark={markFor(line)}
                  disabled={!recordable}
                  onChange={(value) =>
                    setEdits((current) => ({ ...current, [line.person_id]: value }))
                  }
                />
              ))}
            </ul>
          )}

          {/*
            The roster pages (section 22). A leader's own checklist is short, so
            this is stated rather than paged over: a "show more" that fetched a
            second page would have to decide what a partial submission means, and
            nothing here needs to.
          */}
          {roster.data.next_cursor !== null ? (
            <p className="text-muted mt-4 max-w-2xl text-sm leading-relaxed">
              More people are on this checklist than fit one page. Recording them is not yet
              possible from this screen.
            </p>
          ) : null}

          {recordable && lines.length > 0 ? (
            <div className="mt-8">
              <Button
                type="button"
                onClick={() => save.mutate()}
                disabled={records.length === 0 || save.isPending}
              >
                {save.isPending ? 'Saving…' : 'Save'}
              </Button>
              {records.length === 0 ? (
                <p className="text-muted mt-2 text-sm">Mark at least one person to save.</p>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </main>
  );
}

function PersonMark({
  line,
  mark,
  disabled,
  onChange,
}: {
  line: DccRosterLine;
  mark: Mark | undefined;
  disabled: boolean;
  onChange: (mark: Mark) => void;
}) {
  return (
    <li className="border-line rounded-lg border p-4">
      <RadioGroup
        legend={line.full_name}
        description={
          mark === undefined
            ? 'Not recorded yet'
            : line.record === null
              ? undefined
              : 'Already recorded — change it only if it is wrong'
        }
        name={`person-${line.person_id}`}
        value={disabled ? '' : (mark ?? '')}
        onChange={onChange}
        options={[
          { value: 'present', label: 'Present' },
          { value: 'absent', label: 'Absent' },
        ]}
      />
    </li>
  );
}

