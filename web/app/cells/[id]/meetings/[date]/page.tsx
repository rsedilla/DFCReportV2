'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';

import { AppShell, PAGE_WIDTH } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { FailureNotice } from '@/components/ui/failure-notice';
import { RadioGroup, type RadioOption } from '@/components/ui/radio-group';
import { Tag } from '@/components/ui/tag';
import {
  getMeetingRoster,
  meetingStateLabel,
  submitMeeting,
  type CellMeetingStatus,
  type CellSubmission,
  type RosterMember,
} from '@/lib/cells';
import { idempotencyKeyFor } from '@/lib/idempotency';
import { getMe } from '@/lib/me';
import { describeFailure } from '@/lib/messages';
import { dayLabel, todayInManila } from '@/lib/reporting-month';

/**
 * Recording one Cell meeting (SKILL.md sections 12, 13, 14 and 22; decisions 0127,
 * 0195 and 0223).
 *
 * **A submission is the whole roster, so this screen makes the leader account for
 * every member.** Section 13 requires a `HELD` submission to name every member
 * exactly once, present or not, and the API refuses one that omits anybody. So Save
 * stays disabled until every member is marked, and the count of what is still
 * unmarked is stated rather than left for the leader to find by scrolling. There is
 * no "mark all present" (owner's choice of 2026-09-15): section 9 rests a record on
 * a leader knowing who was in the room, and one tap for everybody makes the easy
 * record the wrong one.
 *
 * **An unmarked member is not an absent one.** The roster returns `null` for
 * somebody nobody has recorded, and this screen keeps that as a third state rather
 * than defaulting the control to Absent. Section 13 has a roster declared by its
 * leader, and a screen that pre-selected Absent would manufacture a declaration
 * nobody made — which on a correction would silently overwrite the marks the leader
 * came here to keep.
 *
 * **A meeting whose day has not come offers no record.** Decision 0238 refuses one
 * before the day begins in Manila, so the screen says "Not yet" rather than offering a
 * Save the API would refuse.
 *
 * **A Cell that did not meet says why.** Section 13 requires a reason, and a reason of
 * `OTHER` requires a note saying what happened; Save waits for both.
 *
 * **A recorded meeting is shown as it stands, and correcting it is a deliberate step
 * that corrects the marks and nothing else.** Section 7 guards amending a submitted
 * record with `cell.correct_subtree`, separately from `cell.take_attendance`, so
 * "Edit this record" is offered to an account holding that capability and the marks
 * are read-only until it is pressed. That is a courtesy and never the control: the API
 * resolves the capability against this meeting (section 1, principle 4).
 *
 * While correcting, the status stays the one recorded and is not offered for change.
 * Decision 0195 admits only the transitions section 13 names, none of them from `HELD`
 * to `NOT_HELD` or back, and changing a status recorded in error is an operation
 * section 13 does not define and `CLAUDE.md` records as open. A meeting recorded as
 * **not held** carries no marks to correct and its reason is not changed on this route,
 * so it is shown read-only with no edit offered.
 *
 * **The marks the roster carries are shown, which is the whole reason they exist.**
 * Decision 0223 gave the roster each member's mark precisely so that a correction
 * resubmits what is stored rather than blanking it.
 *
 * **One version for the meeting, not one per person** (section 14, decision 0164). A
 * Cell submission is one leader's account of one meeting, so the version read is
 * sent once and covers the roster.
 *
 * **The idempotency key changes when the body does** (decision 0127). It is derived
 * from what will be sent, so pressing Save twice writes once, and a retry after a
 * dropped connection replays rather than recording a second time — while a leader
 * who changes a mark and saves again is making a new submission and gets a new key.
 */
export default function RecordMeetingPage() {
  return (
    <AppShell>
      <RecordMeeting />
    </AppShell>
  );
}

type Mark = 'present' | 'absent';

type NotHeldReason =
  | 'LEADER_UNAVAILABLE'
  | 'WEATHER_OR_CALAMITY'
  | 'HOLIDAY_OR_CHURCH_EVENT'
  | 'NO_MEMBERS_AVAILABLE'
  | 'OTHER';

/** The reasons section 13 accepts, in the labels section 13 fixes so wording cannot drift. */
const NOT_HELD_REASONS: readonly RadioOption<NotHeldReason>[] = [
  { value: 'LEADER_UNAVAILABLE', label: 'Leader could not be there' },
  { value: 'WEATHER_OR_CALAMITY', label: 'Weather or calamity' },
  { value: 'HOLIDAY_OR_CHURCH_EVENT', label: 'Holiday or church event' },
  { value: 'NO_MEMBERS_AVAILABLE', label: 'Members could not come' },
  { value: 'OTHER', label: 'Other' },
];

function notHeldReasonLabel(reason: string | null): string {
  return NOT_HELD_REASONS.find((option) => option.value === reason)?.label ?? 'Not given';
}

function RecordMeeting() {
  const params = useParams<{ id: string; date: string }>();
  const queryClient = useQueryClient();

  const me = useQuery({ queryKey: ['me'], queryFn: ({ signal }) => getMe(signal) });

  const roster = useQuery({
    queryKey: ['meeting-roster', params.id, params.date],
    queryFn: ({ signal }) => getMeetingRoster(params.id, params.date, signal),
  });

  const [edits, setEdits] = useState<Record<string, Mark>>({});
  const [statusChoice, setStatusChoice] = useState<'HELD' | 'NOT_HELD' | null>(null);
  const [notHeldReason, setNotHeldReason] = useState<NotHeldReason | ''>('');
  const [note, setNote] = useState('');
  const [correctionReason, setCorrectionReason] = useState('');
  const [editing, setEditing] = useState(false);

  const members = useMemo(() => roster.data?.members ?? [], [roster.data]);
  const recorded = roster.data?.meeting ?? null;
  const correcting = recorded !== null;
  const recordedNotHeld = recorded?.status === 'NOT_HELD';
  // Compared as Manila dates: a meeting takes no record before its day begins (decision 0238).
  const notYet = recorded === null && params.date > todayInManila();

  // Held at any scope. Whether it covers *this* meeting is the API's to decide.
  const canCorrect = (me.data?.capabilities ?? []).some(
    (grant) => grant.capability === 'cell.correct_subtree',
  );

  // A recorded meeting nobody has chosen to edit: shown, and not changeable.
  const locked = correcting && !editing;

  /**
   * What is stored, overlaid with what the leader has changed since.
   *
   * **Derived rather than copied into state when the roster arrives.** Seeding an
   * effect would also re-seed on every refetch, which discards the marks a leader
   * has made and not yet saved — on a screen where losing them is the failure
   * decision 0223 exists to prevent. A member with no stored record and no edit
   * stays `undefined`, which is the state this screen refuses to guess at.
   */
  const markFor = useCallback(
    (member: RosterMember): Mark | undefined =>
      edits[member.person_id] ??
      (member.record === null ? undefined : member.record.present ? 'present' : 'absent'),
    [edits],
  );

  // The recorded status while correcting, and the leader's choice on a first record.
  const status: CellMeetingStatus = recorded?.status ?? statusChoice ?? 'HELD';
  const unmarked = members.filter((member) => markFor(member) === undefined);
  const noteRequired = notHeldReason === 'OTHER';

  const submission = useMemo((): CellSubmission | null => {
    if (!roster.data) {
      return null;
    }

    if (status === 'NOT_HELD') {
      // Only a first record reaches here: a meeting recorded not held is read-only.
      if (recorded !== null || notHeldReason === '' || (noteRequired && note.trim() === '')) {
        return null;
      }

      return {
        status,
        not_held_reason: notHeldReason,
        not_held_note: note.trim() || undefined,
      };
    }

    if (unmarked.length > 0) {
      return null;
    }

    return {
      status,
      submitted_version: recorded?.version,
      attendance: members.map((member) => ({
        person_id: member.person_id,
        present: markFor(member) === 'present',
      })),
      correction_reason: correcting && correctionReason.trim() ? correctionReason.trim() : undefined,
    };
  }, [
    roster.data,
    status,
    recorded,
    notHeldReason,
    noteRequired,
    note,
    unmarked.length,
    members,
    markFor,
    correcting,
    correctionReason,
  ]);

  // Derived from the body rather than generated per attempt (decision 0127): the
  // same submission retried carries the same key and replays, and a changed mark
  // is a different submission and gets a different one.
  const idempotencyKey = useMemo(
    () => (submission === null ? null : idempotencyKeyFor(params.id, params.date, submission)),
    [submission, params.id, params.date],
  );

  function resetForm() {
    setEditing(false);
    setEdits({});
    setStatusChoice(null);
    setNotHeldReason('');
    setNote('');
    setCorrectionReason('');
  }

  const save = useMutation({
    mutationFn: () => {
      if (submission === null || idempotencyKey === null) {
        throw new Error('Nothing to submit.');
      }
      return submitMeeting(params.id, params.date, submission, idempotencyKey);
    },
    onSuccess: async () => {
      // **The form is cleared after the fresh roster arrives, not before.** Clearing
      // first showed the old marks under "Saved." after a correction, and everybody
      // unmarked with Save enabled after a first record, until the refetch landed.
      await queryClient.invalidateQueries({ queryKey: ['meeting-roster', params.id, params.date] });
      await queryClient.invalidateQueries({ queryKey: ['cell-meetings', params.id] });
      resetForm();
    },
  });

  /** Leaving edit mode discards what was changed, so the stored marks show again. */
  function stopEditing() {
    resetForm();
    save.reset();
  }

  const markedCount = members.length - unmarked.length;

  return (
    <main id="main" className={PAGE_WIDTH.READING}>
      <p className="mb-4">
        <Link
          href={`/cells/${params.id}/meetings`}
          className="focus-visible:outline-accent text-accent inline-flex min-h-6 items-center text-sm font-medium underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          Back to this Cell&rsquo;s meetings
        </Link>
      </p>

      {/*
        **The date is red, and on the two recording screens only** (owner's choice of
        2026-09-15). It is the thing a leader must get right before marking anybody, so
        the accent is doing a job here; every other page heading stays `ink`, which keeps
        red meaningful. A date is not a meeting status, a coverage figure or a leader,
        which is all sections 13, 17 and 19 forbid encoding in colour.
      */}
      <h1 className="text-accent text-2xl font-bold tracking-tight">{dayLabel(params.date)}</h1>
      {roster.data ? <p className="text-muted mt-1 text-sm">Cell {roster.data.cell_id}</p> : null}
      {recorded !== null ? (
        <p className="mt-2">
          {/*
            An outlined word for what was reported. A meeting with no record carries
            no tag here: "awaiting a record" is the absence of a report rather than a
            status beside the three a leader reports (`lib/cells.ts`).
          */}
          <Tag appearance="outline">{meetingStateLabel(recorded)}</Tag>
        </p>
      ) : null}
      {notYet ? null : (
        <p className="text-muted mt-3 max-w-2xl text-sm leading-relaxed">
          {recordedNotHeld
            ? 'This meeting is recorded: the Cell did not meet.'
            : correcting
              ? 'This meeting has already been recorded. A correction replaces the whole roster, so every member is sent again — the marks below are what is stored now.'
              : 'Record what happened. A Cell that met needs every member marked, present or not.'}
        </p>
      )}

      <div className="mt-8">
        <FailureNotice
          failure={
            roster.isError
              ? describeFailure(roster.error)
              : save.isError
                ? describeFailure(save.error)
                : me.isError
                  ? describeFailure(me.error)
                  : null
          }
        />
      </div>

      {roster.isPending ? (
        <p className="text-muted mt-6 text-sm">Loading&hellip;</p>
      ) : roster.data && notYet ? (
        <div className="border-edge mt-6 border p-4">
          <p className="text-sm font-bold">Not yet</p>
          <p className="text-muted mt-1 text-sm leading-relaxed">
            This meeting can be recorded from its own day.
          </p>
        </div>
      ) : roster.data ? (
        <>
          {save.isSuccess ? (
            // Polite, because it is the result of the reader's own action.
            <p aria-live="polite" className="mt-6 text-sm font-medium">
              Saved.
            </p>
          ) : null}

          {recorded !== null && recordedNotHeld ? (
            <div className="border-edge mt-6 border p-4">
              <p className="text-sm font-bold">Did not meet</p>
              <p className="mt-1 text-sm">Why: {notHeldReasonLabel(recorded.not_held_reason)}</p>
              {recorded.not_held_note ? (
                <p className="text-muted mt-1 text-sm leading-relaxed">{recorded.not_held_note}</p>
              ) : null}
              <p className="text-muted mt-3 text-sm leading-relaxed">
                A meeting recorded as not meeting is not changed from this screen.
              </p>
            </div>
          ) : correcting ? (
            <div className="border-edge mt-6 border p-4">
              {editing ? (
                <>
                  <p className="text-sm font-bold">Editing the recorded meeting</p>
                  <p className="text-muted mt-1 text-sm leading-relaxed">
                    Saving replaces the marks already recorded.
                  </p>
                  <Button variant="quiet" className="mt-3" onClick={stopEditing}>
                    Stop editing
                  </Button>
                </>
              ) : (
                <>
                  <p className="text-sm font-bold">Already recorded</p>
                  {me.data ? (
                    canCorrect ? (
                      <Button variant="secondary" className="mt-3" onClick={() => setEditing(true)}>
                        Edit this record
                      </Button>
                    ) : (
                      <p className="text-muted mt-1 text-sm leading-relaxed">
                        Changing a recorded meeting needs permission to correct records, which
                        this account does not hold.
                      </p>
                    )
                  ) : null}
                </>
              )}
            </div>
          ) : null}

          {/* Offered on a first record only; a correction keeps the status recorded. */}
          {correcting ? null : (
            <div className="mt-8">
              <RadioGroup
                legend="Did the Cell meet?"
                name="status"
                value={status === 'NOT_HELD' ? 'NOT_HELD' : 'HELD'}
                onChange={setStatusChoice}
                options={[
                  { value: 'HELD', label: 'Met' },
                  { value: 'NOT_HELD', label: 'Did not meet' },
                ]}
              />
            </div>
          )}

          {status === 'NOT_HELD' ? (
            recorded === null ? (
              <div className="mt-6 flex flex-col gap-6">
                <RadioGroup
                  legend="Why did it not meet?"
                  description="Reporting honestly that the Cell could not meet is a record like any other. It counts as recorded and is not a mark against anybody. Choose “Members could not come” only if it was known beforehand that nobody could come. If the leader was there and nobody came, the Cell met, with everyone marked absent."
                  name="not-held-reason"
                  value={notHeldReason}
                  onChange={setNotHeldReason}
                  options={NOT_HELD_REASONS}
                />
                <div>
                  <label htmlFor="not-held-note" className="field-label block">
                    {noteRequired ? 'What happened?' : 'What happened? (optional)'}
                  </label>
                  <textarea
                    id="not-held-note"
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    rows={3}
                    maxLength={1000}
                    className="border-edge focus-visible:outline-accent mt-2 w-full border px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
                  />
                </div>
              </div>
            ) : null
          ) : (
            <section className="mt-8" aria-labelledby="roster-heading">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h2 id="roster-heading" className="text-lg font-bold tracking-tight">
                  Who was there
                </h2>
                {members.length > 0 ? (
                  <p className="text-sm">
                    {markedCount} of {members.length} marked
                  </p>
                ) : null}
              </div>
              <p className="text-muted mt-1 max-w-2xl text-sm leading-relaxed">
                Every member is listed and every one needs a mark. Nobody is assumed absent.
              </p>

              {members.length === 0 ? (
                <p className="text-muted mt-4 text-sm">
                  This Cell had no members on the meeting date, so there is nobody to mark.
                </p>
              ) : (
                <ul className="border-line mt-4 border-t">
                  {members.map((member) => (
                    <MemberMark
                      key={member.person_id}
                      member={member}
                      mark={markFor(member)}
                      disabled={locked}
                      onChange={(value) =>
                        setEdits((current) => ({ ...current, [member.person_id]: value }))
                      }
                    />
                  ))}
                </ul>
              )}

              {correcting && editing ? (
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
            </section>
          )}

          {/*
            **Save stays in reach on a phone.** The bar is pinned to the bottom of the
            screen above the tab bar below `lg`, and to the bottom at `lg`, so a leader
            tapping down a long roster never scrolls back to find it. It says what is
            still needed, because a greyed button says only that something is wrong.
            The page's scroll padding (`app/layout.tsx`) keeps a focused control clear
            of it.
          */}
          {locked ? null : (
            <div className="border-edge bg-surface sticky bottom-[calc(3.5625rem+env(safe-area-inset-bottom))] z-20 -mx-5 mt-8 flex flex-col gap-2 border-t px-5 py-3 sm:flex-row sm:items-center sm:justify-between lg:bottom-0">
              <p aria-live="polite" className="text-sm">
                {status === 'NOT_HELD'
                  ? notHeldReason === ''
                    ? 'Choose why it did not meet.'
                    : noteRequired && note.trim() === ''
                      ? 'Say what happened to save.'
                      : 'Ready to save.'
                  : unmarked.length === 0
                    ? `All ${members.length} members marked.`
                    : unmarked.length === 1
                      ? '1 member still to mark.'
                      : `${unmarked.length} members still to mark.`}
              </p>
              <Button
                type="button"
                className="w-full sm:w-auto"
                onClick={() => save.mutate()}
                disabled={submission === null || save.isPending}
              >
                {save.isPending ? 'Saving…' : correcting ? 'Save the correction' : 'Save'}
              </Button>
            </div>
          )}
        </>
      ) : null}
    </main>
  );
}

function MemberMark({
  member,
  mark,
  disabled,
  onChange,
}: {
  member: RosterMember;
  mark: Mark | undefined;
  disabled: boolean;
  onChange: (mark: Mark) => void;
}) {
  return (
    <li className="border-line border-b py-4">
      <RadioGroup
        legend={`${member.first_name} ${member.last_name}`}
        description={mark === undefined ? 'Not recorded yet' : undefined}
        name={`member-${member.person_id}`}
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
