'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo, useState } from 'react';

import { AppShell, PAGE_WIDTH } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { FailureNotice } from '@/components/ui/failure-notice';
import { FRAME } from '@/components/ui/frame';
import { RadioGroup } from '@/components/ui/radio-group';
import {
  getDccRoster,
  notRecordableLabel,
  submitDccAttendance,
  type DccRecordInput,
  type DccRosterLine,
} from '@/lib/dcc';
import { idempotencyKeyFor } from '@/lib/idempotency';
import { getMe } from '@/lib/me';
import { describeFailure, describeLineFailure } from '@/lib/messages';
import { dayLabel, todayInManila } from '@/lib/reporting-month';

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
 * **One Sunday at a time, and never a person's month** (owner's choice of
 * 2026-09-15). A grid of each person's Sundays across a month would name somebody's
 * attendance over a period, which no screen does and `CLAUDE.md` records as open.
 *
 * **A version per person, not one for the event** (section 14). A DCC event is
 * church-wide, so two leaders recording different people must never conflict; the
 * unit is `(event, person)` and each line carries the version that line was read at.
 * That is the opposite of a Cell meeting, whose submission carries one version for
 * the meeting, and the two are deliberately not built from one shape.
 *
 * **Only marked lines are sent.** A line the leader has not touched and that has no
 * record is not a declaration, and sending it as absent would manufacture one. There
 * is no "mark all present" for the same reason the Cell screen gives.
 *
 * **An event that takes no record is read-only here**, and the reason is stated: a
 * removed Sunday, a Sunday that has not happened, and a closed month are three
 * different things, and only the last of them is about a deadline.
 *
 * **A recorded mark is locked until the leader chooses to change it** (owner's choice of
 * 2026-09-15, step 2 of the clean-up), the way the Cell meeting screen locks a recorded
 * meeting. Changing a recorded line is a correction, which the API refuses without
 * `dcc.correct_subtree`; so a stray tap on a phone cannot quietly become one, and an
 * account without that capability is told before it presses Save rather than after.
 * The optional reason travels only on recorded lines whose mark actually changed, because
 * the API refuses a correction reason on a person's first record.
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

  const me = useQuery({ queryKey: ['me'], queryFn: ({ signal }) => getMe(signal) });

  const [edits, setEdits] = useState<Record<string, Mark>>({});
  const [editing, setEditing] = useState(false);
  const [correctionReason, setCorrectionReason] = useState('');

  const lines = useMemo(() => roster.data?.data ?? [], [roster.data]);
  const event = roster.data?.event ?? null;
  const recordable = event?.recordable ?? false;
  const recordedCount = lines.filter((line) => line.record !== null).length;

  // Held at any scope. Whether it covers each person is the API's to decide.
  const canCorrect = (me.data?.capabilities ?? []).some(
    (grant) => grant.capability === 'dcc.correct_subtree',
  );

  /** Back to the recorded marks: what was changed on recorded lines is dropped. */
  function stopEditing() {
    setEdits((current) =>
      Object.fromEntries(
        Object.entries(current).filter(
          ([personId]) => lines.find((line) => line.person_id === personId)?.record === null,
        ),
      ),
    );
    setCorrectionReason('');
    setEditing(false);
  }

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
    const reason = correctionReason.trim();

    return lines
      .filter((line) => edits[line.person_id] !== undefined || line.record !== null)
      .map((line) => {
        const present =
          (edits[line.person_id] ??
            (line.record !== null && line.record.present ? 'present' : 'absent')) === 'present';
        const corrected = line.record !== null && line.record.present !== present;

        return {
          person_id: line.person_id,
          present,
          // Null is this person's first record; a number is the version this
          // client read, which section 14 compares per line.
          version: line.record?.version ?? null,
          ...(corrected && reason ? { correction_reason: reason } : {}),
        };
      });
  }, [lines, edits, correctionReason]);

  const idempotencyKey = useMemo(() => idempotencyKeyFor(params.id, records), [params.id, records]);

  const save = useMutation({
    mutationFn: () => submitDccAttendance(params.id, records, idempotencyKey),
    onSuccess: async () => {
      setEditing(false);
      setCorrectionReason('');
      await queryClient.invalidateQueries({ queryKey: ['dcc-roster', params.id] });
      await queryClient.invalidateQueries({ queryKey: ['dcc-events'] });
    },
  });

  const unmarkedCount = lines.filter((line) => markFor(line) === undefined).length;
  // What is saved, not what is tapped, so this screen and Your month say the same thing.
  const awaitingCount = lines.filter((line) => line.record === null).length;
  const newlyMarked = lines.some(
    (line) => line.record === null && edits[line.person_id] !== undefined,
  );
  const markedCount = lines.length - unmarkedCount;
  // A new mark, or a recorded one changed: what makes a Save worth offering.
  const changed = lines.some((line) => {
    const edit = edits[line.person_id];

    return edit !== undefined && (line.record === null || (edit === 'present') !== line.record.present);
  });

  return (
    <main id="main" className={PAGE_WIDTH.READING}>
      <p className="mb-4">
        <Link
          href="/dcc"
          className="focus-visible:outline-accent text-accent inline-flex min-h-6 items-center text-sm font-medium underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          Back to your month
        </Link>
      </p>

      {/* Red for the reason the Cell meeting screen gives. */}
      <h1 className="text-accent text-2xl font-bold tracking-tight">
        {event ? dayLabel(event.event_date) : 'DCC attendance'}
      </h1>
      <p className="text-muted mt-2 max-w-2xl text-sm leading-relaxed">
        {lines.length === 1
          ? 'The 1 person you are responsible for.'
          : `The ${lines.length} people you are responsible for.`}
        {recordable && awaitingCount > 0 ? ` Awaiting a record · ${awaitingCount} to mark.` : ''}
      </p>

      <div className="mt-8">
        <FailureNotice
          failure={
            roster.isError
              ? describeFailure(roster.error)
              : save.isError
                ? describeLineFailure(save.error, 'records', (index) => {
                    const personId = records[index]?.person_id;
                    return lines.find((line) => line.person_id === personId)?.full_name ?? null;
                  })
                : null
          }
        />
      </div>

      {roster.isPending ? (
        <p className="text-muted mt-6 text-sm">Loading&hellip;</p>
      ) : roster.data && event ? (
        <>
          {!recordable && event.not_recordable_reason ? (
            <p className="border-edge mt-6 max-w-2xl border p-4 text-sm leading-relaxed">
              This Sunday takes no record: {notRecordableLabel(event.not_recordable_reason)}.
              {event.removed && event.removal_reason ? ` ${event.removal_reason}` : ''}
            </p>
          ) : null}

          {save.isSuccess ? (
            <p aria-live="polite" className="mt-6 text-sm font-medium">
              Saved.{' '}
              <Link
                href="/dashboard"
                className="focus-visible:outline-accent text-accent inline-flex min-h-6 items-center font-normal underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                Back to what&rsquo;s awaiting a record
              </Link>
            </p>
          ) : null}

          {/* The checklist and what is already recorded, in one frame (owner's choice, 2026-09-22). */}
          <div className={`mt-6 ${FRAME}`}>
          {recordable && recordedCount > 0 ? (
            <div className="border-line border-b pb-4">
              {editing ? (
                <>
                  <p className="text-sm font-bold">Changing recorded marks</p>
                  <p className="text-muted mt-1 text-sm leading-relaxed">
                    Saving replaces the marks you change.
                  </p>
                  <Button variant="quiet" className="mt-3" onClick={stopEditing}>
                    Stop editing
                  </Button>
                </>
              ) : (
                <>
                  <p className="text-sm font-bold">
                    {recordedCount} of {lines.length} recorded
                  </p>
                  <p className="text-muted mt-1 text-sm leading-relaxed">
                    Recorded marks are locked so a stray tap cannot change them.
                  </p>
                  {me.data ? (
                    canCorrect ? (
                      <Button variant="secondary" className="mt-3" onClick={() => setEditing(true)}>
                        Change recorded marks
                      </Button>
                    ) : (
                      <p className="text-muted mt-1 text-sm leading-relaxed">
                        Changing a recorded mark needs permission to correct records, which this
                        account does not hold.
                      </p>
                    )
                  ) : null}
                </>
              )}
            </div>
          ) : null}

          {lines.length === 0 ? (
            <p className="text-muted mt-4 max-w-2xl text-sm leading-relaxed">
              Nobody is on your checklist for this Sunday. Attendance is recorded by each
              person&rsquo;s direct pastoral leader, so this is empty if you disciple nobody.
            </p>
          ) : (
            <>
              <p className="mt-4 text-right text-sm">
                {markedCount} of {lines.length} marked
              </p>
              <ul className="border-line mt-2 border-t [&>li:last-child]:border-b-0">
                {lines.map((line) => (
                  <PersonMark
                    key={line.person_id}
                    line={line}
                    mark={markFor(line)}
                    disabled={!recordable || (line.record !== null && !editing)}
                    onChange={(value) =>
                      setEdits((current) => ({ ...current, [line.person_id]: value }))
                    }
                  />
                ))}
              </ul>

              {editing ? (
                <div className="mt-6">
                  <label htmlFor="correction-reason" className="field-label block">
                    Why is this changing? (optional)
                  </label>
                  <textarea
                    id="correction-reason"
                    value={correctionReason}
                    onChange={(event) => setCorrectionReason(event.target.value)}
                    rows={2}
                    maxLength={500}
                    className="border-edge focus-visible:outline-accent mt-2 w-full border px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
                  />
                </div>
              ) : null}
            </>
          )}
          </div>

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

          {/* Pinned for the reason the Cell meeting screen gives. */}
          {recordable && lines.length > 0 ? (
            <div className="border-edge bg-surface sticky bottom-[calc(3.5625rem+env(safe-area-inset-bottom))] z-20 -mx-5 mt-8 flex flex-col gap-2 border-t px-5 py-3 sm:flex-row sm:items-center sm:justify-between lg:bottom-0">
              <p aria-live="polite" className="text-sm">
                {!changed && unmarkedCount === 0
                  ? 'Everyone here is recorded.'
                  : records.length === 0
                    ? 'Mark at least one person to save.'
                    : unmarkedCount === 0
                      ? 'Everyone on this checklist is marked.'
                      : `${unmarkedCount === 1 ? '1 person' : `${unmarkedCount} people`} still to mark.${newlyMarked ? ' You can save the rest now.' : ''}`}
              </p>
              {/* Offered only once something differs from what is stored. */}
              {changed || save.isPending ? (
                <Button
                  type="button"
                  className="w-full sm:w-auto"
                  onClick={() => save.mutate()}
                  disabled={save.isPending}
                >
                  {save.isPending ? 'Saving…' : 'Save'}
                </Button>
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
    <li className="border-line border-b py-4">
      <RadioGroup
        legend={line.full_name}
        description={`${line.member_id} · ${
          line.record === null ? 'Not recorded yet' : `Last recorded ${shortDate(line.record.recorded_at)}`
        }`}
        name={`person-${line.person_id}`}
        // **The recorded mark is shown whether or not the Sunday takes a record.**
        // Decision 0194 shows marks so a leader is not asked twice; blanking them on a
        // closed Sunday hid exactly what that decision exists to show.
        value={mark ?? ''}
        onChange={onChange}
        disabled={disabled}
        options={[
          { value: 'present', label: 'Present' },
          { value: 'absent', label: 'Absent' },
        ]}
      />
    </li>
  );
}

/** "6 Sep", the Manila day an instant fell on. */
function shortDate(instant: string): string {
  const day = todayInManila(new Date(instant));

  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}
