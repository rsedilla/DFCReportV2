'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { AppShell, PAGE_WIDTH } from '@/components/app-shell';
import { SectionFrame } from '@/components/section-frame';
import { Button } from '@/components/ui/button';
import { FailureNotice } from '@/components/ui/failure-notice';
import { FRAME } from '@/components/ui/frame';
import { RadioGroup } from '@/components/ui/radio-group';
import {
  getDccRoster,
  getLeaderDccRoster,
  notRecordableLabel,
  submitDccAttendance,
  type DccRecordInput,
  type DccRosterLine,
  type LeaderDccRoster,
} from '@/lib/dcc';
import { idempotencyKeyFor } from '@/lib/idempotency';
import { restoredNote, useMarkDraft } from '@/lib/mark-draft';
import { getMe, holdsWholeChurch } from '@/lib/me';
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
 *
 * **Marks not yet saved are kept**, as on the Cell meeting screen (decision 0345,
 * `lib/mark-draft.ts`). Each kept mark carries the version its line was read at,
 * so a draft offered back never overwrites a line somebody has recorded since.
 */
export default function DccRosterPage() {
  return (
    <AppShell>
      <DccChecklist />
    </AppShell>
  );
}

type Mark = 'present' | 'absent';

/** The marks a Sunday that takes no record shows over what is stored: none. */
const NO_EDITS: Record<string, Mark> = {};

function DccChecklist() {
  const params = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  // **Another leader's checklist, recorded on their behalf** (decision 0313), reached from
  // that leader's Record on the Record page. Absent, the screen is the reader's own.
  const leaderId = useSearchParams().get('leader');

  const roster = useQuery({
    queryKey: ['dcc-roster', params.id, leaderId ?? 'own'],
    queryFn: ({ signal }) =>
      leaderId === null
        ? getDccRoster(params.id, signal)
        : getLeaderDccRoster(params.id, leaderId, signal),
  });
  const forLeader = leaderId === null ? null : ((roster.data as LeaderDccRoster | undefined)?.leader ?? null);

  const me = useQuery({ queryKey: ['me'], queryFn: ({ signal }) => getMe(signal) });

  const [editState, setEdits] = useState<Record<string, Mark>>({});
  const [editingState, setEditing] = useState(false);
  const [correctionReason, setCorrectionReason] = useState('');
  // **The version each changed line was read at when its mark was first changed** (owner's
  // choice of 2026-10-27), null for a person with no record, and what Save sends for that
  // line. The checklist is read again in the background, on returning to the tab, and the
  // version read *now* would let a mark chosen against the old record overwrite a change the
  // leader never saw. The mark stored then is kept with it, so Reload can tell which lines
  // somebody else changed.
  const [startedFrom, setStartedFrom] = useState<Record<string, Pin>>({});
  // Lines somebody else changed while their mark was being changed here, shown after Reload
  // (decision 0394).
  const [changedUnder, setChangedUnder] = useState<Record<string, ChangedLine>>({});
  // Every line's stored mark when this edit's first change was made, so Reload can name a
  // line somebody else changed that this leader never touched (decision 0394).
  const [openedWith, setOpenedWith] = useState<Record<string, boolean | null> | null>(null);
  // The Admin amending a closed week, and why (decision 0411).
  const [amending, setAmending] = useState(false);
  const [amendReason, setAmendReason] = useState('');

  const lines = useMemo(() => roster.data?.data ?? [], [roster.data]);
  const event = roster.data?.event ?? null;
  // **The Admin may amend a closed week** (decision 0411): a Sunday closed only because its
  // week has closed is offered to an account holding the backdating capability over the whole
  // church, and while it is being amended the checklist works as it does while the week is
  // open. The server decides whether this account may (section 9).
  const mayAmend =
    event?.recordable === false &&
    event.not_recordable_reason === 'MONTH_CLOSED' &&
    holdsWholeChurch(me.data, 'records.backdate_effective_date') &&
    (roster.data?.data ?? []).length > 0;
  const recordable = (event?.recordable ?? false) || (amending && mayAmend);
  const amendment = useMemo(
    () => (amending ? { reason: amendReason.trim() } : undefined),
    [amending, amendReason],
  );
  const amendReasonMissing = amending && amendReason.trim() === '';

  // **A Sunday that stops taking records while the page is open ends any edit in
  // progress**, as on the Cell meeting screen: no save can succeed, so marks left over
  // would show where nobody can keep or discard them. Derived, so nothing is set in render.
  const edits = recordable ? editState : NO_EDITS;
  const editing = (editingState || amending) && recordable;
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
    setStartedFrom((current) =>
      Object.fromEntries(
        Object.entries(current).filter(
          ([personId]) => lines.find((line) => line.person_id === personId)?.record === null,
        ),
      ),
    );
    setChangedUnder({});
    // Marks on lines with no record survive Cancel, so the snapshot they are measured against
    // is kept with them; with none left, the next change takes a fresh one.
    const remaining = Object.keys(edits).some(
      (personId) => lines.find((line) => line.person_id === personId)?.record === null,
    );
    if (!remaining) {
      setOpenedWith(null);
    }
    setCorrectionReason('');
    setEditing(false);
    // **Cancelling an amendment drops every mark made in it**, a line with no record too,
    // and the copy kept on the device (decision 0345), or the next Amend would restore them.
    if (amending) {
      setEdits({});
      setStartedFrom({});
      setOpenedWith(null);
      draft.discard();
    }
    setAmending(false);
    setAmendReason('');
  }

  // **Focus follows the amendment** (WCAG 2.4.3): Amend Closed Week and Cancel each remove
  // the button just pressed, so focus moves to what replaced it rather than to the page.
  const amendWasOn = useRef(false);
  useEffect(() => {
    if (amending && !amendWasOn.current) {
      document.getElementById('amending-heading')?.focus();
    } else if (!amending && amendWasOn.current) {
      document.getElementById('amend-closed-week')?.focus();
    }
    amendWasOn.current = amending;
  }, [amending]);

  /** The version a line's change is made against: the one pinned at its first change. */
  const versionFor = useCallback(
    (line: DccRosterLine): number | null =>
      line.person_id in edits && line.person_id in startedFrom
        ? startedFrom[line.person_id].version
        : (line.record?.version ?? null),
    [startedFrom, edits],
  );

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
    // While amending, the amendment's reason is sent as each corrected line's too (decision 0411).
    const reason = (amending ? amendReason : correctionReason).trim();

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
          version: versionFor(line),
          ...(corrected && reason ? { correction_reason: reason } : {}),
        };
      });
  }, [lines, edits, correctionReason, amending, amendReason, versionFor]);

  // The amendment is part of the body, so a changed reason is a different submission.
  const idempotencyKey = useMemo(
    () => idempotencyKeyFor(params.id, records, amendment ?? null),
    [params.id, records, amendment],
  );

  const [savedKey, setSavedKey] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (sent: DccRecordInput[]) =>
      submitDccAttendance(params.id, sent, idempotencyKey, amendment),
    onSuccess: async (_saved, sent) => {
      setSavedKey(idempotencyKey);
      setEditing(false);
      setAmending(false);
      setAmendReason('');
      setCorrectionReason('');
      // A note says what was changed under a mark before this save; after it, nothing does.
      setChangedUnder({});
      setOpenedWith(null);
      const savedAt = Date.now();
      await queryClient.invalidateQueries({ queryKey: ['dcc-roster', params.id] });
      // The whole checklist the Record page and the DCC calendar count from.
      await queryClient.invalidateQueries({ queryKey: ['dcc-roster-whole', params.id] });
      await queryClient.invalidateQueries({ queryKey: ['dcc-events'] });
      // The Record page's branch view and a leader's checklist read these records too.
      await queryClient.invalidateQueries({ queryKey: ['dcc-owed'] });
      await queryClient.invalidateQueries({ queryKey: ['dcc-pending-leaders'] });
      await queryClient.invalidateQueries({ queryKey: ['dcc-leader-checklist'] });
      // **The marks just stored stop being edits once the fresh checklist shows them.** Left
      // as edits they would be laid over a later change somebody else makes, and sent again
      // against it. A mark changed while the save was on its way is a new edit and stays.
      // Where the checklist could not be read again, nothing is settled or re-pinned: the old
      // read would pin a line to the version before this save.
      const rosterKey = ['dcc-roster', params.id, leaderId ?? 'own'];
      const read = queryClient.getQueryState(rosterKey);
      if (read?.status !== 'success' || read.dataUpdatedAt < savedAt) {
        return;
      }
      const stored = new Map(sent.map((record) => [record.person_id, record.present]));
      const settled = (personId: string, mark: Mark) =>
        stored.get(personId) === (mark === 'present');
      setEdits((current) =>
        Object.fromEntries(Object.entries(current).filter(([personId, mark]) => !settled(personId, mark))),
      );
      // A line sent is pinned to what is stored now, which a mark changed while the save was
      // on its way is made against; a pin whose line has no edit is not read (`versionFor`).
      const fresh = queryClient.getQueryData<{ data: DccRosterLine[] }>(rosterKey);
      // A mark made while the save was on its way is measured from what is stored now.
      setOpenedWith(storedOf(fresh?.data ?? []));
      const freshPins = new Map((fresh?.data ?? []).map((line) => [line.person_id, pinOf(line)]));
      setStartedFrom((current) => ({
        ...current,
        ...Object.fromEntries(
          sent.flatMap((record) => {
            const pin = freshPins.get(record.person_id);
            return pin === undefined ? [] : [[record.person_id, pin] as const];
          }),
        ),
      }));
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

  // The marks that differ from what is stored, each with the version its line was read at.
  // Nothing is unsaved once the server has accepted this very body, though the fresh
  // checklist may not have arrived yet.
  const unsaved = useMemo(() => {
    if (idempotencyKey === savedKey) {
      return null;
    }
    const kept = lines.flatMap((line) => {
      const edit = edits[line.person_id];

      return edit !== undefined &&
        (line.record === null || (edit === 'present') !== line.record.present)
        ? [[line.person_id, { mark: edit, version: versionFor(line) }] as const]
        : [];
    });

    return kept.length === 0 ? null : Object.fromEntries(kept);
  }, [lines, edits, idempotencyKey, savedKey, versionFor]);

  const draft = useMarkDraft<Record<string, { mark: Mark; version: number | null }>>({
    key:
      me.data && roster.data && recordable
        ? `dcc:${params.id}:${leaderId ?? 'own'}:${me.data.person_id}`
        : null,
    draft: unsaved,
    restore: (stored) => {
      const restored = lines.filter((line) => {
        const entry = stored[line.person_id];

        return (
          entry !== undefined &&
          (entry.mark === 'present' || entry.mark === 'absent') &&
          entry.version === (line.record?.version ?? null) &&
          (line.record === null || (canCorrect && (entry.mark === 'present') !== line.record.present))
        );
      });
      if (restored.length === 0) {
        return false;
      }
      setEdits(
        Object.fromEntries(restored.map((line) => [line.person_id, stored[line.person_id].mark])),
      );
      setStartedFrom(Object.fromEntries(restored.map((line) => [line.person_id, pinOf(line)])));
      setOpenedWith(storedOf(lines));
      if (restored.some((line) => line.record !== null)) {
        setEditing(true);
      }
      return true;
    },
  });

  // Save is pinned to the bottom, so a refused save is said beside it; at the top only
  // where there is no bar to say it in.
  const saveBar = recordable && lines.length > 0;
  const barRef = usePinnedBarPadding<HTMLDivElement>();
  const stale = save.isError ? staleSaveFailure(save.error, 'a mark here') : null;
  const saveFailure = save.isError
    ? (stale ??
      describeLineFailure(save.error, 'records', (index) => {
        const personId = records[index]?.person_id;
        return lines.find((line) => line.person_id === personId)?.full_name ?? null;
      }))
    : null;

  /**
   * **Reload after a refused save** (decision 0394), as on the Cell meeting screen: the
   * checklist is read again and every kept mark is made against what is stored now. On a line
   * somebody else changed while its mark was being changed here, the saved mark shows and a
   * note under the name says what this leader had marked. A mark on a line somebody else has
   * since recorded is a correction, so it is kept only for a reader who may correct, and the
   * screen opens for editing.
   */
  async function reload() {
    const fresh = await roster.refetch();
    // A failed read resolves with the old data, so only a successful one re-pins.
    if (!fresh.isSuccess) {
      return;
    }
    const byPerson = new Map(fresh.data.data.map((line) => [line.person_id, line]));
    const kept: [string, Mark][] = [];
    const changed: Record<string, ChangedLine> = {};
    for (const line of fresh.data.data) {
      const personId = line.person_id;
      const yours = edits[personId];
      const now = line.record?.present ?? null;
      const theirs: Mark | null = now === null ? null : now ? 'present' : 'absent';
      // What the line held when this leader began: the pin where they marked it, and the
      // snapshot taken at the edit's first change where they did not.
      const was =
        yours !== undefined && personId in startedFrom
          ? startedFrom[personId].present
          : openedWith !== null && personId in openedWith
            ? openedWith[personId]
            : now;
      const moved = theirs !== null && now !== was;

      if (yours === undefined) {
        if (moved) {
          changed[personId] = { theirs };
        }
        continue;
      }
      if (theirs === yours) {
        continue;
      }
      if (moved) {
        changed[personId] = { theirs, yours };
        continue;
      }
      if (line.record !== null && !canCorrect) {
        continue;
      }
      kept.push([personId, yours]);
    }
    setEdits(Object.fromEntries(kept));
    setChangedUnder(changed);
    setOpenedWith(storedOf(fresh.data.data));
    setStartedFrom(
      Object.fromEntries(
        kept.flatMap(([personId]) => {
          const line = byPerson.get(personId);
          return line === undefined ? [] : [[personId, pinOf(line)] as const];
        }),
      ),
    );
    if (kept.some(([personId]) => byPerson.get(personId)?.record !== null)) {
      setEditing(true);
    }
    save.reset();
  }

  const reloadButton = stale ? (
    <Button variant="secondary" className="mt-3" onClick={() => void reload()}>
      Reload
    </Button>
  ) : null;

  return (
    <main id="main" className={PAGE_WIDTH.READING} data-form-layout>
      <SectionFrame section="record">
      <p className="mb-4">
        {/* To Record's DCC list, as after a save: the month page is not linked for now. */}
        <TextLink href="/dashboard?list=awaiting&kind=dcc">Back to Update Records</TextLink>
      </p>

      {/* The accent, for the reason the Cell meeting screen gives. */}
      <h1 className="text-accent text-xl font-bold tracking-tight">
        {event ? dayLabel(event.event_date) : 'DCC attendance'}
      </h1>
      {/*
        **Recording for somebody else is said before anything else on the screen**
        (decision 0313), because the screen is otherwise the reader's own.
      */}
      {forLeader ? (
        <div className="border-accent mt-4 max-w-2xl border-2 p-4 text-sm leading-relaxed">
          <p>
            <strong>Recording for {forLeader.full_name}.</strong> These are the people{' '}
            {forLeader.full_name} records. It is saved under your name
            {forLeader.holds_account
              ? `, and ${forLeader.full_name} ${forLeader.account_active ? 'sees it on their own checklist.' : 'will see it once their account is active.'}`
              : '.'}
          </p>
          <p className="mt-2">
            <TextLink href={`/dcc/${params.id}`}>Back to your own checklist</TextLink>
          </p>
        </div>
      ) : null}
      <p className="text-muted mt-2 max-w-2xl text-sm leading-relaxed">
        {forLeader
          ? lines.length === 1
            ? `The 1 person on ${forLeader.full_name}’s checklist.`
            : `The ${lines.length} people on ${forLeader.full_name}’s checklist.`
          : lines.length === 1
            ? 'The 1 person you are responsible for.'
            : `The ${lines.length} people you are responsible for.`}
        {recordable && awaitingCount > 0 ? ` Not recorded · ${awaitingCount} to mark.` : ''}
      </p>

      <div className="mt-8">
        <FailureNotice
          failure={
            roster.isError
              ? describeFailure(roster.error)
              : save.isError && !saveBar
                ? saveFailure
                : null
          }
        />
      </div>

      {roster.isPending ? (
        <p className="text-muted mt-6 text-sm">Loading&hellip;</p>
      ) : roster.data && event ? (
        <>
          {!recordable && mayAmend ? (
            <div className="border-edge mt-6 max-w-2xl border p-4">
              <p className="text-sm font-bold">Week closed</p>
              <p className="text-muted mt-1 text-sm leading-relaxed">
                This week is closed. Only the Admin may amend it, with a reason that is kept in the
                audit log.
              </p>
              <Button
                id="amend-closed-week"
                variant="secondary"
                className="mt-3"
                onClick={() => setAmending(true)}
              >
                Amend Closed Week
              </Button>
            </div>
          ) : !recordable && event.not_recordable_reason ? (
            <p className="border-edge mt-6 max-w-2xl border p-4 text-sm leading-relaxed">
              This Sunday takes no record: {notRecordableLabel(event.not_recordable_reason)}.
              {event.removed && event.removal_reason ? ` ${event.removal_reason}` : ''}
            </p>
          ) : null}
          {amending && recordable ? (
            <div className="border-edge mt-6 max-w-2xl border p-4">
              <p id="amending-heading" tabIndex={-1} className="text-sm font-bold">
                Amending a closed week
              </p>
              <p className="text-muted mt-1 text-sm leading-relaxed">
                Mark anyone whose Sunday was missed or wrong. Your reason is kept in the audit log.
              </p>
              <Button variant="secondary" className="mt-3" onClick={stopEditing}>
                Cancel
              </Button>
            </div>
          ) : null}

          {save.isSuccess ? (
            <p aria-live="polite" className="mt-6 text-sm font-medium">
              Saved.{' '}
              <TextLink inline href="/dashboard?list=awaiting&kind=dcc">Back to Update Records</TextLink>
            </p>
          ) : null}

          {draft.restoredAt && unsaved ? (
            <div className="border-edge mt-6 border p-4">
              <p className="text-sm leading-relaxed">{restoredNote(draft.restoredAt)}</p>
              <Button
                variant="secondary"
                className="mt-3"
                onClick={() => {
                  draft.discard();
                  setEdits({});
                  setStartedFrom({});
                  setChangedUnder({});
                  setOpenedWith(null);
                  setCorrectionReason('');
                  setEditing(false);
                }}
              >
                Discard
              </Button>
            </div>
          ) : null}

          {/* The checklist and what is already recorded, in one frame (owner's choice, 2026-09-22). */}
          <div className={`mt-6 ${FRAME}`}>
          {recordable && recordedCount > 0 && !amending ? (
            <div className="border-line border-b pb-4">
              {editing ? (
                <>
                  <p className="text-sm font-bold">Changing recorded marks</p>
                  <p className="text-muted mt-1 text-sm leading-relaxed">
                    Saving replaces the marks you change.
                  </p>
                  <Button variant="secondary" className="mt-3" onClick={stopEditing}>
                    Cancel
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
                        Edit
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
              {forLeader
                ? `Nobody on ${forLeader.full_name}’s checklist for this Sunday is someone you can record.`
                : 'Nobody is on your checklist for this Sunday. Attendance is recorded by each person’s direct pastoral leader, so this is empty if you disciple nobody.'}
            </p>
          ) : (
            <>
              <p className="mt-4 text-right text-sm">
                {markedCount} of {lines.length} marked
              </p>
              {sectionsOf(
                lines,
                leaderId ?? me.data?.person_id ?? null,
                forLeader?.full_name ?? null,
              ).map((section) => (
                <section key={section.key} aria-labelledby={`section-${section.key}`} className="mt-6">
                  <h2 id={`section-${section.key}`} className="text-base font-bold">
                    {section.title}
                    {section.counted
                      ? ` · ${section.lines.filter((line) => markFor(line) !== undefined).length} of ${section.lines.length} marked`
                      : ''}
                  </h2>
                  {section.note ? <p className="text-muted mt-1 text-sm">{section.note}</p> : null}
                  <ul className="mt-2 grid gap-3 lg:grid-cols-2 lg:gap-x-4">
                    {section.lines.map((line) => (
                      <PersonMark
                        key={line.person_id}
                        line={line}
                        mark={markFor(line)}
                        note={changedUnder[line.person_id]}
                        disabled={!recordable || (line.record !== null && !editing)}
                        onChange={(value) => {
                          setStartedFrom((current) =>
                            line.person_id in edits && line.person_id in current
                              ? current
                              : { ...current, [line.person_id]: pinOf(line) },
                          );
                          setOpenedWith((current) => current ?? storedOf(lines));
                          setChangedUnder((current) =>
                            Object.fromEntries(Object.entries(current).filter(([id]) => id !== line.person_id)),
                          );
                          setEdits((current) => ({ ...current, [line.person_id]: value }));
                        }}
                      />
                    ))}
                  </ul>
                </section>
              ))}

              {/* While amending, the amendment's own reason says why, so the optional one is not asked. */}
              {editing && !amending ? (
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
            The roster pages (section 22). This screen reads one page of 200, the
            API's most, so only a checklist longer than that reaches this line: a
            "show more" that fetched a second page would have to decide what a
            partial submission means, and nothing here needs to.
          */}
          {roster.data.next_cursor !== null ? (
            <p className="text-muted mt-4 max-w-2xl text-sm leading-relaxed">
              More than 200 people are on this checklist. Recording the rest is not yet possible
              from this screen.
            </p>
          ) : null}

          {amending && recordable ? (
            <div className="mt-8">
              <label htmlFor="amend-reason" className="field-label block">
                Why is this closed week being amended? (required)
              </label>
              <textarea
                id="amend-reason"
                value={amendReason}
                onChange={(event) => setAmendReason(event.target.value)}
                rows={2}
                maxLength={500}
                required
                aria-required="true"
                className="border-edge focus-visible:outline-accent mt-2 w-full border px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
              />
            </div>
          ) : null}

          {/* Pinned for the reason the Cell meeting screen gives. */}
          {saveBar ? (
            <div
              ref={barRef}
              className="border-edge bg-surface sticky bottom-[calc(3.5625rem+env(safe-area-inset-bottom))] z-20 -mx-5 mt-8 flex flex-col gap-2 border-t px-5 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between lg:bottom-0"
            >
              {/* A refused save is said beside Save, where the reader is looking. */}
              <div className={saveFailure ? 'sm:basis-full' : 'sr-only'}>
                <FailureNotice failure={saveFailure} />
                {reloadButton}
              </div>
              <p aria-live="polite" className="text-sm">
                {changed && amendReasonMissing
                  ? 'Say why this closed week is being amended to save.'
                  : !changed && unmarkedCount === 0
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
                  onClick={() => save.mutate(records)}
                  disabled={save.isPending || amendReasonMissing}
                >
                  {save.isPending ? 'Saving…' : amending ? 'Save Amendment' : 'Save marks'}
                </Button>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </SectionFrame>
    </main>
  );
}

/** The version a line was read at and the mark it held then, kept when its mark is first changed. */
interface Pin {
  version: number | null;
  present: boolean | null;
}

function pinOf(line: DccRosterLine): Pin {
  return { version: line.record?.version ?? null, present: line.record?.present ?? null };
}

/** Each line's stored mark, null where none is recorded. */
function storedOf(lines: readonly DccRosterLine[]): Record<string, boolean | null> {
  return Object.fromEntries(lines.map((line) => [line.person_id, line.record?.present ?? null]));
}

/** A line somebody else changed: their saved mark, and this leader's own where they made one. */
type ChangedLine = { theirs: Mark; yours?: Mark };

function PersonMark({
  line,
  mark,
  note,
  disabled,
  onChange,
}: {
  line: DccRosterLine;
  mark: Mark | undefined;
  /** Somebody else changed this line while this edit was open (decision 0394). */
  note?: ChangedLine;
  disabled: boolean;
  onChange: (mark: Mark) => void;
}) {
  return (
    <li className="border-line rounded-md border px-4 py-4">
      <RadioGroup
        legend={line.full_name}
        description={
          note
            ? changedUnderNote(note)
            : line.record === null
              ? 'Not recorded yet'
              : `Last recorded ${shortDate(line.record.recorded_at)}`
        }
        name={`person-${line.person_id}`}
        // **The recorded mark is shown whether or not the Sunday takes a record.**
        // Decision 0194 shows marks so a leader is not asked twice; blanking them on a
        // closed Sunday hid exactly what that decision exists to show.
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

interface Section {
  key: string;
  title: string;
  note: string | null;
  /** Only Your 12 carries a count (decision 0312): never a figure beside another leader. */
  counted: boolean;
  lines: DccRosterLine[];
}

/**
 * The checklist in sections (decision 0312): the reader's direct disciples first, then
 * one section per leader without an account whose people fall to the reader (section 9),
 * then the Network roots, who have no leader. Who is on the checklist is unchanged.
 *
 * The roster arrives in first name, surname, Member ID order, so each section keeps it,
 * and the sections of other leaders follow the order of those leaders' own lines.
 */
function sectionsOf(
  lines: readonly DccRosterLine[],
  readerId: string | null,
  /** The leader recorded for, by name, where it is not the reader's own (decision 0313). */
  ownerName: string | null = null,
): Section[] {
  const id = (value: string | null) => value?.toLowerCase() ?? null;
  const whose = ownerName === null ? 'Your' : `${ownerName}’s`;
  const records = ownerName === null ? 'you record them' : `${ownerName} records them`;

  if (readerId === null) {
    return [{ key: 'all', title: `${whose} checklist`, note: null, counted: false, lines: [...lines] }];
  }

  const reader = id(readerId);
  const yours = lines.filter((line) => id(line.responsible_leader_id) === reader);
  const roots = lines.filter((line) => line.responsible_leader_id === null);
  const byLeader = new Map<string, DccRosterLine[]>();
  for (const line of lines) {
    const leader = id(line.responsible_leader_id);
    if (leader !== null && leader !== reader) {
      byLeader.set(leader, [...(byLeader.get(leader) ?? []), line]);
    }
  }

  const position = (leader: string) => {
    const index = lines.findIndex((line) => id(line.person_id) === leader);
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  };

  const others = [...byLeader.entries()]
    .sort(([left], [right]) => position(left) - position(right))
    .map(([leader, people]): Section => {
      const name = lines.find((line) => id(line.person_id) === leader)?.full_name ?? null;

      return {
        key: leader,
        title: name === null ? 'A leader without an account' : `${name}’s people`,
        note:
          name === null
            ? `Their leader had no account on this Sunday, so ${records}.`
            : `${name} had no account on this Sunday, so ${records}.`,
        counted: false,
        lines: people,
      };
    });

  return [
    ...(yours.length > 0
      ? [{ key: 'yours', title: `${whose} 12`, note: null, counted: true, lines: yours }]
      : []),
    ...others,
    ...(roots.length > 0
      ? [
          {
            key: 'roots',
            title: 'Network roots',
            note:
              ownerName === null
                ? 'Nobody is above them, so their records fall to you.'
                : `Nobody is above them, so their records fall to ${ownerName}.`,
            counted: false,
            lines: roots,
          },
        ]
      : []),
  ];
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
