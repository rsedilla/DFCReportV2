'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { longDay } from '@/components/growth-controls';
import { Button } from '@/components/ui/button';
import { Dialog, DialogActions } from '@/components/ui/dialog';
import { FailureNotice } from '@/components/ui/failure-notice';
import { Field } from '@/components/ui/field';
import {
  listName,
  recordBook,
  recordItemsBrought,
  recordQuizTry,
  setQuiz,
  untickItemBrought,
  type AttendanceStudent,
  type ClassAttendance,
  type OwedItems,
  type SolItem,
} from '@/lib/equipping';
import { idempotencyKeyFor, useWriteKey } from '@/lib/idempotency';
import { getMe } from '@/lib/me';
import { describeFailure } from '@/lib/messages';
import { cn } from '@/lib/utils';

/** A SOL quiz passes at 70% of its items (decision 0501, point 18), as the API decides it. */
function percent(score: number, items: number): number {
  return Math.round((score * 100) / items);
}

function manilaToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
}

const ITEM_WORDS: Record<SolItem, string> = { VERSE: 'verse', DEVOTIONAL: 'devotional' };

/**
 * **A box that ticks all** (Material Design's parent checkbox, as *Everyone came*): ticked when
 * every student offered is, empty when none is, part-ticked between. Used for SOL's *Memory
 * verse* and *Devotional* columns, offered only for those ticked as came (decision 0514, point 8).
 */
export function TickAll({
  label,
  among,
  ticked,
  setTicked,
}: {
  label: string;
  among: string[];
  ticked: Set<string>;
  setTicked: (next: Set<string>) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const count = among.filter((id) => ticked.has(id)).length;
  const all = among.length > 0 && count === among.length;
  const some = count > 0 && !all;
  useEffect(() => {
    if (ref.current) {
      ref.current.indeterminate = some;
    }
  }, [some]);
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label={label}
      className="accent-accent size-6 shrink-0"
      checked={all}
      disabled={among.length === 0}
      onChange={(event) => setTicked(event.target.checked ? new Set(among) : new Set())}
    />
  );
}

/** Names who did something: *you* for the signed-in account, else their name. */
function useByWhom() {
  const me = useQuery({ queryKey: ['me'], queryFn: ({ signal }) => getMe(signal) });
  return (by: { account_id: string; full_name: string | null } | null | undefined) =>
    by && me.data?.account_id === by.account_id ? 'you' : (by?.full_name ?? 'another account');
}

/**
 * **Quiz and book** (decision 0514, point 8; owner rulings of 2026-11-26): the quiz's number of
 * items, entered once and fixed once a score is recorded; each student's tries with every score
 * kept, the result in words, *Book read*, and *Add a retake* after a failed try, never past the
 * third. The Teacher records and corrects all of it until final grades are posted, any try's score
 * included, and a try corrected to a pass leaves every later try kept and not counted.
 */
export function QuizAndBook({ data }: { data: ClassAttendance }) {
  const items = data.quiz?.items ?? null;
  const scored = data.students.some((s) => (s.quiz?.tries.length ?? 0) > 0);
  const [scoring, setScoring] = useState<{ student: AttendanceStudent; tryNumber: number } | null>(null);
  const byWhom = useByWhom();
  return (
    <div>
      <h2 id="lesson-heading" className="font-semibold">
        Quiz and book
      </h2>
      <p className="text-muted text-sm">
        Enter each score out of the quiz&rsquo;s items: 70% passes, with two retakes before final grades. Every score is
        kept. Tick the book once it is read.
      </p>
      {data.may_record ? <QuizItems classId={data.class.id} items={items} scored={scored} /> : null}
      {items === null ? (
        <p className="text-muted mt-3 text-sm">
          {data.may_record ? 'Enter the quiz’s number of items to record scores.' : 'No quiz recorded yet.'}
        </p>
      ) : null}
      {data.students.length === 0 ? (
        <p className="text-muted mt-3 text-sm">Nobody is enrolled yet.</p>
      ) : (
        <div className="relative mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Quiz tries and book, student by student</caption>
            <thead>
              <tr>
                <th scope="col" className="px-2 py-2 text-left">
                  Student
                </th>
                <th scope="col" className="px-2 py-2 text-left">
                  Tries, every score kept
                </th>
                <th scope="col" className="px-2 py-2 text-left">
                  Quiz
                </th>
                <th scope="col" className="px-2 py-2 text-left">
                  Book read
                </th>
                {data.may_record ? (
                  <th scope="col" className="px-2 py-2">
                    <span className="sr-only">Record</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {data.students.map((s) => {
                const quiz = s.quiz ?? { tries: [], passed: false, retakes_left: 2, may_add_try: false };
                const passing = items === null ? undefined : quiz.tries.find((t) => t.score * 10 >= items * 7);
                return (
                  <tr key={s.enrollment_id} className="border-line border-t">
                    <th scope="row" className="px-2 py-2 text-left font-semibold whitespace-nowrap">
                      {listName(s.person)}
                    </th>
                    <td className="px-2 py-2">
                      {quiz.tries.length === 0 || items === null ? (
                        'Not taken yet'
                      ) : (
                        // Every try carries its own Correct, as Canvas adjusts any one attempt (owner,
                        // 2026-11-26); a corrected try says what it replaced.
                        <ul className="flex flex-col gap-1">
                          {quiz.tries.map((t) => (
                            <li key={t.try}>
                              Try {t.try}: {t.score} of {items} · {percent(t.score, items)}%
                              {data.may_record ? (
                                <button
                                  type="button"
                                  className="text-accent ml-1 inline-flex min-h-6 items-center px-1.5 font-semibold underline underline-offset-2"
                                  onClick={() => setScoring({ student: s, tryNumber: t.try })}
                                >
                                  Correct
                                  <span className="sr-only">
                                    {' '}
                                    try {t.try} for {s.person.full_name}
                                  </span>
                                </button>
                              ) : null}
                              {t.corrected_from !== undefined ? (
                                <span className="text-muted block text-xs">
                                  Corrected from {t.corrected_from} by {byWhom(t.corrected_by)}
                                  {t.corrected_on ? `, ${longDay(t.corrected_on)}` : ''}
                                </span>
                              ) : null}
                            </li>
                          ))}
                          {(quiz.not_counted ?? []).map((t) => (
                            <li key={`not-counted-${t.try}`} className="text-muted">
                              <s>
                                Try {t.try}: {t.score} of {items} · {percent(t.score, items)}%
                              </s>
                              <span className="block text-xs">
                                Not counted: {passing ? `try ${passing.try} passed` : 'an earlier try passed'}. Kept in
                                history.
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      {quiz.passed
                        ? '✓ Passed'
                        : quiz.tries.length === 0
                          ? 'Not yet taken'
                          : quiz.retakes_left > 0
                            ? `Not yet passed · ${quiz.retakes_left} ${quiz.retakes_left === 1 ? 'retake' : 'retakes'} left`
                            : 'Not passed · no retakes left'}
                    </td>
                    <td className="px-1 py-0">
                      <BookTick
                        key={`${s.enrollment_id}:${String(s.book_read)}`}
                        classId={data.class.id}
                        student={s}
                        disabled={!data.may_record}
                      />
                    </td>
                    {data.may_record ? (
                      <td className="px-2 py-2">
                        <div className="flex flex-wrap justify-end gap-2">
                          {quiz.may_add_try ? (
                            <Button
                              type="button"
                              variant="secondary"
                              className="w-auto"
                              onClick={() => setScoring({ student: s, tryNumber: quiz.tries.length + 1 })}
                            >
                              {quiz.tries.length === 0 ? 'Enter the score' : 'Add a retake'}
                              <span className="sr-only"> for {s.person.full_name}</span>
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <ScoreDialog
        key={scoring ? `${scoring.student.enrollment_id}:${scoring.tryNumber}` : 'none'}
        classId={data.class.id}
        items={items}
        scoring={scoring}
        onClose={() => setScoring(null)}
      />
    </div>
  );
}

function QuizItems({ classId, items, scored }: { classId: string; items: number | null; scored: boolean }) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState(items === null ? '' : String(items));
  const [writeKey, renewWriteKey] = useWriteKey();
  const save = useMutation({
    mutationFn: () => {
      const body = { items: Number(value) };
      return setQuiz(classId, body, idempotencyKeyFor('equipping-quiz', writeKey, { classId, ...body }));
    },
    onSuccess: async () => {
      renewWriteKey();
      await queryClient.invalidateQueries({ queryKey: ['equipping'] });
    },
  });
  const valid = /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 500;
  return (
    <form
      className="mt-3 flex flex-wrap items-end gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid && !save.isPending) {
          save.mutate();
        }
      }}
    >
      <div className="w-40">
        <Field
          label="Quiz items"
          autoComplete="off"
          inputMode="numeric"
          value={value}
          onChange={(event) => setValue(event.target.value.trim())}
          disabled={scored}
          description={scored ? 'Fixed once a score is recorded.' : undefined}
          required
        />
      </div>
      {scored ? null : (
        <Button type="submit" variant="secondary" className="w-auto" disabled={!valid || save.isPending || Number(value) === items}>
          {items === null ? 'Save items' : 'Change items'}
        </Button>
      )}
      <FailureNotice failure={save.isError ? describeFailure(save.error) : null} />
    </form>
  );
}

function BookTick({ classId, student, disabled }: { classId: string; student: AttendanceStudent; disabled: boolean }) {
  const queryClient = useQueryClient();
  // Shown at once, and put back if the save fails, so the box answers the click.
  const [read, setRead] = useState(student.book_read ?? false);
  const [writeKey, renewWriteKey] = useWriteKey();
  const save = useMutation({
    mutationFn: (next: boolean) => {
      const body = { enrollment_id: student.enrollment_id, read: next };
      return recordBook(classId, body, idempotencyKeyFor('equipping-book', writeKey, { classId, ...body }));
    },
    onSuccess: async () => {
      renewWriteKey();
      await queryClient.invalidateQueries({ queryKey: ['equipping'] });
    },
    onError: () => setRead(student.book_read ?? false),
  });
  return (
    <>
      {/* The whole cell is the target, not the 24px box alone. */}
      <label className="flex min-h-12 min-w-12 cursor-pointer items-center">
        <input
          type="checkbox"
          aria-label={`${student.person.full_name ?? 'This student'} read the book`}
          className="accent-accent size-6"
          checked={read}
          disabled={disabled || save.isPending}
          onChange={(event) => {
            setRead(event.target.checked);
            save.mutate(event.target.checked);
          }}
        />
      </label>
      <FailureNotice failure={save.isError ? describeFailure(save.error) : null} />
    </>
  );
}

function ScoreDialog({
  classId,
  items,
  scoring,
  onClose,
}: {
  classId: string;
  items: number | null;
  scoring: { student: AttendanceStudent; tryNumber: number } | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const existing = scoring?.student.quiz?.tries.find((t) => t.try === scoring.tryNumber);
  const [value, setValue] = useState(existing ? String(existing.score) : '');
  const [writeKey, renewWriteKey] = useWriteKey();
  const save = useMutation({
    mutationFn: () => {
      const body = { enrollment_id: scoring!.student.enrollment_id, try: scoring!.tryNumber, score: Number(value) };
      return recordQuizTry(classId, body, idempotencyKeyFor('equipping-quiz-try', writeKey, { classId, ...body }));
    },
    onSuccess: async () => {
      renewWriteKey();
      await queryClient.invalidateQueries({ queryKey: ['equipping'] });
      onClose();
    },
  });
  const valid = items !== null && /^\d+$/.test(value) && Number(value) <= items;
  const name = scoring?.student.person.full_name ?? 'this student';
  return (
    <Dialog
      open={scoring !== null}
      onClose={onClose}
      title={scoring ? `${existing ? 'Correct' : 'Score for'} try ${scoring.tryNumber} · ${name}` : 'Quiz score'}
    >
      {existing ? (
        <p className="text-muted text-sm">
          Recorded as {existing.score} of {items}. The score it replaces is kept.
        </p>
      ) : null}
      <div className="mt-4 w-40">
        <Field
          label={`Score out of ${items ?? '?'}`}
          autoComplete="off"
          inputMode="numeric"
          value={value}
          onChange={(event) => setValue(event.target.value.trim())}
          required
        />
      </div>
      {valid && items !== null ? (
        <p className="mt-2 text-sm" role="status">
          {percent(Number(value), items)}% · {Number(value) * 10 >= items * 7 ? 'passes' : 'does not pass yet'}
        </p>
      ) : null}
      <FailureNotice failure={save.isError ? describeFailure(save.error) : null} />
      <DialogActions>
        <Button type="button" disabled={!valid || save.isPending} onClick={() => save.mutate()}>
          {existing ? 'Save correction' : 'Save score'}
        </Button>
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/**
 * **Verses and devotionals still owed** (decision 0514, point 10, as approved): one row a student,
 * what they owe from a lesson whose week has closed or a make-up recorded without it, *Cell
 * leader … · owed since …*, and *Tick what is brought*. A late tick counts as an on-time one and
 * carries no late mark.
 */
export function OwedItemsCard({ data }: { data: ClassAttendance }) {
  const [ticking, setTicking] = useState<OwedItems | null>(null);
  const rows = data.owed_items ?? [];
  // What was ticked late, one row a lesson's item, so a tick made by mistake can be unticked
  // (owner, 2026-11-26, as Google Classroom returns a turned-in piece of work).
  const late = data.students.flatMap((student) =>
    (student.brought_late ?? []).map((item) => ({ student, item })),
  );
  if (rows.length === 0 && late.length === 0) {
    return null;
  }
  return (
    <section aria-labelledby="owed-items-heading" className="border-line bg-surface rounded-xl border p-4">
      <h2 id="owed-items-heading" className="font-semibold">
        Verses and devotionals still owed{rows.length > 0 ? ` · ${rows.length}` : ''}
      </h2>
      <p className="text-muted text-sm">
        From lessons whose week has closed, or a make-up recorded without them. Tick them here when they are brought, and
        untick one ticked by mistake, until final grades are posted.
      </p>
      {rows.length === 0 ? <p className="mt-3 text-sm">Nothing is owed.</p> : null}
      <ul className="mt-3 flex flex-col">
        {rows.map((row) => (
          <li key={row.enrollment_id} className="border-line flex flex-wrap items-center justify-between gap-3 border-t py-2">
            <span>
              <span className="font-semibold">{listName(row.person)}</span> ·{' '}
              {row.lessons.map((l) => `L${l.lesson} ${l.items.map((i) => ITEM_WORDS[i]).join(' and ')}`).join(', ')}
              <span className="text-muted block text-xs">
                Cell leader {row.cell_leader?.full_name ?? 'none'} ·{' '}
                {row.lessons
                  .map((l) =>
                    l.made_up ? `owed since the L${l.lesson} make-up, ${longDay(l.owed_since)}` : `owed since ${longDay(l.owed_since)}`,
                  )
                  .join(' · ')}
              </span>
            </span>
            {data.may_record ? (
              <Button type="button" variant="secondary" className="w-auto" onClick={() => setTicking(row)}>
                Tick what is brought
                <span className="sr-only"> by {row.person.full_name}</span>
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {late.length > 0 ? (
        <>
          <h3 className="mt-4 text-sm font-semibold">Brought late · {late.length}</h3>
          <ul className="mt-1 flex flex-col">
            {late.map(({ student, item }) => (
              <BroughtLateRow
                key={`${student.enrollment_id}:${item.lesson}:${item.item}`}
                classId={data.class.id}
                student={student}
                item={item}
                mayRecord={data.may_record}
              />
            ))}
          </ul>
        </>
      ) : null}
      <BroughtDialog
        key={ticking ? ticking.enrollment_id : 'none'}
        classId={data.class.id}
        row={ticking}
        onClose={() => setTicking(null)}
      />
    </section>
  );
}

function BroughtLateRow({
  classId,
  student,
  item,
  mayRecord,
}: {
  classId: string;
  student: AttendanceStudent;
  item: NonNullable<AttendanceStudent['brought_late']>[number];
  mayRecord: boolean;
}) {
  const queryClient = useQueryClient();
  const byWhom = useByWhom();
  const [writeKey, renewWriteKey] = useWriteKey();
  const untick = useMutation({
    mutationFn: () => {
      const body = { enrollment_id: student.enrollment_id, lesson: item.lesson, item: item.item };
      return untickItemBrought(classId, body, idempotencyKeyFor('equipping-untick', writeKey, { classId, ...body }));
    },
    onSuccess: async () => {
      renewWriteKey();
      await queryClient.invalidateQueries({ queryKey: ['equipping'] });
    },
  });
  const what = `L${item.lesson} ${ITEM_WORDS[item.item]}`;
  return (
    <li className="border-line flex flex-wrap items-center justify-between gap-3 border-t py-2">
      <span>
        <span className="font-semibold">{listName(student.person)}</span> · {what}
        <span className="text-muted block text-xs">
          Brought {longDay(item.brought_on)} · ticked by {byWhom(item.ticked_by)}
        </span>
      </span>
      {mayRecord ? (
        <Button
          type="button"
          variant="secondary"
          className="w-auto"
          disabled={untick.isPending}
          onClick={() => untick.mutate()}
        >
          Untick
          <span className="sr-only">
            {' '}
            {what} for {student.person.full_name}
          </span>
        </Button>
      ) : null}
      <div className="w-full empty:hidden">
        <FailureNotice failure={untick.isError ? describeFailure(untick.error) : null} />
      </div>
    </li>
  );
}

function BroughtDialog({ classId, row, onClose }: { classId: string; row: OwedItems | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [broughtOn, setBroughtOn] = useState(manilaToday());
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [writeKey, renewWriteKey] = useWriteKey();
  const save = useMutation({
    mutationFn: async () => {
      // One write a lesson, each naming what was brought for it.
      for (const lesson of row!.lessons) {
        const items = lesson.items.filter((item) => chosen.has(`${lesson.lesson}:${item}`));
        if (items.length === 0) {
          continue;
        }
        const body = { enrollment_id: row!.enrollment_id, lesson: lesson.lesson, items, brought_on: broughtOn };
        await recordItemsBrought(classId, body, idempotencyKeyFor('equipping-items-brought', writeKey, { classId, ...body }));
      }
    },
    onSuccess: async () => {
      renewWriteKey();
      await queryClient.invalidateQueries({ queryKey: ['equipping'] });
      onClose();
    },
  });
  return (
    <Dialog
      open={row !== null}
      onClose={onClose}
      title={row ? `What ${row.person.full_name ?? 'this student'} brought` : 'What was brought'}
    >
      <fieldset className="mt-1 flex flex-col gap-1">
        <legend className="sr-only">What was brought</legend>
        {row?.lessons.flatMap((lesson) =>
          lesson.items.map((item) => {
            const key = `${lesson.lesson}:${item}`;
            return (
              <label key={key} className="flex min-h-11 cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  className="accent-accent size-6 shrink-0"
                  checked={chosen.has(key)}
                  onChange={(event) =>
                    setChosen((was) => {
                      const next = new Set(was);
                      if (event.target.checked) {
                        next.add(key);
                      } else {
                        next.delete(key);
                      }
                      return next;
                    })
                  }
                />
                {item === 'VERSE' ? `Recited the L${lesson.lesson} memory verse` : `Handed in the L${lesson.lesson} devotional`}
              </label>
            );
          }),
        )}
      </fieldset>
      <div className="mt-4">
        <Field
          label="Date brought"
          type="date"
          autoComplete="off"
          value={broughtOn}
          onChange={(event) => setBroughtOn(event.target.value)}
          required
        />
      </div>
      <FailureNotice failure={save.isError ? describeFailure(save.error) : null} />
      <DialogActions>
        <Button type="button" disabled={save.isPending || chosen.size === 0 || broughtOn === ''} onClick={() => save.mutate()}>
          Tick what is brought
        </Button>
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/**
 * **Record so far** (decision 0514, point 8): *L1* to *L10*, *Verses* and *Devotionals* counted out
 * of ten, *Quiz*, *Book* and *Still missing*, never colour alone.
 */
export function SolRecord({ data }: { data: ClassAttendance }) {
  const items = data.quiz?.items ?? null;
  return (
    <section aria-labelledby="register-heading" className="border-line bg-surface rounded-xl border p-4">
      <h2 id="register-heading" className="font-semibold">
        Record so far
      </h2>
      <p className="text-muted text-sm">✓ came · ✗ absent · M made up · – not yet · ○ before they joined</p>
      {data.students.length === 0 ? (
        <p className="text-muted mt-3 text-sm">Nobody is enrolled yet.</p>
      ) : (
        <div className="relative mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Record so far, lesson by lesson</caption>
            <thead>
              <tr>
                <th scope="col" className="px-2 py-2 text-left">
                  Student
                </th>
                {data.lessons.map((l) => (
                  <th key={l.lesson} scope="col" className="px-2 py-2">
                    L{l.lesson}
                  </th>
                ))}
                <th scope="col" className="px-2 py-2">
                  Verses
                </th>
                <th scope="col" className="px-2 py-2">
                  Devotionals
                </th>
                <th scope="col" className="px-2 py-2">
                  Quiz
                </th>
                <th scope="col" className="px-2 py-2">
                  Book
                </th>
                <th scope="col" className="px-2 py-2 text-left">
                  Still missing
                </th>
              </tr>
            </thead>
            <tbody>
              {data.students.map((s) => {
                const best = items === null ? null : Math.max(-1, ...(s.quiz?.tries.map((t) => t.score) ?? []));
                const missing = s.still_missing;
                const words = missing
                  ? [
                      ...missing.make_ups.map((n) => `L${n} make-up`),
                      ...missing.verses.map((n) => `L${n} verse`),
                      ...missing.devotionals.map((n) => `L${n} devotional`),
                      ...(missing.quiz ? ['quiz'] : []),
                      ...(missing.book ? ['book'] : []),
                    ]
                  : [];
                return (
                  <tr key={s.enrollment_id} className="border-line border-t">
                    <th scope="row" className="px-2 py-2 text-left font-semibold whitespace-nowrap">
                      {listName(s.person)}
                    </th>
                    {data.lessons.map((l) => {
                      const mark = s.marks.find((m) => m.lesson === l.lesson) ?? null;
                      const sign =
                        mark === null
                          ? '–'
                          : mark.came
                            ? '✓'
                            : mark.made_up_on
                              ? 'M'
                              : mark.before_joining
                                ? '○'
                                : '✗';
                      return (
                        <td key={l.lesson} className={cn('px-2 py-2 text-center', sign === '✗' && 'text-field-invalid font-semibold')}>
                          <span aria-hidden="true">{sign}</span>
                          <span className="sr-only">
                            {sign === '–'
                              ? 'not yet'
                              : sign === '✓'
                                ? 'came'
                                : sign === 'M'
                                  ? 'made up'
                                  : sign === '○'
                                    ? 'before they joined'
                                    : 'absent'}
                          </span>
                        </td>
                      );
                    })}
                    <td className="px-2 py-2 text-center whitespace-nowrap">{s.verses ?? 0} of 10</td>
                    <td className="px-2 py-2 text-center whitespace-nowrap">{s.devotionals ?? 0} of 10</td>
                    <td className="px-2 py-2 text-center whitespace-nowrap">
                      {best === null || best < 0 ? (
                        <span aria-label="not taken yet">–</span>
                      ) : (
                        <>
                          {percent(best, items!)}%{s.quiz?.passed ? <span aria-label=", passed"> ✓</span> : null}
                        </>
                      )}
                    </td>
                    <td className="px-2 py-2 text-center">
                      {s.book_read ? <span aria-label="read">✓</span> : <span aria-label="not yet">–</span>}
                    </td>
                    <td className="px-2 py-2">{words.length === 0 ? 'Nothing missing so far' : words.join(', ')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
