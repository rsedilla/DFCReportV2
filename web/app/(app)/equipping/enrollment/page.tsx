'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';

import { EquippingFrame, TermPicker, TextBox, Tick } from '@/components/equipping-frame';
import { Button } from '@/components/ui/button';
import { Dialog, DialogActions } from '@/components/ui/dialog';
import { FailureNotice } from '@/components/ui/failure-notice';
import { CONTROL_BAR, FRAME } from '@/components/ui/frame';
import { SelectField } from '@/components/ui/select-field';
import { timeLabel } from '@/lib/cells';
import { HeaderCell, Table, rowClasses } from '@/components/ui/table';
import {
  DAY_NAMES,
  currentTerm,
  enroll,
  getClass,
  listClasses,
  moveEnrollment,
  termLabel,
  withdrawEnrollment,
  type ClassDetail,
  type EquippingClass,
  type Term,
} from '@/lib/equipping';
import { getMe, holdsWholeChurch } from '@/lib/me';
import { describeFailure } from '@/lib/messages';
import { idempotencyKeyFor, useWriteKey } from '@/lib/idempotency';
import { cn } from '@/lib/utils';

/**
 * Enrollment (SKILL.md section 29, decision 0499, points 10 and 11): the term's classes, and
 * putting registered people into one.
 *
 * **Two checks are never overridden**: a birthday recorded, and 14 on the first day of the
 * person's own Network's Encounter weekend. Somebody failing either has no tick box, and the
 * row says why. Several are enrolled at once; a move keeps them in the term, and a
 * withdrawal is kept with its reason.
 */
export default function EnrollmentPage() {
  const [term, setTerm] = useState<Term>(() => currentTerm());
  const [chosen, setChosen] = useState<string | null>(null);
  // Opening a class is the Coordinator's, under Classes (decision 0501); here people are enrolled.
  const me = useQuery({ queryKey: ['me'], queryFn: ({ signal }) => getMe(signal) });
  const opens = holdsWholeChurch(me.data, 'equipping.coordinate');

  const classes = useQuery({
    queryKey: ['equipping', 'classes', term],
    queryFn: ({ signal }) => listClasses(term, signal),
  });
  // A class chosen in another term is not one of this term's, so the first is shown instead.
  const classId =
    (chosen !== null && classes.data?.data.some((each) => each.id === chosen) ? chosen : null) ??
    classes.data?.data[0]?.id ??
    null;

  return (
    <EquippingFrame current="/equipping/enrollment" title="Enrollment" lead="Put registered people into a class.">
      <div className={CONTROL_BAR}>
        <TermPicker term={term} onChange={setTerm} />
        <div className="flex flex-wrap gap-2" role="group" aria-label="Classes">
          {(classes.data?.data ?? []).map((each) => (
            <Button
              key={each.id}
              type="button"
              variant={each.id === classId ? 'primary' : 'secondary'}
              aria-pressed={each.id === classId}
              className="py-1.5"
              onClick={() => setChosen(each.id)}
            >
              {/* Two lines (owner, 2026-11-18): the name, then when it meets and how many are in
                  it, the count saying what it counts. */}
              <span className="flex flex-col items-start leading-tight">
                <span>{each.name}</span>
                <span className="text-xs font-normal">
                  {DAY_NAMES[each.day_of_week - 1].slice(0, 3)} {timeLabel(each.time_of_day)} · {each.enrolled}{' '}
                  enrolled
                </span>
              </span>
            </Button>
          ))}
        </div>
      </div>
      <FailureNotice failure={classes.isError ? describeFailure(classes.error) : null} />
      {classes.data && classes.data.data.length === 0 ? (
        <p className="text-muted mt-4 text-sm">No Life Class is open in {termLabel(term)} yet.{' '}
          {opens ? 'Open one under Classes.' : 'The Life Class Coordinator opens it.'}</p>
      ) : null}
      {classId ? <ClassView key={classId} classId={classId} classes={classes.data?.data ?? []} /> : null}
    </EquippingFrame>
  );
}

function ClassView({
  classId,
  classes,
}: {
  classId: string;
  classes: EquippingClass[];
}) {
  const queryClient = useQueryClient();
  const detail = useQuery({
    queryKey: ['equipping', 'class', classId],
    queryFn: ({ signal }) => getClass(classId, signal),
  });
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [writeKey, renewWriteKey] = useWriteKey();
  const [moving, setMoving] = useState<ClassDetail['enrolled'][number] | null>(null);
  const [withdrawing, setWithdrawing] = useState<ClassDetail['enrolled'][number] | null>(null);
  // Who the last Enroll placed, said back once it has saved (owner, 2026-11-18).
  const [justEnrolled, setJustEnrolled] = useState<string[]>([]);

  const save = useMutation({
    mutationFn: (names: string[]) => {
      const ids = [...ticked].sort();
      return enroll(classId, ids, idempotencyKeyFor('equipping-enroll', writeKey, classId, ids)).then(() => names);
    },
    onSuccess: async (names) => {
      setJustEnrolled(names);
      setTicked(new Set());
      renewWriteKey();
      await queryClient.invalidateQueries({ queryKey: ['equipping'] });
    },
  });

  if (detail.isError) {
    return <FailureNotice failure={describeFailure(detail.error)} />;
  }
  if (!detail.data) {
    return <p className="text-muted mt-4 text-sm">Loading&hellip;</p>;
  }
  const cls = detail.data.class;
  const enrollable = detail.data.ready.filter((row) => row.blocked === null);
  const waiting = detail.data.ready.filter((row) => row.blocked !== null);
  const tick = (registrationId: string, checked: boolean) => {
    setJustEnrolled([]);
    const next = new Set(ticked);
    if (checked) {
      next.add(registrationId);
    } else {
      next.delete(registrationId);
    }
    setTicked(next);
  };

  return (
    <>
      <div className={cn(FRAME, 'mt-4')}>
        <h2 className="text-lg font-semibold">{cls.name}</h2>
        <p className="text-muted mt-1 text-sm">
          {DAY_NAMES[cls.day_of_week - 1]}s, {timeLabel(cls.time_of_day)}
          {cls.place ? ` · ${cls.place}` : ''} · Teacher: {cls.teacher?.full_name ?? 'not named yet'} · Starts {cls.first_lesson_on}
          {' · '}Encounter weekend: men {cls.encounter_weekends.mens}, women {cls.encounter_weekends.womens}
        </p>
        <p className="text-muted mt-1 text-sm">Run by: the church (Equipping)</p>
      </div>

      <h2 className="mt-6 text-lg font-semibold">
        Ready to enroll <span className="text-muted text-sm font-normal">· registered for Life Class, in no class yet</span>
      </h2>
      {justEnrolled.length > 0 ? (
        <p role="status" className="border-accent text-ink bg-surface mt-2 rounded-xl border px-4 py-3 text-sm font-semibold">
          Enrolled in {cls.name}: {justEnrolled.join(', ')}.
        </p>
      ) : null}
      {detail.data.ready.length === 0 ? (
        <p className="text-muted mt-2 text-sm">Nobody registered is waiting for a class.</p>
      ) : (
        <>
          {/* Those who can be enrolled first, with the Enroll button under them, and those
              who cannot after, in a group of their own (owner, 2026-11-18). */}
          {enrollable.length > 0 ? (
            <>
              {enrollable.length > 1 ? (
                <Button
                  type="button"
                  variant="quiet"
                  className="mt-1"
                  onClick={() => {
                    setJustEnrolled([]);
                    setTicked(new Set(enrollable.map((row) => row.registration_id)));
                  }}
                >
                  Tick all who can be enrolled ({enrollable.length})
                </Button>
              ) : null}
              <ReadyRows rows={enrollable} caption={`Ready to enroll in ${cls.name}`} ticked={ticked} onTick={tick} />
              <FailureNotice failure={save.isError ? describeFailure(save.error) : null} />
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  disabled={ticked.size === 0 || save.isPending}
                  onClick={() =>
                    save.mutate(
                      enrollable.filter((row) => ticked.has(row.registration_id)).map((row) => row.person.full_name ?? 'someone'),
                    )
                  }
                >
                  Enroll {ticked.size} in {cls.name}
                </Button>
                <p className="text-muted text-sm">
                  {ticked.size} of the {enrollable.length} who can be enrolled {ticked.size === 1 ? 'is' : 'are'}{' '}
                  ticked
                </p>
              </div>
            </>
          ) : (
            <p className="text-muted mt-2 text-sm">Nobody waiting can be enrolled yet.</p>
          )}
          {waiting.length > 0 ? (
            <>
              <h3 className="mt-6 font-semibold">
                Can&rsquo;t enroll yet{' '}
                <span className="text-muted text-sm font-normal">· {waiting.length}</span>
              </h3>
              <ReadyRows rows={waiting} caption={`Can't enroll in ${cls.name} yet`} ticked={ticked} onTick={tick} />
            </>
          ) : null}
        </>
      )}

      <h2 className="mt-8 text-lg font-semibold">
        In this class <span className="text-muted text-sm font-normal">· {detail.data.enrolled.length} enrolled</span>
      </h2>
      {detail.data.enrolled.length === 0 ? (
        <p className="text-muted mt-2 text-sm">Nobody yet.</p>
      ) : (
        // Move and Withdraw are outlined buttons, under the name on a phone so every row
        // reads alike, and beside it from `sm` (owner, 2026-11-18).
        <ul className="border-line divide-line bg-surface mt-2 divide-y rounded-xl border">
          {detail.data.enrolled.map((row) => (
            <li
              key={row.enrollment_id}
              className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
            >
              <span>{row.person.full_name}</span>
              <span className="flex gap-2">
                {classes.length > 1 ? (
                  <Button type="button" variant="secondary" className="w-auto sm:min-w-28" onClick={() => setMoving(row)}>
                    Move<span className="sr-only"> {row.person.full_name}</span>
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="secondary"
                  className="w-auto sm:min-w-28"
                  onClick={() => setWithdrawing(row)}
                >
                  Withdraw<span className="sr-only"> {row.person.full_name}</span>
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <MoveDialog
        enrolled={moving}
        classes={classes.filter((each) => each.id !== classId)}
        onClose={() => setMoving(null)}
      />
      <WithdrawDialog enrolled={withdrawing} onClose={() => setWithdrawing(null)} />
    </>
  );
}

function MoveDialog({
  enrolled,
  classes,
  onClose,
}: {
  enrolled: ClassDetail['enrolled'][number] | null;
  classes: EquippingClass[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const descriptionId = useId();
  const [to, setTo] = useState('');
  const [writeKey, renewWriteKey] = useWriteKey();
  const move = useMutation({
    mutationFn: () =>
      moveEnrollment(
        enrolled!.enrollment_id,
        to,
        idempotencyKeyFor('equipping-move', writeKey, enrolled!.enrollment_id, to),
      ),
    onSuccess: async () => {
      renewWriteKey();
      setTo('');
      await queryClient.invalidateQueries({ queryKey: ['equipping'] });
      onClose();
    },
  });
  return (
    <Dialog
      open={enrolled !== null}
      onClose={onClose}
      title={`Move ${enrolled?.person.full_name ?? ''}`}
      describedBy={descriptionId}
    >
      {/* What a move does, said before it is made (owner, 2026-11-18). */}
      <p id={descriptionId} className="text-muted mb-4 text-sm">
        They keep their registration and anything recorded so far. The birthday and age checks are made again for
        the new class.
      </p>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (to !== '') {
            move.mutate();
          }
        }}
      >
        <SelectField label="To class" value={to} onChange={(event) => setTo(event.target.value)} required>
          <option value="">Choose a class</option>
          {classes.map((each) => (
            <option key={each.id} value={each.id}>
              {each.name} · {DAY_NAMES[each.day_of_week - 1].slice(0, 3)} {timeLabel(each.time_of_day)} · {each.enrolled}{' '}
              enrolled
            </option>
          ))}
        </SelectField>
        <FailureNotice failure={move.isError ? describeFailure(move.error) : null} />
        <DialogActions>
          <Button type="submit" disabled={move.isPending}>
            Move
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

function WithdrawDialog({
  enrolled,
  onClose,
}: {
  enrolled: ClassDetail['enrolled'][number] | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const descriptionId = useId();
  const [reason, setReason] = useState('');
  const [writeKey, renewWriteKey] = useWriteKey();
  const withdraw = useMutation({
    mutationFn: () =>
      withdrawEnrollment(
        enrolled!.enrollment_id,
        reason.trim(),
        idempotencyKeyFor('equipping-withdraw', writeKey, enrolled!.enrollment_id, reason.trim()),
      ),
    onSuccess: async () => {
      renewWriteKey();
      setReason('');
      await queryClient.invalidateQueries({ queryKey: ['equipping'] });
      onClose();
    },
  });
  return (
    <Dialog
      open={enrolled !== null}
      onClose={onClose}
      title={`Withdraw ${enrolled?.person.full_name ?? ''}`}
      describedBy={descriptionId}
    >
      {/* What a withdrawal does, said before it is made (owner, 2026-11-18). */}
      <p id={descriptionId} className="text-muted mb-4 text-sm">
        They go back to Ready to enroll. The withdrawal is kept with your reason and cannot be undone. To take them
        off Life Class this term, cancel their registration on Registration.
      </p>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (reason.trim() !== '') {
            withdraw.mutate();
          }
        }}
      >
        <TextBox
          label="Why"
          value={reason}
          onChange={setReason}
          required
          placeholder="For example: moved to another city"
        />
        <FailureNotice failure={withdraw.isError ? describeFailure(withdraw.error) : null} />
        <DialogActions>
          <Button type="submit" disabled={withdraw.isPending}>
            Withdraw {enrolled?.person.full_name ?? ''}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose} data-autofocus>
            Keep them
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

type ReadyRow = ClassDetail['ready'][number];

function blockedText(blocked: string): string {
  const age = /^(\d+) on (\S+), under (\d+) for the Encounter$/.exec(blocked);
  if (age) {
    return `${age[1]} on ${age[2]}, the Encounter weekend. Must be ${age[3]}.`;
  }
  return `${blocked.charAt(0).toUpperCase()}${blocked.slice(1)}.`;
}

/**
 * The people waiting for a class: a table on a wider screen and a card each on a phone
 * (owner, 2026-11-18). The name is the tick box's label; somebody who cannot be enrolled has
 * no box, and the reason sits under their name.
 */
function ReadyRows({
  rows,
  caption,
  ticked,
  onTick,
}: {
  rows: ReadyRow[];
  caption: string;
  ticked: ReadonlySet<string>;
  onTick: (registrationId: string, checked: boolean) => void;
}) {
  return (
    <>
      <Table caption={caption} className="mt-2 hidden sm:block" tableClassName="table-fixed">
        <thead>
          <tr>
            <HeaderCell className="w-16">
              <span className="sr-only">Choose</span>
            </HeaderCell>
            <HeaderCell className="w-[28%]">Name</HeaderCell>
            <HeaderCell>Leader</HeaderCell>
            <HeaderCell className="w-44">Age at the Encounter</HeaderCell>
            <HeaderCell>Registration</HeaderCell>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.registration_id} className={rowClasses}>
              <td className="px-3 py-2 align-top">
                {row.blocked === null ? (
                  <Tick
                    checked={ticked.has(row.registration_id)}
                    onChange={(checked) => onTick(row.registration_id, checked)}
                  >
                    <span className="sr-only">Enroll {row.person.full_name}</span>
                  </Tick>
                ) : null}
              </td>
              <td className="px-3 py-3 align-top">
                {row.person.full_name}
                {row.blocked ? (
                  <span className="text-field-invalid block text-sm">{blockedText(row.blocked)}</span>
                ) : null}
              </td>
              <td className="px-3 py-3 align-top">{row.leader_name ?? 'No leader yet'}</td>
              <td className="px-3 py-3 align-top">{row.age_at_encounter ?? '—'}</td>
              <td className="px-3 py-3 align-top">{row.with_exception ? 'Registered with exception' : 'Registered'}</td>
            </tr>
          ))}
        </tbody>
      </Table>
      <ul aria-label={caption} className="border-line divide-line bg-surface mt-2 divide-y rounded-xl border sm:hidden">
        {rows.map((row) => (
          <li key={row.registration_id} className="px-3 py-2">
            {row.blocked === null ? (
              <Tick checked={ticked.has(row.registration_id)} onChange={(checked) => onTick(row.registration_id, checked)}>
                {row.person.full_name}
              </Tick>
            ) : (
              <>
                <p className="pt-2 text-sm font-semibold">{row.person.full_name}</p>
                <p className="text-field-invalid text-sm">{blockedText(row.blocked)}</p>
              </>
            )}
            <p className="text-muted pb-1 text-sm">
              {row.leader_name ?? 'No leader yet'}
              {row.age_at_encounter !== null ? ` · ${row.age_at_encounter} at the Encounter` : ''}
              {' · '}
              {row.with_exception ? 'Registered with exception' : 'Registered'}
            </p>
          </li>
        ))}
      </ul>
    </>
  );
}
