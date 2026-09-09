'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';

import { AppShell, PAGE_WIDTH } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { FailureNotice } from '@/components/ui/failure-notice';
import { RadioGroup } from '@/components/ui/radio-group';
import {
  getMeetingRoster,
  submitMeeting,
  type CellSubmission,
  type RosterMember,
} from '@/lib/cells';
import { describeFailure } from '@/lib/messages';
import { dayLabel } from '@/lib/reporting-month';

/**
 * Recording one Cell meeting (SKILL.md sections 12, 13, 14 and 22; decisions 0127
 * and 0223).
 *
 * **A submission is the whole roster, so this screen makes the leader account for
 * every member.** Section 13 requires a `HELD` submission to name every member
 * exactly once, present or not, and the API refuses one that omits anybody. So Save
 * stays disabled until every member is marked, and the count of what is still
 * unmarked is stated rather than left for the leader to find by scrolling.
 *
 * **An unmarked member is not an absent one.** The roster returns `null` for
 * somebody nobody has recorded, and this screen keeps that as a third state rather
 * than defaulting the control to Absent. Section 13 has a roster declared by its
 * leader, and a screen that pre-selected Absent would manufacture a declaration
 * nobody made — which on a correction would silently overwrite the marks the leader
 * came here to keep.
 *
 * **The marks the roster carries are shown, which is the whole reason they exist.**
 * Decision 0223 gave the roster each member's mark precisely so that a correction
 * resubmits what is stored rather than blanking it: before that, a correction screen
 * had no way to read what it was required to send back.
 *
 * **One version for the meeting, not one per person** (section 14, decision 0164). A
 * Cell submission is one leader's account of one meeting, so the version read is
 * sent once and covers the roster. That is the opposite of the DCC checklist, where
 * a church-wide event means two leaders recording different people must never
 * conflict.
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

function RecordMeeting() {
  const params = useParams<{ id: string; date: string }>();
  const queryClient = useQueryClient();

  const roster = useQuery({
    queryKey: ['meeting-roster', params.id, params.date],
    queryFn: ({ signal }) => getMeetingRoster(params.id, params.date, signal),
  });

  const [edits, setEdits] = useState<Record<string, Mark>>({});
  const [statusChoice, setStatusChoice] = useState<'HELD' | 'NOT_HELD' | null>(null);
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');

  const members = useMemo(() => roster.data?.members ?? [], [roster.data]);
  const recorded = roster.data?.meeting ?? null;
  const correcting = recorded !== null;

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

  const status = statusChoice ?? (recorded?.status === 'NOT_HELD' ? 'NOT_HELD' : 'HELD');
  const unmarked = members.filter((member) => markFor(member) === undefined);

  const submission = useMemo((): CellSubmission | null => {
    if (!roster.data) {
      return null;
    }

    const base: CellSubmission = { status };
    if (recorded !== null) {
      base.submitted_version = recorded.version;
    }

    if (status === 'NOT_HELD') {
      return { ...base, not_held_reason: 'OTHER', not_held_note: note.trim() || undefined };
    }

    if (unmarked.length > 0) {
      return null;
    }

    return {
      ...base,
      attendance: members.map((member) => ({
        person_id: member.person_id,
        present: markFor(member) === 'present',
      })),
      correction_reason: correcting && reason.trim() ? reason.trim() : undefined,
    };
  }, [roster.data, status, markFor, note, reason, members, unmarked.length, recorded, correcting]);

  // Derived from the body rather than generated per attempt (decision 0127): the
  // same submission retried carries the same key and replays, and a changed mark
  // is a different submission and gets a different one.
  const idempotencyKey = useMemo(
    () => (submission === null ? null : keyFor(params.id, params.date, submission)),
    [submission, params.id, params.date],
  );

  const save = useMutation({
    mutationFn: () => {
      if (submission === null || idempotencyKey === null) {
        throw new Error('Nothing to submit.');
      }
      return submitMeeting(params.id, params.date, submission, idempotencyKey);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['meeting-roster', params.id, params.date] });
      await queryClient.invalidateQueries({ queryKey: ['cell-meetings', params.id] });
    },
  });

  return (
    <main id="main" className={PAGE_WIDTH.READING}>
      <p className="mb-4">
        <Link
          href={`/cells/${params.id}/meetings`}
          className="focus-visible:outline-accent text-muted inline-flex min-h-6 items-center rounded-sm text-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          Back to this Cell&rsquo;s meetings
        </Link>
      </p>

      <h1 className="text-2xl font-semibold tracking-tight">{dayLabel(params.date)}</h1>
      <p className="text-muted mt-2 max-w-2xl text-sm leading-relaxed">
        {correcting
          ? 'This meeting has already been recorded. A correction replaces the whole roster, so every member is sent again — the marks below are what is stored now.'
          : 'Record what happened. A meeting that was held needs every member marked, present or not.'}
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
      ) : roster.data ? (
        <>
          {save.isSuccess ? (
            // Polite, because it is the result of the reader's own action.
            <p aria-live="polite" className="mt-6 text-sm font-medium">
              Saved.
            </p>
          ) : null}

          <div className="mt-8">
            <RadioGroup
              legend="Did the meeting take place?"
              name="status"
              value={status}
              onChange={setStatusChoice}
              options={[
                { value: 'HELD', label: 'Yes, it was held' },
                { value: 'NOT_HELD', label: 'No, it was not held' },
              ]}
            />
          </div>

          {status === 'NOT_HELD' ? (
            <div className="mt-6">
              <label htmlFor="not-held-note" className="block text-sm font-medium">
                What happened? (optional)
              </label>
              <p className="text-muted mt-1 max-w-2xl text-sm leading-relaxed">
                Reporting honestly that the Cell could not meet is a record like any other.
                It counts as recorded and is not a mark against anybody.
              </p>
              <textarea
                id="not-held-note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={3}
                maxLength={500}
                className="border-line focus-visible:outline-accent mt-2 w-full rounded-md border px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
              />
            </div>
          ) : (
            <section className="mt-8" aria-labelledby="roster-heading">
              <h2 id="roster-heading" className="text-lg font-medium">
                Who was there
              </h2>
              <p className="text-muted mt-1 max-w-2xl text-sm leading-relaxed">
                Every member is listed and every one needs a mark. Nobody is assumed absent.
              </p>

              {members.length === 0 ? (
                <p className="text-muted mt-4 text-sm">
                  This Cell had no members on the meeting date, so there is nobody to mark.
                </p>
              ) : (
                <ul className="mt-4 flex flex-col gap-4">
                  {members.map((member) => (
                    <MemberMark
                      key={member.person_id}
                      member={member}
                      mark={markFor(member)}
                      onChange={(value) =>
                        setEdits((current) => ({ ...current, [member.person_id]: value }))
                      }
                    />
                  ))}
                </ul>
              )}

              {/*
                Stated rather than left to be discovered by a disabled button. The
                count is the actionable part: "three still to mark" tells a leader
                what to do, where a greyed control tells them only that something
                is wrong.
              */}
              {unmarked.length > 0 ? (
                <p aria-live="polite" className="mt-4 text-sm">
                  {unmarked.length === 1
                    ? '1 member still to mark.'
                    : `${unmarked.length} members still to mark.`}
                </p>
              ) : null}

              {correcting ? (
                <div className="mt-6">
                  <label htmlFor="correction-reason" className="block text-sm font-medium">
                    Why is this changing? (optional)
                  </label>
                  <textarea
                    id="correction-reason"
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    rows={2}
                    maxLength={500}
                    className="border-line focus-visible:outline-accent mt-2 w-full rounded-md border px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
                  />
                </div>
              ) : null}
            </section>
          )}

          <div className="mt-8">
            <Button
              type="button"
              onClick={() => save.mutate()}
              disabled={submission === null || save.isPending}
            >
              {save.isPending ? 'Saving…' : correcting ? 'Save the correction' : 'Save'}
            </Button>
          </div>
        </>
      ) : null}
    </main>
  );
}

function MemberMark({
  member,
  mark,
  onChange,
}: {
  member: RosterMember;
  mark: Mark | undefined;
  onChange: (mark: Mark) => void;
}) {
  return (
    <li className="border-line rounded-lg border p-4">
      <RadioGroup
        legend={`${member.first_name} ${member.last_name}`}
        description={mark === undefined ? 'Not recorded yet' : undefined}
        name={`member-${member.person_id}`}
        value={mark ?? ''}
        onChange={onChange}
        options={[
          { value: 'present', label: 'Present' },
          { value: 'absent', label: 'Absent' },
        ]}
      />
    </li>
  );
}

/**
 * A key that is a function of the request, so a retry replays and a change writes.
 *
 * Section 22 requires a v4 UUID, so this hashes the body into one rather than
 * sending a digest: the shape is fixed at the boundary and a client that invented
 * its own format would be refused. The randomness a v4 normally carries is
 * deliberately replaced by the body's own content — which is the point, since two
 * attempts at the same submission must agree and a `crypto.randomUUID()` per press
 * would not.
 */
function keyFor(cellId: string, meetingId: string, submission: CellSubmission): string {
  const canonical = JSON.stringify([cellId, meetingId, submission]);

  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let index = 0; index < canonical.length; index += 1) {
    const code = canonical.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + code, 0x85ebca6b) >>> 0;
  }

  const hex = (value: number) => value.toString(16).padStart(8, '0');
  const a = hex(h1);
  const b = hex(h2);
  const c = hex(Math.imul(h1 ^ h2, 0xc2b2ae35) >>> 0);
  const d = hex(Math.imul(h1 + h2, 0x27d4eb2f) >>> 0);

  // Version 4 and the RFC variant, so the value satisfies the boundary's own
  // `@IsUUID()` rather than merely looking like a UUID.
  return `${a}-${b.slice(0, 4)}-4${b.slice(5, 8)}-a${c.slice(1, 4)}-${c.slice(4)}${d}`;
}
