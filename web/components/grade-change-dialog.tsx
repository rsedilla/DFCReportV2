'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Info } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogActions } from '@/components/ui/dialog';
import { FailureNotice } from '@/components/ui/failure-notice';
import { Field } from '@/components/ui/field';
import { RadioGroup } from '@/components/ui/radio-group';
import { SelectField } from '@/components/ui/select-field';
import {
  changeGrade,
  previewGradeChange,
  type ClassGrades,
  type EncounterChange,
  type EnrollmentEffect,
  type FinalGrade,
  type GradeChangeSign,
  type GradeChangeTo,
  type GradeChangeWhy,
} from '@/lib/equipping';
import { idempotencyKeyFor, useWriteKey } from '@/lib/idempotency';
import { describeFailure } from '@/lib/messages';

/** The details' length, counted as the server counts it. */
const DETAILS_MAX = 500;

export const GRADE_WORDS: Record<FinalGrade, string> = {
  PASSED: '✓ Passed',
  NOT_PASSED: '✗ Not passed',
  NOT_YET: '… Not yet',
};

export const WHY_WORDS: Record<GradeChangeWhy, string> = {
  MADE_UP_AFTER_POSTING: 'Made up after posting',
  RECORDED_WRONGLY: 'Recorded wrongly',
};

/** A lesson's sign in words: *✗ Absent, not made up*, *M made up 24 Mar*. */
export function signWords(sign: GradeChangeSign, madeUpOn: string | null): string {
  switch (sign) {
    case 'CAME':
      return '✓ Came';
    case 'ABSENT':
      return '✗ Absent, not made up';
    case 'MADE_UP':
      return `M made up ${madeUpOn === null ? '' : dayLabel(madeUpOn)}`.trim();
    case 'BEFORE_JOINING':
      return '○ Before they joined, not made up';
  }
}

/** The Encounter before and now, in words: *✓ Came*, *✗ Did not attend* (decision 0513). */
export function encounterWords(change: EncounterChange): { before: string; now: string } {
  return {
    before: change.before === 'CAME' ? '✓ Came' : 'not attended',
    now:
      change.now === 'CAME'
        ? '✓ Came'
        : change.now === 'MISSED'
          ? '✗ Did not attend'
          : change.now === 'ENROLLED'
            ? 'enrolled, not recorded yet'
            : 'not attended',
  };
}

/** What a change does to the enrollment, in a sentence (decision 0513, point 10). */
export function enrollmentWords(effect: EnrollmentEffect): string {
  return effect === 'REOPENS'
    ? 'Their Life Class enrollment is opened again, and they are listed for the next Encounter.'
    : 'Their Life Class enrollment ends, and they leave the next Encounter’s list.';
}

/** *Tue 2 Mar*, for a date-only value. */
export function dayLabel(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

/** Today in Manila, as a date-only value (section 13's reporting time zone). */
function manilaToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());
}

type Student = ClassGrades['students'][number];

/**
 * **Change one lesson of a posted grade** (SKILL.md section 29, decision 0513), the Admin's alone.
 *
 * In two steps, as the owner chose from screenshots: the lesson, what it becomes, why and the
 * details, with what the grade becomes shown before anything is saved; then a summary to confirm,
 * saying it cannot be undone, only changed again. DREAMS works the grade out; nobody types it
 * (decision 0501, point 15).
 */
export function GradeChangeDialog({
  open,
  onClose,
  student,
  className,
}: {
  open: boolean;
  onClose: () => void;
  student: Student;
  className: string;
}) {
  const queryClient = useQueryClient();
  const lessons = student.changeable?.lessons ?? [];
  const [lesson, setLesson] = useState<number | null>(null);
  const [to, setTo] = useState<GradeChangeTo | ''>('');
  const [madeUpOn, setMadeUpOn] = useState('');
  const [why, setWhy] = useState<GradeChangeWhy | ''>('');
  const [details, setDetails] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const today = manilaToday();

  const chosen = lessons.find((each) => each.lesson === lesson) ?? null;
  const input =
    chosen !== null && to !== '' && (to !== 'MADE_UP' || madeUpOn !== '')
      ? { lesson: chosen.lesson, to, ...(to === 'MADE_UP' ? { made_up_on: madeUpOn } : {}) }
      : null;
  const preview = useQuery({
    queryKey: ['equipping', 'grade-change-preview', student.final_grade_id, input],
    queryFn: ({ signal }) => previewGradeChange(student.final_grade_id!, input!, signal),
    enabled: open && input !== null,
    retry: false,
  });

  const [writeKey, renewWriteKey] = useWriteKey();
  const save = useMutation({
    mutationFn: () =>
      changeGrade(
        student.final_grade_id!,
        {
          ...input!,
          why: why as GradeChangeWhy,
          details: details.trim(),
          changes_seen: student.changes_seen ?? 0,
        },
        idempotencyKeyFor(
          'equipping-grade-change',
          writeKey,
          student.final_grade_id!,
          String(input?.lesson),
          to,
          madeUpOn,
          why,
          details.trim(),
        ),
      ),
    onSuccess: async () => {
      renewWriteKey();
      await queryClient.invalidateQueries({ queryKey: ['equipping'] });
      close();
    },
  });

  function close() {
    save.reset();
    setLesson(null);
    setTo('');
    setMadeUpOn('');
    setWhy('');
    setDetails('');
    setReviewing(false);
    onClose();
  }

  function edit<T>(set: (value: T) => void) {
    return (value: T) => {
      save.reset();
      set(value);
    };
  }

  const ready = preview.isSuccess && why !== '' && details.trim() !== '' && !save.isPending;
  // A lesson kept from an earlier term keeps the join at Lesson 6 it gave (point 12), so it is
  // never made Absent.
  const toOptions: { value: GradeChangeTo; label: string }[] =
    chosen?.sign === 'BEFORE_JOINING'
      ? [{ value: 'MADE_UP', label: 'Made up' }]
      : chosen?.kept
        ? [
            { value: 'CAME', label: 'Came' },
            { value: 'MADE_UP', label: 'Made up' },
          ]
        : [
          { value: 'CAME', label: 'Came' },
          { value: 'ABSENT', label: 'Absent' },
          { value: 'MADE_UP', label: 'Made up' },
        ];
  const name = student.person.full_name ?? 'this student';

  if (reviewing && preview.data) {
    const p = preview.data;
    return (
      <Dialog open={open} onClose={close} title="Save this change?">
        <div className="border-line rounded-lg border px-3 py-3 text-sm">
          <p>
            <span className="font-semibold">{name}</span> · {className}
          </p>
          <p className="mt-2">
            L{p.lesson}: {signWords(p.sign_before!, p.made_up_on_before ?? null)} →{' '}
            <span className="font-semibold">
              {signWords(input!.to, input!.to === 'MADE_UP' ? madeUpOn : null)}
            </span>
          </p>
          {p.encounter_change ? (
            <p>
              Encounter, changed after posting: {encounterWords(p.encounter_change).before} →{' '}
              {encounterWords(p.encounter_change).now}
            </p>
          ) : null}
          <p>
            Grade: {GRADE_WORDS[p.grade_before]} → <span className="font-semibold">{GRADE_WORDS[p.grade_after]}</span>
          </p>
          {p.enrollment ? <p className="mt-2">{enrollmentWords(p.enrollment)}</p> : null}
          <p className="text-muted mt-2">
            {WHY_WORDS[why as GradeChangeWhy]} · {details.trim()}
          </p>
        </div>
        <p className="text-muted mt-3 text-sm">
          It cannot be undone, only changed again with another reason. Both stay in the grade’s history.
        </p>
        <FailureNotice failure={save.isError ? describeFailure(save.error) : null} />
        <DialogActions className="lg:justify-end">
          <Button variant="secondary" onClick={() => setReviewing(false)}>
            Back
          </Button>
          <Button type="button" disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Saving…' : 'Save change'}
          </Button>
        </DialogActions>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onClose={close} title={`Change ${name}’s lessons`}>
      <form
        className="flex flex-col gap-5"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (ready) {
            setReviewing(true);
          }
        }}
      >
        <p className="text-muted text-sm">
          {className}. The posted grade is kept; DREAMS works out a new one from what you change.
        </p>

        {lessons.length === 0 ? (
          <p className="text-sm">{student.changeable?.why ?? 'No lesson of theirs can be changed here.'}</p>
        ) : (
          <>
            <SelectField
              label="Lesson"
              value={lesson === null ? '' : String(lesson)}
              onChange={(event) => {
                save.reset();
                setLesson(event.target.value === '' ? null : Number(event.target.value));
                setTo('');
                setMadeUpOn('');
              }}
            >
              <option value="">Choose a lesson</option>
              {lessons.map((each) => (
                <option key={each.lesson} value={each.lesson}>
                  L{each.lesson} · {dayLabel(each.held_on)}
                  {each.recorded_in ? ` · in ${each.recorded_in}` : ''} · now{' '}
                  {signWords(each.sign, each.made_up_on)}
                </option>
              ))}
            </SelectField>

            {chosen !== null ? (
              <RadioGroup
                legend="Change it to"
                name="change-to"
                layout="row"
                value={to}
                onChange={edit(setTo)}
                options={toOptions}
              />
            ) : null}

            {to === 'MADE_UP' && chosen !== null ? (
              <Field
                label="Made up on"
                type="date"
                autoComplete="off"
                min={chosen.held_on}
                max={today}
                value={madeUpOn}
                onChange={(event) => {
                  save.reset();
                  setMadeUpOn(event.target.value);
                }}
              />
            ) : null}

            <RadioGroup
              legend="Why"
              name="change-why"
              layout="row"
              value={why}
              onChange={edit(setWhy)}
              options={[
                { value: 'MADE_UP_AFTER_POSTING', label: WHY_WORDS.MADE_UP_AFTER_POSTING },
                { value: 'RECORDED_WRONGLY', label: WHY_WORDS.RECORDED_WRONGLY },
              ]}
            />

            <div>
              <label htmlFor="grade-change-details" className="field-label block">
                Details (required)
              </label>
              <textarea
                id="grade-change-details"
                value={details}
                onChange={(event) => {
                  save.reset();
                  setDetails(event.target.value);
                }}
                rows={3}
                maxLength={DETAILS_MAX}
                className="border-edge focus-visible:outline-accent mt-2 w-full border px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
              />
            </div>

            <div aria-live="polite">
              {preview.data?.encounter_change ? (
                // Before the grade, as its cause: an Encounter recorded or corrected since posting is
                // worked from as it stands (point 14), and never folded into the change unseen.
                <p className="border-line text-ink mb-3 flex items-start gap-2 rounded-lg border px-3 py-3 text-sm leading-relaxed">
                  <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                  <span>
                    <span className="font-semibold">Their Encounter changed after posting.</span> It read{' '}
                    {encounterWords(preview.data.encounter_change).before}; it now reads{' '}
                    {encounterWords(preview.data.encounter_change).now}. The new grade uses what it reads now.
                  </span>
                </p>
              ) : null}
              {preview.data ? (
                <div className="border-line bg-raised rounded-lg border px-3 py-3 text-sm">
                  <p className="font-semibold">
                    Grade becomes {GRADE_WORDS[preview.data.grade_after]}
                    <span className="text-muted font-normal"> · now {GRADE_WORDS[preview.data.grade_before]}</span>
                  </p>
                  <p className="text-muted mt-1">
                    {preview.data.reason_after}
                    {preview.data.training === 'FILES'
                      ? ' Life Class goes into their Training from the school, unless they already have it.'
                      : preview.data.training === 'WITHDRAWS'
                        ? ' The Life Class the school filed for them is withdrawn from their Training.'
                        : ''}
                    {preview.data.enrollment ? (
                      <span className="block">{enrollmentWords(preview.data.enrollment)}</span>
                    ) : null}
                  </p>
                </div>
              ) : null}
              <FailureNotice failure={preview.isError ? describeFailure(preview.error) : null} />
            </div>
          </>
        )}

        <DialogActions className="lg:justify-end">
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          {lessons.length > 0 ? (
            <Button type="submit" disabled={!ready}>
              Review change
            </Button>
          ) : null}
        </DialogActions>
      </form>
    </Dialog>
  );
}
