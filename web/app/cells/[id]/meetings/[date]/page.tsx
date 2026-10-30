'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';

import { AppShell, PAGE_WIDTH } from '@/components/app-shell';
import { SectionFrame } from '@/components/section-frame';
import { PersonPicker } from '@/components/person-picker';
import { Button } from '@/components/ui/button';
import { FailureNotice } from '@/components/ui/failure-notice';
import { RadioGroup, type RadioOption } from '@/components/ui/radio-group';
import { Tag } from '@/components/ui/tag';
import {
  categoryLabel,
  getMeetingRoster,
  listCellMeetings,
  meetingStateLabel,
  submitMeeting,
  timeLabel,
  type CellMeetingStatus,
  type CellSubmission,
  type RosterMember,
} from '@/lib/cells';
import { idempotencyKeyFor } from '@/lib/idempotency';
import { restoredNote, useMarkDraft } from '@/lib/mark-draft';
import { getMe } from '@/lib/me';
import { usePinnedBarPadding } from '@/lib/pinned-bar';
import {
  changedUnderNote,
  describeFailure,
  describeLineFailure,
  staleSaveFailure,
} from '@/lib/messages';
import { dayLabel, todayInManila } from '@/lib/reporting-month';
import { TextLink } from '@/components/ui/text-link';

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
 * **The rest are marked Absent by one button the leader presses** (decision 0395). It is
 * offered only once at least one member is marked; then "Mark the other 4 Absent" marks
 * every member still unmarked, and says how many, so a count larger than expected shows
 * somebody was missed. Save still waits until every member is marked, so every Absent is
 * one the leader chose.
 *
 * **A meeting whose day has not come offers no record.** Decision 0238 refuses one
 * before the day begins in Manila, so the screen says "Not yet" rather than offering a
 * Save the API would refuse.
 *
 * **Who ran it defaults to the leader** (decision 0274). "Someone else" opens the person
 * picker, which searches the reader's own scope and the leaders above them (decision 0389);
 * the API refuses an archived or merged Person. It is
 * asked on a first record of a meeting that met, since a correction does not change it.
 *
 * **A Cell that did not meet says why.** Section 13 requires a reason, and a reason of
 * `OTHER` requires a note saying what happened; Save waits for both.
 *
 * **A recorded meeting is shown as it stands, and correcting it is a deliberate step.**
 * Section 7 guards amending a submitted
 * record with `cell.correct_subtree`, separately from `cell.take_attendance`, so
 * "Edit meeting" is offered to an account holding that capability and the marks
 * are read-only until it is pressed. That is a courtesy and never the control: the API
 * resolves the capability against this meeting (section 1, principle 4).
 *
 * **While correcting, whether it met may be corrected too, with a reason** (decision
 * 0273): Met ↔ Did not meet, and the first report stays in the meeting's history. A
 * rescheduled meeting keeps its status here; moving it is its own operation.
 *
 * **The marks the roster carries are shown, which is the whole reason they exist.**
 * Decision 0223 gave the roster each member's mark precisely so that a correction
 * resubmits what is stored rather than blanking it.
 *
 * **One version for the meeting, not one per person** (section 14, decision 0164). A
 * Cell submission is one leader's account of one meeting, so the version read is
 * sent once and covers the roster.
 *
 * **Marks not yet saved are kept** (decision 0345): leaving asks first, and
 * the marks stay on this device and are offered back, with a Discard, if the screen opens
 * again before they are saved (`lib/mark-draft.ts`). A draft made against another version
 * of the meeting than the one stored now is not offered, because the marks it changed have
 * since changed themselves.
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

/** The marks a closed week shows over what is stored: none. One object, so memos hold. */
const NO_EDITS: Record<string, Mark> = {};

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

  const [editState, setEdits] = useState<Record<string, Mark>>({});
  const [statusChoice, setStatusChoice] = useState<'HELD' | 'NOT_HELD' | null>(null);
  const [notHeldReason, setNotHeldReason] = useState<NotHeldReason | ''>('');
  const [note, setNote] = useState('');
  const [correctionReason, setCorrectionReason] = useState('');
  const [editingState, setEditing] = useState(false);
  // Who ran it, on a first record: the leader unless somebody else is chosen.
  const [ranBy, setRanBy] = useState<'LEADER' | 'OTHER'>('LEADER');
  const [facilitator, setFacilitator] = useState<{ id: string; full_name: string } | null>(null);
  // A corrected answer to "did it meet", while editing a Met or Did-not-meet record.
  const [statusFix, setStatusFix] = useState<'HELD' | 'NOT_HELD' | null>(null);
  // **The version the edit started from** (owner's choice of 2026-10-27), null for a meeting
  // with no record, and what Save sends. The roster is read again in the background, on
  // returning to the tab, and sending the version read *now* would let marks chosen against
  // the old record overwrite a change the leader never saw. Null until the first change. The
  // marks stored then are kept with it, so Reload can tell which lines somebody else changed.
  const [startedFrom, setStartedFrom] = useState<{ version: number | null; marks: StoredMarks } | null>(
    null,
  );
  // Lines somebody else changed while this edit was open, shown after Reload (decision 0394).
  const [changedUnder, setChangedUnder] = useState<Record<string, ChangedLine>>({});

  // The Cell's category for the line under the date. Same capability as the roster, but
  // resolved against the Cell rather than the meeting, so a leader who led on the meeting's
  // date and no longer leads the Cell may be refused it (CLAUDE.md records the gap); the
  // line then names the Cell ID.
  const cell = useQuery({
    queryKey: ['cell-meetings', params.id, roster.data?.reporting_month],
    queryFn: ({ signal }) =>
      listCellMeetings(params.id, roster.data?.reporting_month ?? '', signal),
    enabled: roster.data !== undefined,
  });

  const members = useMemo(() => roster.data?.members ?? [], [roster.data]);
  const recorded = roster.data?.meeting ?? null;
  const correcting = recorded !== null;
  const recordedNotHeld = recorded?.status === 'NOT_HELD';
  // Compared as Manila dates: a meeting takes no record before its day begins (decision 0238).
  const notYet = recorded === null && params.date > todayInManila();
  // Nobody was in the Cell that day, so there is nothing to record and the meeting is not
  // owed (decision 0409). A record already made is shown as it is.
  const noMembers = recorded === null && !notYet && roster.data?.had_a_member === false;

  // Held at any scope. Whether it covers *this* meeting is the API's to decide.
  const canCorrect = (me.data?.capabilities ?? []).some(
    (grant) => grant.capability === 'cell.correct_subtree',
  );

  // Another leader's meeting, opened to follow it up (decision 0322): the API says this
  // reader may not record it, so it is shown and nothing on it is changeable.
  const followOnly = roster.data?.may_record === false;

  // A meeting whose week has closed (decision 0335): the save would be refused, so it is
  // shown and nothing on it is offered, as the DCC checklist shows a closed Sunday.
  const weekClosed = roster.data?.week_open === false;

  // **A week that closes while the page is open ends any edit in progress.** The roster is
  // read again when the reader returns to the tab, and once it says the week has closed no
  // save can succeed, so an edit left open would show marks nobody can keep under words
  // saying they are what is stored. Derived rather than reset, so nothing is set in render.
  const editing = editingState && !weekClosed;
  const edits = weekClosed ? NO_EDITS : editState;

  // A recorded meeting nobody has chosen to edit: shown, and not changeable.
  const locked = (correcting && !editing) || followOnly || weekClosed;

  /** Pins the version this edit is made against, once, at its first change. */
  function begin() {
    setStartedFrom(
      (current) => current ?? { version: recorded?.version ?? null, marks: storedMarks(members) },
    );
  }

  // What Save is checked against: the pinned version once the edit has begun.
  const baseVersion = startedFrom ? (startedFrom.version ?? undefined) : recorded?.version;

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

  // Only a Met or Did-not-meet record may have its status corrected (decision 0273).
  const statusEditable =
    editing && (recorded?.status === 'HELD' || recorded?.status === 'NOT_HELD');

  // The leader's choice on a first record; the recorded status, or its correction, after.
  const status: CellMeetingStatus =
    (statusEditable ? statusFix : null) ??
    recorded?.status ??
    // A choice made before the week closed is an edit in progress too, and ends with it.
    (weekClosed ? null : statusChoice) ??
    'HELD';
  const statusChanged = recorded !== null && status !== recorded.status;
  const reasonMissing = statusChanged && correctionReason.trim() === '';
  const askRanBy = recorded === null && status === 'HELD';
  const facilitatorMissing = askRanBy && ranBy === 'OTHER' && facilitator === null;
  const unmarked = members.filter((member) => markFor(member) === undefined);
  const noteRequired = notHeldReason === 'OTHER';

  const submission = useMemo((): CellSubmission | null => {
    if (!roster.data) {
      return null;
    }

    if (status === 'NOT_HELD') {
      // A first record, or a Met record corrected to Did not meet (decision 0273).
      if (
        (recorded !== null && !statusChanged) ||
        reasonMissing ||
        notHeldReason === '' ||
        (noteRequired && note.trim() === '')
      ) {
        return null;
      }

      return {
        status,
        version: baseVersion,
        not_held_reason: notHeldReason,
        not_held_note: note.trim() || undefined,
        correction_reason: statusChanged ? correctionReason.trim() : undefined,
      };
    }

    if (unmarked.length > 0 || reasonMissing || facilitatorMissing) {
      return null;
    }

    return {
      status,
      version: baseVersion,
      attendance: members.map((member) => ({
        person_id: member.person_id,
        present: markFor(member) === 'present',
      })),
      correction_reason: correcting && correctionReason.trim() ? correctionReason.trim() : undefined,
      facilitated_by: askRanBy && ranBy === 'OTHER' ? facilitator?.id : undefined,
    };
  }, [
    roster.data,
    status,
    recorded,
    baseVersion,
    notHeldReason,
    noteRequired,
    note,
    unmarked.length,
    members,
    markFor,
    correcting,
    correctionReason,
    statusChanged,
    reasonMissing,
    askRanBy,
    ranBy,
    facilitator,
    facilitatorMissing,
  ]);

  // Derived from the body rather than generated per attempt (decision 0127): the
  // same submission retried carries the same key and replays, and a changed mark
  // is a different submission and gets a different one.
  const idempotencyKey = useMemo(
    () => (submission === null ? null : idempotencyKeyFor(params.id, params.date, submission)),
    [submission, params.id, params.date],
  );

  // The body the server last accepted. Until the fresh roster arrives the marks still differ
  // from what the old one says, and they are saved all the same.
  const [savedKey, setSavedKey] = useState<string | null>(null);

  // The marks that differ from what is stored: what leaving would lose.
  const unsaved = useMemo(() => {
    if (idempotencyKey !== null && idempotencyKey === savedKey) {
      return null;
    }
    const changed = Object.entries(edits).filter(([personId, mark]) => {
      const member = members.find((entry) => entry.person_id === personId);

      return (
        member !== undefined &&
        (member.record === null || (mark === 'present') !== member.record.present)
      );
    });

    return changed.length === 0 || status === 'NOT_HELD'
      ? null
      : { version: baseVersion ?? null, marks: Object.fromEntries(changed) };
  }, [edits, members, baseVersion, status, idempotencyKey, savedKey]);

  const draft = useMarkDraft<{ version: number | null; marks: Record<string, Mark> }>({
    key:
      me.data && roster.data && !followOnly && !notYet && !noMembers && !weekClosed
        ? `cell:${params.id}:${params.date}:${me.data.person_id}`
        : null,
    draft: unsaved,
    restore: (stored) => {
      // Made against the meeting as it is stored now, and still changeable by this reader.
      if (stored.version !== (recorded?.version ?? null) || recordedNotHeld) {
        return false;
      }
      if (recorded !== null && !canCorrect) {
        return false;
      }
      const marks = Object.fromEntries(
        Object.entries(stored.marks ?? {}).filter(([personId, mark]) => {
          const member = members.find((entry) => entry.person_id === personId);

          return (
            member !== undefined &&
            (mark === 'present' || mark === 'absent') &&
            (member.record === null || (mark === 'present') !== member.record.present)
          );
        }),
      );
      if (Object.keys(marks).length === 0) {
        return false;
      }
      setEdits(marks);
      setStartedFrom({ version: stored.version, marks: storedMarks(members) });
      if (recorded !== null) {
        setEditing(true);
      }
      return true;
    },
  });

  function resetForm() {
    setEditing(false);
    setEdits({});
    setStatusChoice(null);
    setStatusFix(null);
    setRanBy('LEADER');
    setFacilitator(null);
    setNotHeldReason('');
    setNote('');
    setCorrectionReason('');
    setStartedFrom(null);
    setChangedUnder({});
  }

  const save = useMutation({
    mutationFn: () => {
      if (submission === null || idempotencyKey === null) {
        throw new Error('Nothing to submit.');
      }
      return submitMeeting(params.id, params.date, submission, idempotencyKey);
    },
    onSuccess: async () => {
      setSavedKey(idempotencyKey);
      // **The form is cleared after the fresh roster arrives, not before.** Clearing
      // first showed the old marks under "Saved." after a correction, and everybody
      // unmarked with Save enabled after a first record, until the refetch landed.
      await queryClient.invalidateQueries({ queryKey: ['meeting-roster', params.id, params.date] });
      await queryClient.invalidateQueries({ queryKey: ['cell-meetings', params.id] });
      // **The Dashboard's queue, by bare prefix rather than by month** (ruling of
      // 2026-09-17). The queue used to be assembled from `['cell-meetings', id, month]`
      // and so was cleared by the line above; it is now its own route under
      // `['meetings-awaiting', month]`, which that prefix does not reach. The month is
      // left off deliberately: in the close week the Dashboard holds two months and a
      // meeting recorded now may belong to either, so naming one would leave the other
      // asserting work that is done. Section 19 puts this queue above the figures so a
      // leader can trust it, and a queue that still lists what was just recorded breaks
      // that as surely as one that lists nothing because a read failed.
      await queryClient.invalidateQueries({ queryKey: ['meetings-awaiting'] });
      resetForm();
    },
  });

  /** Leaving edit mode discards what was changed, so the stored marks show again. */
  function stopEditing() {
    resetForm();
    save.reset();
  }

  const barRef = usePinnedBarPadding<HTMLDivElement>();

  const markedCount = members.length - unmarked.length;

  // Said beside Save in the pinned bar; at the top only where there is no bar.
  // Kept unless what is now stored is a record this reader may not correct (see `reload`).
  const stale = save.isError ? staleSaveFailure(save.error, 'this meeting') : null;
  const saveFailure = save.isError
    ? (stale ??
      describeLineFailure(save.error, 'attendance', (index) => {
        const member = members[index];
        return member ? member.full_name : null;
      }))
    : null;

  /**
   * **Reload after a refused correction** (decision 0394): the meeting is read again and the
   * edit starts over from what is stored now. The leader's marks are kept, except on a line
   * somebody else changed while the edit was open: there the saved mark shows, and a note
   * under the name says what the leader had marked, so neither change is lost unseen. A
   * meeting somebody else recorded first becomes a correction, which this reader may not make
   * without the capability, so then their marks are let go.
   */
  async function reload() {
    const fresh = await roster.refetch();
    // A failed read resolves with the old data, so only a successful one re-pins.
    if (!fresh.isSuccess) {
      return;
    }
    const meeting = fresh.data.meeting;
    if (meeting !== null && !canCorrect) {
      resetForm();
    } else {
      const { kept, changed } = settleAfterReload(editState, startedFrom?.marks ?? {}, fresh.data.members);
      setEdits(kept);
      setChangedUnder(changed);
      // A correction to Did not meet hides the marks; where somebody else changed one, the
      // answer goes back to Met so the reader sees what changed before deciding again.
      if (Object.keys(changed).length > 0) {
        setStatusFix(null);
      }
      setStartedFrom({ version: meeting?.version ?? null, marks: storedMarks(fresh.data.members) });
      if (meeting !== null) {
        setEditing(true);
      }
    }
    save.reset();
  }

  const reloadButton = stale ? (
    <Button variant="secondary" className="mt-3" onClick={() => void reload()}>
      Reload
    </Button>
  ) : null;

  // What Save is still waiting for, said rather than left to a greyed button.
  let saveHint: string;
  if (reasonMissing) {
    saveHint = 'Say why this is being corrected to save.';
  } else if (facilitatorMissing) {
    saveHint = 'Choose who ran it to save.';
  } else if (recordedNotHeld && !statusChanged) {
    saveHint = 'Change the answer above to correct it.';
  } else if (status === 'NOT_HELD') {
    saveHint =
      notHeldReason === ''
        ? 'Choose why it did not meet.'
        : noteRequired && note.trim() === ''
          ? 'Say what happened to save.'
          : 'Ready to save.';
  } else if (unmarked.length === 0) {
    saveHint = `All ${members.length} members marked.`;
  } else {
    saveHint =
      unmarked.length === 1 ? '1 member still to mark.' : `${unmarked.length} members still to mark.`;
  }

  // The members nobody has marked, marked Absent in one press (decision 0395). Offered only
  // once at least one member is marked, so it is never the first thing pressed and its count
  // is always of the rest: a larger count than expected shows somebody was missed.
  const restAbsentLabel =
    unmarked.length === 1 ? 'Mark the 1 left Absent' : `Mark the other ${unmarked.length} Absent`;
  const offerRestAbsent =
    status !== 'NOT_HELD' && unmarked.length > 0 && unmarked.length < members.length;

  return (
    <main id="main" className={PAGE_WIDTH.READING} data-form-layout>
      <SectionFrame section="record">
      <p className="mb-4">
        <TextLink href={`/cells/${params.id}/meetings`}>
          Back to this Cell&rsquo;s meetings
        </TextLink>
      </p>

      {/*
        **The date is in the accent** (owner's choices of 2026-09-15 and 2026-09-19, dates in the
        accent). It is the thing a leader must get right before marking anybody. A date
        is not a meeting status, a coverage figure or a leader, which is all sections
        13, 17 and 19 forbid encoding in colour.
      */}
      <h1 className="text-accent text-xl font-bold tracking-tight">{dayLabel(params.date)}</h1>
      {roster.data ? (
        <p className="text-muted mt-1 text-sm">
          {cell.data?.category
            ? `${categoryLabel(cell.data.category)} · ${timeLabel(roster.data.scheduled_time)} · ${roster.data.cell_id}`
            : `Cell ${roster.data.cell_id}`}
        </p>
      ) : null}
      {recorded !== null ? (
        <p className="mt-2">
          {/*
            An outlined word for what was reported. A meeting with no record carries
            no tag here: "Not recorded" is the absence of a report rather than a
            status beside the three a leader reports (`lib/cells.ts`).
          */}
          <Tag appearance="outline">{meetingStateLabel(recorded)}</Tag>
        </p>
      ) : null}
      {notYet ? null : (
        <p className="text-muted mt-3 max-w-2xl text-sm leading-relaxed">
          {noMembers
            ? `No member was in this Cell on ${dayLabel(params.date)}, so there is nothing to record and this meeting is not counted as owed.`
            : followOnly
            ? recorded === null
              ? weekClosed
                ? 'Not recorded. Its week has closed, so it can no longer be recorded.'
                : 'Not recorded yet. The Cell’s leader records it; you can see it here to follow up.'
              : 'The Cell’s leader recorded this meeting. You can see it here to follow up.'
            : weekClosed
            ? recorded === null
              ? 'This meeting was not recorded before its week closed, so it can no longer be recorded.'
              : recordedNotHeld
                ? 'This meeting is recorded: the Cell did not meet.'
                : 'This meeting has been recorded. The marks below are what is stored.'
            : recordedNotHeld
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
              : save.isError && locked
                ? saveFailure
                : me.isError
                  ? describeFailure(me.error)
                  : null
          }
        />
        {save.isError && locked ? reloadButton : null}
      </div>

      {roster.isPending ? (
        <p className="text-muted mt-6 text-sm">Loading&hellip;</p>
      ) : roster.data && noMembers ? null : roster.data && notYet ? (
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
              Saved.{' '}
              <TextLink inline href="/dashboard?list=awaiting">Back to Update Records</TextLink>
            </p>
          ) : null}

          {draft.restoredAt && unsaved ? (
            <div className="border-edge mt-6 border p-4">
              <p className="text-sm leading-relaxed">
                {restoredNote(draft.restoredAt)}
                {askRanBy ? ' Who ran it is not kept, so choose it again if it was someone else.' : ''}
              </p>
              <Button
                variant="secondary"
                className="mt-3"
                onClick={() => {
                  draft.discard();
                  stopEditing();
                }}
              >
                Discard
              </Button>
            </div>
          ) : null}

          {correcting ? (
            <div className="border-edge mt-6 border p-4">
              {editing ? (
                <>
                  <p className="text-sm font-bold">Editing the recorded meeting</p>
                  <p className="text-muted mt-1 text-sm leading-relaxed">
                    {statusEditable
                      ? 'Saving replaces what is recorded. If whether it met was recorded wrongly, change the answer below and say why: the first report is kept in the meeting’s history.'
                      : 'Saving replaces the marks already recorded.'}
                  </p>
                  <Button variant="secondary" className="mt-3" onClick={stopEditing}>
                    Cancel
                  </Button>
                </>
              ) : (
                <>
                  {recordedNotHeld ? (
                    <>
                      <p className="text-sm font-bold">Did not meet</p>
                      <p className="mt-1 text-sm">
                        Why: {notHeldReasonLabel(recorded.not_held_reason)}
                      </p>
                      {recorded.not_held_note ? (
                        <p className="text-muted mt-1 text-sm leading-relaxed">
                          {recorded.not_held_note}
                        </p>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-bold">Already recorded</p>
                      <p className="text-muted mt-1 text-sm">
                        {recordedSummary(recorded, members)}
                      </p>
                      <JoinedAfter
                        members={members}
                        mayEdit={!weekClosed && !followOnly && canCorrect}
                      />
                    </>
                  )}
                  {weekClosed ? (
                    <p className="text-muted mt-1 text-sm leading-relaxed">
                      This week is closed, so this meeting can no longer be changed.
                    </p>
                  ) : me.data && !followOnly ? (
                    canCorrect ? (
                      <Button variant="secondary" className="mt-3" onClick={() => {
                          begin();
                          setEditing(true);
                        }}
                      >
                        Edit meeting
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

          {/* The two questions side by side on a laptop, in one box (decision 0410). */}
          <div className="border-line mt-8 grid gap-6 rounded-md border p-5 empty:hidden lg:grid-cols-2 lg:gap-x-10">
            {/* On a first record, and while correcting a Met or Did-not-meet record. */}
            {(correcting && !statusEditable) || followOnly || weekClosed ? null : (
              <div>
                <RadioGroup
                  legend="Did the meeting take place?"
                  name="status"
                  value={status === 'NOT_HELD' ? 'NOT_HELD' : 'HELD'}
                  onChange={(value) => {
                    begin();
                    (correcting ? setStatusFix : setStatusChoice)(value);
                  }}
                  options={[
                    // Section 13 fixes these labels so wording cannot drift between screens.
                    { value: 'HELD', label: 'Met' },
                    { value: 'NOT_HELD', label: 'Did not meet' },
                  ]}
                />
              </div>
            )}

            {askRanBy && !followOnly && !weekClosed ? (
              <div className="flex flex-col gap-4">
                <RadioGroup
                  legend="Who ran the meeting?"
                  name="ran-by"
                  value={ranBy}
                  onChange={(value) => {
                    begin();
                    setRanBy(value);
                  }}
                  options={[
                    { value: 'LEADER', label: 'The leader' },
                    { value: 'OTHER', label: 'Someone else' },
                  ]}
                />
                {ranBy === 'OTHER' ? (
                  <PersonPicker
                    legend="Who ran it"
                    description="Somebody you oversee, or a leader above you."
                    searchLabel="Search for a person by name"
                    upline
                    selectedId={facilitator?.id ?? null}
                    selectedName={facilitator?.full_name ?? null}
                    onSelect={(person) => {
                      begin();
                      setFacilitator(person);
                    }}
                  />
                ) : null}
              </div>
            ) : null}
          </div>

          {status === 'NOT_HELD' ? (
            recorded === null || statusChanged ? (
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
          ) : weekClosed && recorded === null ? null : (
            // A meeting nobody recorded before its week closed has no marks to show and
            // takes none, so its roster and the instruction to mark it are not shown.
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
                <ul className="mt-4 grid gap-3 lg:grid-cols-2 lg:gap-x-4">
                  {members.map((member) => (
                    <MemberMark
                      key={member.person_id}
                      member={member}
                      mark={markFor(member)}
                      recorded={correcting}
                      disabled={locked}
                      note={changedUnder[member.person_id]}
                      onChange={(value) => {
                        begin();
                        setChangedUnder((current) =>
                          Object.fromEntries(Object.entries(current).filter(([id]) => id !== member.person_id)),
                        );
                        setEdits((current) => ({ ...current, [member.person_id]: value }));
                      }}
                    />
                  ))}
                </ul>
              )}
            </section>
          )}

          {correcting && editing ? (
            <div className="mt-6">
              <label htmlFor="correction-reason" className="field-label block">
                {statusChanged ? 'Why is this being corrected?' : 'Why is this changing? (optional)'}
              </label>
              <textarea
                id="correction-reason"
                value={correctionReason}
                onChange={(event) => setCorrectionReason(event.target.value)}
                rows={2}
                maxLength={500}
                required={statusChanged}
                className="border-edge focus-visible:outline-accent mt-2 w-full border px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
              />
            </div>
          ) : null}

          {/*
            **Save stays in reach on a phone.** The bar is pinned to the bottom of the
            screen above the tab bar below `lg`, and to the bottom at `lg`, so a leader
            tapping down a long roster never scrolls back to find it. It says what is
            still needed, because a greyed button says only that something is wrong.
            The page's scroll padding (`app/layout.tsx`, raised to the bar's height by
            `usePinnedBarPadding` when the bar grows) keeps a focused control clear of it.
          */}
          {locked ? null : (
            <div
              ref={barRef}
              className="border-edge bg-surface sticky bottom-[calc(3.5625rem+env(safe-area-inset-bottom))] z-20 -mx-5 mt-8 flex flex-col gap-2 border-t px-5 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between lg:bottom-0"
            >
              {/*
                **A refused save is said here, beside Save**, not at the top of the page,
                where on a phone it sat off-screen and Save looked as if it did nothing.
                The live region is mounted with the bar, before anything goes wrong, so a
                screen reader announces the refusal when it arrives; empty, it takes no
                room.
              */}
              <div className={saveFailure ? 'sm:basis-full' : 'sr-only'}>
                <FailureNotice failure={saveFailure} />
                {reloadButton}
              </div>
              <p id="save-hint" tabIndex={-1} aria-live="polite" className="text-sm">
                {saveHint}
              </p>
              {/* One way back, the link at the top (owner's choice of 2026-10-05). */}
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
                {offerRestAbsent ? (
                  <Button
                    type="button"
                    variant="secondary"
                    // Above Save on a phone, where the bar stacks in reverse; beside it from `sm`.
                    className="order-last w-full sm:order-none sm:w-auto"
                    onClick={() => {
                      setEdits((current) => ({
                        ...current,
                        ...Object.fromEntries(
                          unmarked.map((member) => [member.person_id, 'absent' as const]),
                        ),
                      }));
                      // The button goes once nobody is left to mark, so focus moves on rather than
                      // falling to the page (2.4.3): to Save, or, where Save still waits for
                      // something, to the line saying what.
                      requestAnimationFrame(() => {
                        const saveButton = document.getElementById('save-meeting');
                        if (saveButton instanceof HTMLButtonElement && !saveButton.disabled) {
                          saveButton.focus();
                        } else {
                          document.getElementById('save-hint')?.focus();
                        }
                      });
                    }}
                  >
                    {restAbsentLabel}
                  </Button>
                ) : null}
                <Button
                  id="save-meeting"
                  type="button"
                  className="w-full sm:w-auto"
                  onClick={() => save.mutate()}
                  disabled={submission === null || save.isPending}
                >
                  {save.isPending
                    ? 'Saving…'
                    : correcting
                      ? 'Save correction'
                      : 'Save meeting'}
                </Button>
              </div>
            </div>
          )}
        </>
      ) : null}
    </SectionFrame>
    </main>
  );
}

/** Added to the Cell after the meeting was first recorded, and so far unmarked. */
function joinedAfter(member: RosterMember): boolean {
  return member.joined_after_recorded === true && member.record === null;
}

/**
 * Asks whether people added to the Cell after the meeting was recorded came to it (decision
 * 0391). The roster is everyone in the Cell on the meeting's date (section 12), so a
 * person added that evening is on it with no mark; in G12 they usually came that night,
 * which is why they were added. "Not marked" read as the leader having skipped them.
 */
function JoinedAfter({ members, mayEdit }: { members: RosterMember[]; mayEdit: boolean }) {
  const late = members.filter(joinedAfter);
  if (late.length === 0) {
    return null;
  }

  const one = late.length === 1;
  const names = late.map((member) => member.full_name);
  const list = one
    ? names[0]
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

  return (
    <p className="border-accent text-ink mt-3 rounded-md border-2 px-3 py-2 text-sm leading-relaxed">
      <span className="font-bold">
        {list} joined the Cell after this was recorded.
      </span>{' '}
      {one ? `Was ${late[0].first_name} at this meeting?` : 'Were they at this meeting?'}
      {mayEdit ? (one ? ' Press Edit meeting to add a mark.' : ' Press Edit meeting to add their marks.') : ''}
    </p>
  );
}

function MemberMark({
  member,
  mark,
  recorded,
  disabled,
  note,
  onChange,
}: {
  member: RosterMember;
  mark: Mark | undefined;
  recorded: boolean;
  disabled: boolean;
  /** Somebody else changed this line while the edit was open (decision 0394). */
  note?: ChangedLine;
  onChange: (mark: Mark) => void;
}) {
  return (
    <li className="border-line rounded-md border px-4 py-4">
      <RadioGroup
        legend={member.full_name}
        // Kept until Save, so a first tap does not shift the rows beneath it; nothing is
        // recorded until then, as the DCC checklist says too.
        description={
          note
            ? changedUnderNote(note)
            : recorded && joinedAfter(member)
              ? 'Joined the Cell after this was recorded'
              : recorded
                ? undefined
                : 'Not recorded yet'
        }
        name={`member-${member.person_id}`}
        value={mark ?? ''}
        onChange={onChange}
        disabled={disabled}
        layout="row"
        options={[
          { value: 'present', label: 'Present' },
          { value: 'absent', label: 'Absent' },
        ]}
      />
    </li>
  );
}

type StoredMarks = Record<string, boolean | null>;

/** Each member's stored mark, null where none is recorded. */
function storedMarks(members: readonly RosterMember[]): StoredMarks {
  return Object.fromEntries(members.map((member) => [member.person_id, member.record?.present ?? null]));
}

/** A line somebody else changed: their saved mark, and the reader's own where they made one. */
type ChangedLine = { theirs: Mark; yours?: Mark };

/**
 * The marks to keep after Reload, and the lines somebody else changed (decision 0394). Every
 * line whose stored mark moved since the edit began is named in a note, whether or not the
 * reader marked it. Where the reader had marked it differently, the stored mark shows and the
 * note names the reader's; where it moved to the reader's own mark, it needs no edit. The
 * reader's other marks are kept.
 */
function settleAfterReload(
  edits: Record<string, Mark>,
  startedFrom: StoredMarks,
  fresh: readonly RosterMember[],
): { kept: Record<string, Mark>; changed: Record<string, ChangedLine> } {
  const kept: Record<string, Mark> = {};
  const changed: Record<string, ChangedLine> = {};

  for (const member of fresh) {
    const personId = member.person_id;
    const now = member.record?.present ?? null;
    const theirs: Mark | null = now === null ? null : now ? 'present' : 'absent';
    const moved = theirs !== null && personId in startedFrom && now !== startedFrom[personId];
    const yours = edits[personId];

    if (yours === undefined) {
      if (moved) {
        changed[personId] = { theirs };
      }
    } else if (theirs === yours) {
      // Already what the reader marked: nothing to keep, and nothing to say.
    } else if (moved) {
      changed[personId] = { theirs, yours };
    } else {
      kept[personId] = yours;
    }
  }

  return { kept, changed };
}

/**
 * "First recorded on 12 Sep · 4 present, 1 absent". A correction keeps the first
 * submission's time (section 14). No name, on decision 0201's reasoning that the
 * recording account's name is not handed to a reader who cannot correct the record.
 */
function recordedSummary(
  recorded: { submitted_at: string | null },
  members: RosterMember[],
): string {
  const present = members.filter((member) => member.record?.present === true).length;
  const absent = members.filter((member) => member.record?.present === false).length;
  const late = members.filter(joinedAfter).length;
  const unmarked = members.length - present - absent - late;
  const counts =
    `${present} present, ${absent} absent` +
    (unmarked > 0 ? `, ${unmarked} not marked` : '') +
    (late > 0 ? `, ${late} added after it was recorded` : '');

  if (recorded.submitted_at === null) {
    return counts;
  }

  const day = todayInManila(new Date(recorded.submitted_at));
  const label = new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });

  return `First recorded on ${label} · ${counts}`;
}
