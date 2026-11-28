'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { GRADE_WORDS, dayLabel, signWords } from '@/components/grade-change-dialog';
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
  type GradeChange,
  type GradeChangeInput,
  type GradeChangeItem,
  type GradeChangeTo,
} from '@/lib/equipping';
import { idempotencyKeyFor, useWriteKey } from '@/lib/idempotency';
import { describeFailure } from '@/lib/messages';

/** The details' length, counted as the server counts it. */
const DETAILS_MAX = 500;

const ITEM_WORDS: Record<GradeChangeItem, string> = {
  ATTENDANCE: 'A lesson’s attendance',
  VERSE: 'A lesson’s memory verse',
  DEVOTIONAL: 'A lesson’s devotional',
  QUIZ: 'A quiz score',
  BOOK: 'Book read',
};

const NOUN: Record<'VERSE' | 'DEVOTIONAL', string> = { VERSE: 'memory verse', DEVOTIONAL: 'devotional' };

/** A SOL change in words, for the history under a row (decision 0514, point 12). */
export function solChangeWords(c: GradeChange): string {
  if (c.item === 'QUIZ') {
    return `Quiz try ${c.quiz_try}: ${c.score_before === null || c.score_before === undefined ? 'not recorded' : c.score_before} → ${c.score_after}`;
  }
  if (c.item === 'BOOK') {
    return `Book: ${c.value_before === 'READ' ? 'read' : 'not read'} → ${c.value_after === 'READ' ? 'read' : 'not read'}`;
  }
  const noun = NOUN[c.item as 'VERSE' | 'DEVOTIONAL'];
  const words = (value: string | null | undefined) => (value === 'HANDED_IN' ? 'handed in' : 'not handed in');
  return `L${c.lesson} ${noun}: ${words(c.value_before)} → ${words(c.value_after)}${
    c.brought_on ? ` (${dayLabel(c.brought_on)})` : ''
  }`;
}

/** Today in Manila, as a date-only value (section 13's reporting time zone). */
function manilaDay(at: string | null): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(at ? new Date(at) : new Date());
}

type Student = ClassGrades['students'][number];

/**
 * **Change a SOL grade after posting** (SKILL.md section 29, decision 0514, point 12; owner rulings
 * of 2026-11-26), the Admin's alone. Life Class's dialog (decision 0513) with *What to change*
 * first: a lesson's attendance, memory verse or devotional, a quiz score, or *Book read*. A change
 * after posting corrects what was **recorded wrongly**, so it offers that reason alone, and what it
 * says happened, happened on or before the day the class was posted; what was still owed then is a
 * retake. In two steps, as for Life Class: what the grade becomes is shown before anything is
 * saved, then a summary to confirm.
 */
export function SolGradeChangeDialog({
  open,
  onClose,
  student,
  className,
  postedAt,
}: {
  open: boolean;
  onClose: () => void;
  student: Student;
  className: string;
  postedAt: string | null;
}) {
  const queryClient = useQueryClient();
  const lessons = student.changeable?.lessons ?? [];
  const checklist = student.checklist;
  const scores = checklist?.quiz.scores ?? [];
  const items = checklist?.quiz.items ?? null;
  const postedOn = manilaDay(postedAt);
  const [item, setItem] = useState<GradeChangeItem | ''>('');
  const [lesson, setLesson] = useState<number | null>(null);
  const [to, setTo] = useState<GradeChangeTo | ''>('');
  const [madeUpOn, setMadeUpOn] = useState('');
  const [handedIn, setHandedIn] = useState<'yes' | 'no' | ''>('');
  const [broughtOn, setBroughtOn] = useState('');
  const [tryNo, setTryNo] = useState<number | null>(null);
  const [score, setScore] = useState('');
  const [read, setRead] = useState<'yes' | 'no' | ''>('');
  const [details, setDetails] = useState('');
  const [reviewing, setReviewing] = useState(false);

  const verseOrDevotional = item === 'VERSE' || item === 'DEVOTIONAL';
  // A verse or devotional counts only for a lesson come to or made up.
  const shown = verseOrDevotional ? lessons.filter((each) => each.verse !== null && each.verse !== undefined) : lessons;
  const chosen = shown.find((each) => each.lesson === lesson) ?? null;
  const counted = chosen === null ? null : item === 'VERSE' ? chosen.verse : item === 'DEVOTIONAL' ? chosen.devotional : null;
  // Only a try already recorded is corrected (owner, 2026-11-26): a missing one is a retake.
  const tryOptions = scores.map((s, i) => ({ value: i + 1, label: `Try ${i + 1} · now ${s} of ${items}` }));

  let input: GradeChangeInput | null = null;
  if (item === 'ATTENDANCE' && chosen !== null && to !== '' && (to !== 'MADE_UP' || madeUpOn !== '')) {
    input = { item, lesson: chosen.lesson, to, ...(to === 'MADE_UP' ? { made_up_on: madeUpOn } : {}) };
  } else if (verseOrDevotional && chosen !== null && handedIn !== '' && (handedIn === 'no' || broughtOn !== '')) {
    input = {
      item,
      lesson: chosen.lesson,
      handed_in: handedIn === 'yes',
      ...(handedIn === 'yes' ? { brought_on: broughtOn } : {}),
    };
  } else if (item === 'QUIZ' && tryNo !== null && /^\d+$/.test(score)) {
    input = { item, try: tryNo, score: Number(score) };
  } else if (item === 'BOOK' && read !== '') {
    input = { item, read: read === 'yes' };
  }

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
        { ...input!, why: 'RECORDED_WRONGLY', details: details.trim(), changes_seen: student.changes_seen ?? 0 },
        idempotencyKeyFor('equipping-grade-change', writeKey, student.final_grade_id!, JSON.stringify(input), details.trim()),
      ),
    onSuccess: async () => {
      renewWriteKey();
      await queryClient.invalidateQueries({ queryKey: ['equipping'] });
      close();
    },
  });

  function reset() {
    setLesson(null);
    setTo('');
    setMadeUpOn('');
    setHandedIn('');
    setBroughtOn('');
    setTryNo(null);
    setScore('');
    setRead('');
  }

  function close() {
    save.reset();
    setItem('');
    reset();
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

  const ready = preview.isSuccess && details.trim() !== '' && !save.isPending;
  const name = student.person.full_name ?? 'this student';
  const owedSince = chosen === null ? '' : chosen.sign === 'MADE_UP' && chosen.made_up_on ? chosen.made_up_on : chosen.held_on;

  // What the change says, in words, for the summary.
  const said =
    input === null
      ? ''
      : item === 'ATTENDANCE'
        ? `L${chosen!.lesson}: ${signWords(chosen!.sign, chosen!.made_up_on)} → ${signWords(to as GradeChangeTo, to === 'MADE_UP' ? madeUpOn : null)}`
        : verseOrDevotional
          ? `L${chosen!.lesson} ${NOUN[item]}: ${counted ? 'handed in' : 'not handed in'} → ${handedIn === 'yes' ? `handed in (${dayLabel(broughtOn)})` : 'not handed in'}`
          : item === 'QUIZ'
            ? `Quiz try ${tryNo}: ${tryNo! <= scores.length ? scores[tryNo! - 1] : 'not recorded'} → ${score} of ${items}`
            : `Book: ${checklist?.book ? 'read' : 'not read'} → ${read === 'yes' ? 'read' : 'not read'}`;

  const trainingWords = (training: 'FILES' | 'WITHDRAWS' | null | undefined) =>
    training === 'FILES'
      ? ' SOL 1 goes into their Training from the school, unless they already have it.'
      : training === 'WITHDRAWS'
        ? ' The SOL 1 the school filed for them is withdrawn from their Training.'
        : '';

  if (reviewing && preview.data) {
    const p = preview.data;
    return (
      <Dialog open={open} onClose={close} title="Save this change?">
        <div className="border-line rounded-lg border px-3 py-3 text-sm">
          <p>
            <span className="font-semibold">{name}</span> · {className}
          </p>
          <p className="mt-2 font-semibold">{said}</p>
          <p>
            Grade: {GRADE_WORDS[p.grade_before]} → <span className="font-semibold">{GRADE_WORDS[p.grade_after]}</span>
          </p>
          <p className="text-muted mt-2">Recorded wrongly · {details.trim()}</p>
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

  const unavailable = student.changeable?.why ?? null;
  return (
    <Dialog open={open} onClose={close} title={`Change ${name}’s record`}>
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

        {unavailable !== null ? (
          <p className="text-sm">{unavailable}</p>
        ) : (
          <>
            <SelectField
              label="What to change"
              value={item}
              onChange={(event) => {
                save.reset();
                setItem(event.target.value as GradeChangeItem | '');
                reset();
              }}
            >
              <option value="">Choose what to change</option>
              {(Object.keys(ITEM_WORDS) as GradeChangeItem[]).map((each) => (
                <option key={each} value={each}>
                  {ITEM_WORDS[each]}
                </option>
              ))}
            </SelectField>

            {item === 'ATTENDANCE' || verseOrDevotional ? (
              <SelectField
                label="Lesson"
                value={lesson === null ? '' : String(lesson)}
                onChange={(event) => {
                  save.reset();
                  setLesson(event.target.value === '' ? null : Number(event.target.value));
                  setTo('');
                  setMadeUpOn('');
                  setHandedIn('');
                  setBroughtOn('');
                }}
              >
                <option value="">Choose a lesson</option>
                {shown.map((each) => (
                  <option key={each.lesson} value={each.lesson}>
                    L{each.lesson} · {dayLabel(each.held_on)} · now{' '}
                    {item === 'ATTENDANCE'
                      ? signWords(each.sign, each.made_up_on)
                      : `${NOUN[item as 'VERSE' | 'DEVOTIONAL']} ${
                          (item === 'VERSE' ? each.verse : each.devotional) ? 'handed in' : 'not handed in'
                        }`}
                  </option>
                ))}
              </SelectField>
            ) : null}

            {item === 'ATTENDANCE' && chosen !== null ? (
              <RadioGroup
                legend="Change it to"
                name="sol-change-to"
                layout="row"
                value={to}
                onChange={edit(setTo)}
                options={
                  chosen.sign === 'BEFORE_JOINING'
                    ? [{ value: 'MADE_UP', label: 'Made up' }]
                    : [
                        { value: 'CAME', label: 'Came' },
                        { value: 'ABSENT', label: 'Absent' },
                        { value: 'MADE_UP', label: 'Made up' },
                      ]
                }
              />
            ) : null}
            {item === 'ATTENDANCE' && to === 'MADE_UP' && chosen !== null ? (
              <Field
                label="Made up on"
                type="date"
                autoComplete="off"
                min={chosen.held_on}
                max={postedOn}
                value={madeUpOn}
                onChange={(event) => {
                  save.reset();
                  setMadeUpOn(event.target.value);
                }}
              />
            ) : null}

            {verseOrDevotional && chosen !== null ? (
              <RadioGroup
                legend="Change it to"
                name="sol-change-handed-in"
                layout="row"
                value={handedIn}
                onChange={edit(setHandedIn)}
                options={[
                  { value: 'no', label: 'Not handed in' },
                  { value: 'yes', label: 'Handed in' },
                ]}
              />
            ) : null}
            {verseOrDevotional && chosen !== null && handedIn === 'yes' ? (
              <Field
                label="Handed in on"
                type="date"
                autoComplete="off"
                min={owedSince}
                max={postedOn}
                value={broughtOn}
                onChange={(event) => {
                  save.reset();
                  setBroughtOn(event.target.value);
                }}
              />
            ) : null}

            {item === 'QUIZ' ? (
              items === null || scores.length === 0 ? (
                <p className="text-sm">
                  No quiz try was recorded for them before the class was posted, so there is none to correct: a
                  try not recorded then is a retake.
                </p>
              ) : (
                <>
                  <SelectField
                    label="Try"
                    value={tryNo === null ? '' : String(tryNo)}
                    onChange={(event) => {
                      save.reset();
                      setTryNo(event.target.value === '' ? null : Number(event.target.value));
                    }}
                  >
                    <option value="">Choose a try</option>
                    {tryOptions.map((each) => (
                      <option key={each.value} value={each.value}>
                        {each.label}
                      </option>
                    ))}
                  </SelectField>
                  <p className="text-muted text-sm">
                    A try not recorded before the class was posted is not added here: it is a retake.
                  </p>
                  {tryNo !== null ? (
                    <div className="w-40">
                      <Field
                        label={`Score out of ${items}`}
                        inputMode="numeric"
                        autoComplete="off"
                        value={score}
                        onChange={(event) => {
                          save.reset();
                          setScore(event.target.value.replace(/[^\d]/g, ''));
                        }}
                      />
                    </div>
                  ) : null}
                </>
              )
            ) : null}

            {item === 'BOOK' ? (
              <RadioGroup
                legend="Change it to"
                name="sol-change-book"
                layout="row"
                value={read}
                onChange={edit(setRead)}
                options={[
                  { value: 'no', label: 'Not read' },
                  { value: 'yes', label: 'Read' },
                ]}
              />
            ) : null}

            {item !== '' ? (
              <>
                {/* A change after posting corrects what was recorded wrongly, and nothing else
                    (owner, 2026-11-26): what was still owed when the class was posted is a retake. */}
                <RadioGroup
                  legend="Why"
                  name="sol-change-why"
                  layout="row"
                  value="RECORDED_WRONGLY"
                  onChange={() => undefined}
                  options={[{ value: 'RECORDED_WRONGLY', label: 'Recorded wrongly' }]}
                />
                <div>
                  <label htmlFor="sol-grade-change-details" className="field-label block">
                    Details (required)
                  </label>
                  <textarea
                    id="sol-grade-change-details"
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
              </>
            ) : null}

            <div aria-live="polite">
              {preview.data ? (
                <div className="border-line bg-raised rounded-lg border px-3 py-3 text-sm">
                  <p className="font-semibold">
                    Grade {preview.data.grade_after === preview.data.grade_before ? 'stays' : 'becomes'}{' '}
                    {GRADE_WORDS[preview.data.grade_after]}
                    <span className="text-muted font-normal"> · now {GRADE_WORDS[preview.data.grade_before]}</span>
                  </p>
                  <p className="text-muted mt-1">
                    {preview.data.reason_after}
                    {trainingWords(preview.data.training)}
                    {(preview.data.not_counted ?? []).length > 0 ? (
                      <span className="block">
                        {(preview.data.not_counted ?? []).map((n) => `Try ${n}`).join(' and ')} is then kept and not
                        counted.
                      </span>
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
          {unavailable === null ? (
            <Button type="submit" disabled={!ready}>
              Review change
            </Button>
          ) : null}
        </DialogActions>
      </form>
    </Dialog>
  );
}
