'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { longDay } from '@/components/growth-controls';
import { OwedItemsCard, QuizAndBook, SolRecord, TickAll } from '@/components/sol-register';
import { TeachFrame } from '@/components/teach-frame';
import { Button } from '@/components/ui/button';
import { Dialog, DialogActions } from '@/components/ui/dialog';
import { FailureNotice } from '@/components/ui/failure-notice';
import { Field } from '@/components/ui/field';
import { HeaderCell, Table, rowClasses } from '@/components/ui/table';
import { timeLabel } from '@/lib/cells';
import {
  DAY_NAMES,
  getClassAttendance,
  recordMakeUp,
  saveLesson,
  termLabel,
  type AttendanceStudent,
  type ClassAttendance,
  type ClassLesson,
  type LessonState,
  listName,
} from '@/lib/equipping';
import { idempotencyKeyFor, useWriteKey } from '@/lib/idempotency';
import { describeFailure } from '@/lib/messages';
import { cn } from '@/lib/utils';

/** Where a lesson stands, in words, never colour alone (decision 0501, point 10). */
const STATE_WORDS: Record<LessonState, string> = {
  SAVED: 'Saved',
  NOT_YET: 'Not yet',
  TODAY: 'Today',
  TO_RECORD: 'To record',
  LATE: 'Late',
  NOT_RECORDED: 'Not recorded',
};

/** The register's columns: lessons 1 to 4, the Encounter (the Registrar's), then 6 to 9. */
const COLUMNS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

function lessonLabel(n: number): string {
  return n === 5 ? 'ENC' : `L${n}`;
}

/** The lesson the page opens on: the first still to record, else the last saved, else lesson 1. */
function firstOpen(lessons: ClassLesson[]): number {
  const pending = lessons.find((l) => l.state === 'TODAY' || l.state === 'LATE' || l.state === 'TO_RECORD');
  if (pending) {
    return pending.lesson;
  }
  const saved = lessons.filter((l) => l.state === 'SAVED');
  return saved.length > 0 ? saved[saved.length - 1].lesson : lessons[0].lesson;
}

/**
 * **A class's attendance** (decisions 0501 and 0503): the lesson row, the lesson chosen with a
 * tick box for each student, anyone not ticked saved Absent, the make-ups still owed, and the
 * register. A Guide sees their own students and records nothing.
 */
export default function ClassAttendancePage() {
  const { id } = useParams<{ id: string }>();
  const read = useQuery({
    queryKey: ['equipping', 'attendance', id],
    queryFn: ({ signal }) => getClassAttendance(id, signal),
  });
  const data = read.data;
  return (
    <TeachFrame
      title={data?.class.name ?? 'Class'}
      lead={
        data
          ? `${DAY_NAMES[data.class.day_of_week - 1]} ${timeLabel(data.class.time_of_day)}${
              data.class.place ? ` · ${data.class.place}` : ''
            } · ${ROLE_WORDS[data.role]} · ${data.students.length} ${data.students.length === 1 ? 'student' : 'students'}`
          : ''
      }
    >
      <FailureNotice failure={read.isError ? describeFailure(read.error) : null} />
      {data ? <ClassBody data={data} /> : null}
    </TeachFrame>
  );
}

const ROLE_WORDS: Record<ClassAttendance['role'], string> = {
  TEACHER: 'You teach this class',
  GUIDE: 'You guide your own students here',
  COORDINATOR: 'You coordinate this class',
  ADMIN: 'Admin',
};

function ClassBody({ data }: { data: ClassAttendance }) {
  // SOL's ten lessons and its quiz and book (decision 0514, point 8); Life Class's nine with the
  // Encounter, the Registrar's, as lesson 5.
  const sol = data.class.level !== 'LIFE_CLASS';
  const [chosen, setChosen] = useState<number | 'QUIZ'>(() => firstOpen(data.lessons));
  const lesson = data.lessons.find((l) => l.lesson === chosen) ?? data.lessons[0];
  const columns = sol ? data.lessons.map((l) => l.lesson) : COLUMNS;
  const quizDone =
    data.students.length > 0 && data.students.every((s) => s.quiz?.passed === true && s.book_read === true);
  return (
    <div className="flex flex-col gap-6">
      {data.role === 'GUIDE' ? <MissedTwice data={data} /> : null}
      <div className="flex flex-wrap gap-2" role="group" aria-label="Choose a lesson">
        {columns.map((n) => {
          if (n === 5 && !sol) {
            return (
              <span key={n} className="border-line text-muted flex min-h-11 flex-col rounded-lg border px-3 py-1 text-sm">
                <span className="font-semibold">ENC</span>
                <span className="text-xs">Registrar</span>
              </span>
            );
          }
          const each = data.lessons.find((l) => l.lesson === n)!;
          const warn = each.state === 'LATE' || each.state === 'NOT_RECORDED';
          return (
            <button
              key={n}
              type="button"
              aria-pressed={n === chosen}
              onClick={() => setChosen(n)}
              className={cn(
                'flex min-h-11 flex-col items-start rounded-lg border px-3 py-1 text-left text-sm',
                n === chosen ? 'border-accent bg-accent-soft' : 'border-line bg-surface hover:bg-raised',
              )}
            >
              <span className="font-semibold">{sol ? `L${n}` : lessonLabel(n)}</span>
              <span className={cn('text-xs', warn ? 'text-field-invalid font-semibold' : 'text-muted')}>
                {STATE_WORDS[each.state]}
              </span>
            </button>
          );
        })}
        {sol ? (
          <button
            type="button"
            aria-pressed={chosen === 'QUIZ'}
            onClick={() => setChosen('QUIZ')}
            className={cn(
              'flex min-h-11 flex-col items-start rounded-lg border px-3 py-1 text-left text-sm',
              chosen === 'QUIZ' ? 'border-accent bg-accent-soft' : 'border-line bg-surface hover:bg-raised',
            )}
          >
            <span className="font-semibold">Quiz and book</span>
            <span className="text-muted text-xs">{quizDone ? 'Done' : 'Not yet'}</span>
          </button>
        ) : null}
      </div>

      <section aria-labelledby="lesson-heading" className="border-line bg-surface rounded-xl border p-4">
        {chosen === 'QUIZ' ? (
          <QuizAndBook data={data} />
        ) : data.may_record && (lesson.open || data.may_correct_closed) ? (
          <LessonForm key={`${lesson.lesson}:${lesson.version ?? 0}`} data={data} lesson={lesson} />
        ) : (
          <LessonRead data={data} lesson={lesson} />
        )}
      </section>

      <Owed data={data} />
      {sol ? <OwedItemsCard data={data} /> : null}
      {sol ? <SolRecord data={data} /> : <Register data={data} />}
    </div>
  );
}

/**
 * The two lessons a student missed in a row, or null (decision 0505): the class's last two saved
 * lessons in lesson order, any the register marks before they joined and the Encounter left out,
 * absent at both and neither made up yet. A saved lesson with no mark for them is no absence.
 */
function missedLastTwo(student: AttendanceStudent, lessons: ClassLesson[]): [number, number] | null {
  const lastTwo = lessons
    .filter((l) => l.lesson !== 5 && l.state === 'SAVED' && !markFor(student, l.lesson)?.before_joining)
    .map((l) => l.lesson)
    .sort((a, b) => a - b)
    .slice(-2);
  if (lastTwo.length < 2) {
    return null;
  }
  const missed = lastTwo.every((n) => {
    const mark = markFor(student, n);
    return mark !== null && !mark.came && mark.made_up_on === null;
  });
  return missed ? [lastTwo[0], lastTwo[1]] : null;
}

/**
 * **Missed the last two lessons** (decision 0501, point 4; decision 0505): for a Guide, a line
 * naming any of their students absent at the class's last two saved lessons and not made up, with
 * their Cell leader. Drawn only when somebody is on it.
 */
function MissedTwice({ data }: { data: ClassAttendance }) {
  const missing = data.students
    .map((s) => ({ student: s, lessons: missedLastTwo(s, data.lessons) }))
    .filter((each): each is { student: AttendanceStudent; lessons: [number, number] } => each.lessons !== null);
  if (missing.length === 0) {
    return null;
  }
  return (
    <section aria-labelledby="missed-heading" className="border-line bg-surface rounded-xl border p-4">
      <h2 id="missed-heading" className="font-semibold">
        Missed the last two lessons · {missing.length}
      </h2>
      <p className="text-muted text-sm">Absent at both and not made up yet. Follow them up and tell the Teacher.</p>
      <ul className="mt-2 flex flex-col gap-1 text-sm">
        {missing.map(({ student, lessons }) => (
          <li key={student.enrollment_id}>
            <span className="font-semibold">{listName(student.person)}</span> · L{lessons[0]} and L{lessons[1]} ·
            Cell leader {student.cell_leader?.full_name ?? 'none'}
          </li>
        ))}
      </ul>
    </section>
  );
}

function markFor(student: AttendanceStudent, lesson: number) {
  return student.marks.find((m) => m.lesson === lesson) ?? null;
}

/** The student's mark for a lesson as this class saved it, not one carried from elsewhere. */
function markHere(student: AttendanceStudent, lesson: number) {
  const mark = markFor(student, lesson);
  return mark && mark.from_class === null && !mark.before_joining ? mark : null;
}

/** Joined after the lesson's day: not ticked, made up (decision 0503). */
function joinedAfter(student: AttendanceStudent, heldOn: string): boolean {
  return heldOn !== '' && student.joined_on > heldOn;
}

/** Marked for this lesson in the class they moved from: that mark stands (decision 0503). */
function markedElsewhere(student: AttendanceStudent, lesson: number): string | null {
  if (markHere(student, lesson) !== null) {
    return null;
  }
  const mark = markFor(student, lesson);
  return mark?.came ? (mark.from_class?.name ?? null) : null;
}

/**
 * Missed this lesson in the class they moved from: ticked here only if they came here, which
 * replaces that absence; left unticked, it stands (owner, 2026-11-21).
 */
function missedElsewhere(student: AttendanceStudent, lesson: number): string | null {
  if (markHere(student, lesson) !== null) {
    return null;
  }
  const mark = markFor(student, lesson);
  return mark && !mark.came && mark.from_class ? mark.from_class.name : null;
}

/**
 * **Tick who came; anyone not ticked is saved Absent** (decision 0501, point 10), with *Tick all*
 * and, above Save, a line naming who will be saved absent and their Cell leaders.
 */
function LessonForm({ data, lesson }: { data: ClassAttendance; lesson: ClassLesson }) {
  const queryClient = useQueryClient();
  const [heldOn, setHeldOn] = useState(lesson.held_on ?? lesson.expected_on);
  const [came, setCame] = useState<Set<string>>(
    () => new Set(data.students.filter((s) => markHere(s, lesson.lesson)?.came).map((s) => s.enrollment_id)),
  );
  // SOL ticks the memory verse and devotional of whoever came (decision 0514, point 8).
  const sol = data.class.level !== 'LIFE_CLASS';
  const [verse, setVerse] = useState<Set<string>>(
    () => new Set(data.students.filter((s) => markHere(s, lesson.lesson)?.verse).map((s) => s.enrollment_id)),
  );
  const [devotional, setDevotional] = useState<Set<string>>(
    () => new Set(data.students.filter((s) => markHere(s, lesson.lesson)?.devotional).map((s) => s.enrollment_id)),
  );
  const [reason, setReason] = useState('');
  const [writeKey, renewWriteKey] = useWriteKey();
  const closed = !lesson.open;
  const save = useMutation({
    mutationFn: () => {
      const cameIds = [...came].filter((id) => ticking.some((s) => s.enrollment_id === id));
      const body = {
        held_on: heldOn,
        came: cameIds,
        ...(sol
          ? {
              verse: [...verse].filter((id) => cameIds.includes(id)),
              devotional: [...devotional].filter((id) => cameIds.includes(id)),
            }
          : {}),
        ...(lesson.version !== null ? { version: lesson.version } : {}),
        ...(closed ? { correction_reason: reason.trim() } : {}),
      };
      return saveLesson(
        data.class.id,
        lesson.lesson,
        body,
        idempotencyKeyFor('equipping-save-lesson', writeKey, { classId: data.class.id, lesson: lesson.lesson, ...body }),
      );
    },
    onSuccess: async () => {
      renewWriteKey();
      await queryClient.invalidateQueries({ queryKey: ['equipping'] });
    },
  });
  // Those who had joined by the lesson's day are ticked; anyone who joined later makes it up.
  // Joined at Lesson 6, keeping lessons 1 to 4 from an earlier class: not ticked for one (0512).
  const keeping = lesson.lesson <= 4 ? data.students.filter((s) => s.carried) : [];
  const later = data.students.filter((s) => !keeping.includes(s) && joinedAfter(s, heldOn));
  const elsewhere = data.students.filter(
    (s) => !keeping.includes(s) && !joinedAfter(s, heldOn) && markedElsewhere(s, lesson.lesson) !== null,
  );
  const ticking = data.students.filter((s) => !keeping.includes(s) && !later.includes(s) && !elsewhere.includes(s));
  const absent = ticking.filter((s) => !came.has(s.enrollment_id));
  const cameCount = ticking.length - absent.length;
  const cameIds = ticking.filter((s) => came.has(s.enrollment_id)).map((s) => s.enrollment_id);
  const verseCount = cameIds.filter((id) => verse.has(id)).length;
  const devotionalCount = cameIds.filter((id) => devotional.has(id)).length;
  const flip = (set: (update: (was: Set<string>) => Set<string>) => void, enrollmentId: string, on: boolean) =>
    set((was) => {
      const next = new Set(was);
      if (on) {
        next.add(enrollmentId);
      } else {
        next.delete(enrollmentId);
      }
      return next;
    });
  const toggle = (enrollmentId: string, on: boolean) => flip(setCame, enrollmentId, on);
  const canSave = !save.isPending && heldOn !== '' && (!closed || reason.trim() !== '');

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (canSave) {
          save.mutate();
        }
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="lesson-heading" className="font-semibold">
            Lesson {lesson.lesson} · {longDay(heldOn || lesson.expected_on)}
            {lesson.state === 'SAVED' ? ' · Saved' : ''}
          </h2>
          <p className="text-muted text-sm">
            {sol
              ? 'Tick who came, who recited the memory verse, and who handed in the devotional. Anyone not ticked as came is saved Absent; their verse and devotional are ticked when they make the lesson up.'
              : 'Tick who came. Anyone not ticked is saved Absent.'}
            {lesson.state === 'SAVED' && lesson.open
              ? ` You may change it until ${new Date(lesson.closes_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}.`
              : ''}
          </p>
        </div>
      </div>
      <div className="mt-3 max-w-xs">
        <Field
          label="Held on"
          type="date"
          autoComplete="off"
          value={heldOn}
          onChange={(event) => setHeldOn(event.target.value)}
          description="Change it if the class met on another day."
          required
        />
      </div>

      {data.students.length === 0 ? (
        <p className="text-muted mt-4 text-sm">Nobody is enrolled yet.</p>
      ) : (
        <>
          <ul className="mt-4 flex flex-col gap-2 lg:hidden">
            {ticking.length > 1 ? (
              <li>
                <div className="border-line bg-raised rounded-lg border px-3 py-2">
                  <label className="flex min-h-11 cursor-pointer items-center gap-3">
                    <EveryoneCame ticking={ticking} came={came} setCame={setCame} />
                    <span className="font-semibold">Everyone came</span>
                  </label>
                  {sol ? (
                    <div className="mt-1 flex flex-col pl-9">
                      <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
                        <TickAll label="All recited the verse" among={cameIds} ticked={verse} setTicked={setVerse} />
                        All recited the verse
                      </label>
                      <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
                        <TickAll
                          label="All handed in the devotional"
                          among={cameIds}
                          ticked={devotional}
                          setTicked={setDevotional}
                        />
                        All handed in the devotional
                      </label>
                    </div>
                  ) : null}
                </div>
              </li>
            ) : null}
            {ticking.map((s) => (
              // SOL's card holds the two ticks under the name, inside the card (decision 0514).
              <li key={s.enrollment_id} className={sol ? 'border-line rounded-lg border' : undefined}>
                <label
                  className={cn(
                    'flex min-h-13 cursor-pointer items-center gap-3 px-3 py-2',
                    !sol && 'border-line rounded-lg border',
                  )}
                >
                  <input
                    type="checkbox"
                    className="accent-accent size-6 shrink-0"
                    checked={came.has(s.enrollment_id)}
                    onChange={(event) => toggle(s.enrollment_id, event.target.checked)}
                  />
                  <span>
                    <span className="block font-semibold">{listName(s.person)}</span>
                    <span className="text-muted block text-xs">
                      Cell leader {s.cell_leader?.full_name ?? 'none'} · Guide {s.guide?.full_name ?? 'none yet'}
                    </span>
                    {missedElsewhere(s, lesson.lesson) ? (
                      <span className="text-muted block text-xs">
                        Missed it in {missedElsewhere(s, lesson.lesson)}; tick if they came here
                      </span>
                    ) : null}
                  </span>
                </label>
                {sol ? (
                  <SolTicks
                    student={s}
                    came={came.has(s.enrollment_id)}
                    verse={verse}
                    devotional={devotional}
                    onVerse={(on) => flip(setVerse, s.enrollment_id, on)}
                    onDevotional={(on) => flip(setDevotional, s.enrollment_id, on)}
                  />
                ) : null}
              </li>
            ))}
          </ul>
          <Table
            caption={`Who came to lesson ${lesson.lesson}`}
            className={cn('mt-4 hidden', ticking.length > 0 && 'lg:block')}
          >
            <thead>
              <tr>
                <HeaderCell className="w-20">
                  <label className="flex min-h-11 cursor-pointer items-center gap-2">
                    <EveryoneCame ticking={ticking} came={came} setCame={setCame} />
                    Came
                  </label>
                </HeaderCell>
                <HeaderCell>Name</HeaderCell>
                {sol ? (
                  <>
                    <HeaderCell>
                      <label className="flex min-h-11 cursor-pointer items-center gap-2">
                        <TickAll label="All recited the verse" among={cameIds} ticked={verse} setTicked={setVerse} />
                        Memory verse
                      </label>
                    </HeaderCell>
                    <HeaderCell>
                      <label className="flex min-h-11 cursor-pointer items-center gap-2">
                        <TickAll
                          label="All handed in the devotional"
                          among={cameIds}
                          ticked={devotional}
                          setTicked={setDevotional}
                        />
                        Devotional
                      </label>
                    </HeaderCell>
                  </>
                ) : null}
                <HeaderCell>Cell leader</HeaderCell>
                <HeaderCell>Guide</HeaderCell>
              </tr>
            </thead>
            <tbody>
              {ticking.map((s) => (
                <tr key={s.enrollment_id} className={rowClasses}>
                  <td className="px-1 py-0">
                    {/* The whole cell is the target, not the 24px box alone (Material's 48px). */}
                    <label className="flex min-h-12 min-w-12 cursor-pointer items-center justify-center">
                      <input
                        type="checkbox"
                        aria-label={`${s.person.full_name ?? 'This student'} came`}
                        className="accent-accent size-6"
                        checked={came.has(s.enrollment_id)}
                        onChange={(event) => toggle(s.enrollment_id, event.target.checked)}
                      />
                    </label>
                  </td>
                  <th scope="row" className="px-3 py-2 text-left font-semibold">
                    {listName(s.person)}
                    {missedElsewhere(s, lesson.lesson) ? (
                      <span className="text-muted block text-xs font-normal">
                        Missed it in {missedElsewhere(s, lesson.lesson)}; tick if they came here
                      </span>
                    ) : null}
                  </th>
                  {sol ? (
                    came.has(s.enrollment_id) ? (
                      <>
                        <td className="px-1 py-0">
                          <label className="flex min-h-12 min-w-12 cursor-pointer items-center justify-center">
                            <input
                              type="checkbox"
                              aria-label={`${s.person.full_name ?? 'This student'} recited the memory verse`}
                              className="accent-accent size-6"
                              checked={verse.has(s.enrollment_id)}
                              onChange={(event) => flip(setVerse, s.enrollment_id, event.target.checked)}
                            />
                          </label>
                        </td>
                        <td className="px-1 py-0">
                          <label className="flex min-h-12 min-w-12 cursor-pointer items-center justify-center">
                            <input
                              type="checkbox"
                              aria-label={`${s.person.full_name ?? 'This student'} handed in the devotional`}
                              className="accent-accent size-6"
                              checked={devotional.has(s.enrollment_id)}
                              onChange={(event) => flip(setDevotional, s.enrollment_id, event.target.checked)}
                            />
                          </label>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="text-muted px-3 py-2 text-center">At make-up</td>
                        <td className="text-muted px-3 py-2 text-center">At make-up</td>
                      </>
                    )
                  ) : null}
                  <td className="px-3 py-2">{s.cell_leader?.full_name ?? 'none'}</td>
                  <td className="px-3 py-2">{s.guide?.full_name ?? 'none yet'}</td>
                </tr>
              ))}
            </tbody>
          </Table>
          {later.length > 0 ? (
            <p className="text-muted mt-3 text-sm">
              Joined after this lesson, so not marked and making it up instead:{' '}
              {later.map((s) => s.person.full_name ?? 'Somebody').join(', ')}.
            </p>
          ) : null}
          {keeping.length > 0 ? (
            <p className="text-muted mt-3 text-sm">
              Joined at Lesson 6, keeping lessons 1 to 4 from an earlier class:{' '}
              {keeping.map((s) => s.person.full_name ?? 'Somebody').join(', ')}.
            </p>
          ) : null}
          {elsewhere.length > 0 ? (
            <p className="text-muted mt-3 text-sm">
              Already came to this lesson in the class they moved from:{' '}
              {elsewhere
                .map((s) => `${s.person.full_name ?? 'Somebody'} (${markedElsewhere(s, lesson.lesson)})`)
                .join(', ')}
              .
            </p>
          ) : null}
          <p className="mt-4 text-sm" role="status">
            <span className="font-semibold">
              {cameCount} came · {absent.length} absent
              {absent.length > 0 ? ':' : '.'}
            </span>{' '}
            {absent
              .map((s) => `${s.person.full_name ?? 'Somebody'} (Cell leader ${s.cell_leader?.full_name ?? 'none'})`)
              .join(', ')}
            {sol ? (
              <span className="font-semibold">
                {' '}
                · Memory verse {verseCount} · Devotional {devotionalCount}
              </span>
            ) : null}
          </p>
        </>
      )}

      {closed ? (
        <div className="mt-4">
          <Field
            label="Reason for the correction"
            autoComplete="off"
            value={reason}
            maxLength={500}
            onChange={(event) => setReason(event.target.value)}
            description="This lesson's week has closed. Only the Admin corrects it, with a reason."
            required
          />
        </div>
      ) : null}
      <FailureNotice failure={save.isError ? describeFailure(save.error) : null} />
      {/* On a phone Save stays in reach above the tab bar while the list scrolls; on a laptop it
          sits under the list. */}
      <div className="border-line bg-surface sticky bottom-[calc(3.5625rem+env(safe-area-inset-bottom))] z-10 -mx-4 mt-4 flex items-center justify-between gap-3 border-t px-4 py-3 lg:static lg:mx-0 lg:justify-start lg:border-t-0 lg:p-0">
        <span className="text-sm lg:hidden" aria-hidden="true">
          {cameCount} came · {absent.length} absent
        </span>
        <Button type="submit" className="w-auto" disabled={!canSave}>
          Save lesson {lesson.lesson}
        </Button>
      </div>
    </form>
  );
}

/**
 * **Everyone came**, the parent of the ticks (Material Design's parent checkbox, and Canvas Roll
 * Call's Mark All Present with Unmark All): ticked when everybody is, empty when nobody is, and
 * shown part-ticked in between. Ticking it ticks all; unticking it clears all.
 */
function EveryoneCame({
  ticking,
  came,
  setCame,
}: {
  ticking: AttendanceStudent[];
  came: Set<string>;
  setCame: (next: Set<string>) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const ticked = ticking.filter((s) => came.has(s.enrollment_id)).length;
  const all = ticking.length > 0 && ticked === ticking.length;
  const some = ticked > 0 && !all;
  useEffect(() => {
    if (ref.current) {
      ref.current.indeterminate = some;
    }
  }, [some]);
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label="Everyone came"
      className="accent-accent size-6 shrink-0"
      checked={all}
      onChange={(event) =>
        setCame(event.target.checked ? new Set(ticking.map((s) => s.enrollment_id)) : new Set())
      }
    />
  );
}

/**
 * A SOL student's two ticks on a phone card, under the name (decision 0514, point 8, as approved);
 * *At make-up* in their place for somebody not ticked as came (point 9).
 */
function SolTicks({
  student,
  came,
  verse,
  devotional,
  onVerse,
  onDevotional,
}: {
  student: AttendanceStudent;
  came: boolean;
  verse: Set<string>;
  devotional: Set<string>;
  onVerse: (on: boolean) => void;
  onDevotional: (on: boolean) => void;
}) {
  if (!came) {
    return <p className="text-muted px-3 pb-2 pl-12 text-xs">Memory verse and devotional at make-up</p>;
  }
  return (
    <div className="flex flex-col px-3 pb-2 pl-12">
      <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
        <input
          type="checkbox"
          aria-label={`${student.person.full_name ?? 'This student'} recited the memory verse`}
          className="accent-accent size-6 shrink-0"
          checked={verse.has(student.enrollment_id)}
          onChange={(event) => onVerse(event.target.checked)}
        />
        Memory verse
      </label>
      <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
        <input
          type="checkbox"
          aria-label={`${student.person.full_name ?? 'This student'} handed in the devotional`}
          className="accent-accent size-6 shrink-0"
          checked={devotional.has(student.enrollment_id)}
          onChange={(event) => onDevotional(event.target.checked)}
        />
        Devotional
      </label>
    </div>
  );
}

/** A lesson read, for a Guide, the Coordinator, or a lesson whose week has closed. */
function LessonRead({ data, lesson }: { data: ClassAttendance; lesson: ClassLesson }) {
  return (
    <div>
      <h2 id="lesson-heading" className="font-semibold">
        Lesson {lesson.lesson} · {longDay(lesson.held_on ?? lesson.expected_on)} · {STATE_WORDS[lesson.state]}
      </h2>
      {lesson.state !== 'SAVED' ? (
        <p className="text-muted text-sm">
          {lesson.state === 'NOT_YET' ? 'Not held yet.' : 'Not recorded yet.'}
          {data.may_record && !lesson.open ? ' Its week has closed; only the Admin corrects it.' : ''}
        </p>
      ) : (
        <ul className="mt-3 flex flex-col">
          {data.students.map((s) => {
            const mark = markFor(s, lesson.lesson);
            return (
              <li key={s.enrollment_id} className="border-line flex justify-between gap-3 border-t py-2 text-sm">
                <span className="font-semibold">{listName(s.person)}</span>
                <span className={mark && !mark.came && !mark.made_up_on ? 'text-field-invalid font-semibold' : ''}>
                  {mark === null
                    ? 'Not marked'
                    : mark.before_joining
                      ? mark.made_up_on
                        ? 'Made up, joined after it'
                        : 'Joined after it, to make up'
                      : `${mark.came ? 'Came' : mark.made_up_on ? 'Made up' : 'Absent'}${
                          mark.from_class ? `, in ${mark.from_class.name}` : ''
                        }${solItemsWords(mark)}`}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** SOL's two ticks in words, for a lesson read; nothing for Life Class or somebody still to make up. */
function solItemsWords(mark: AttendanceStudent['marks'][number]): string {
  if (mark.verse === undefined || mark.verse === null) {
    return '';
  }
  const verse = mark.verse || mark.verse_brought_on ? 'verse ✓' : 'verse ✗';
  const devotional = mark.devotional || mark.devotional_brought_on ? 'devotional ✓' : 'devotional ✗';
  return ` · ${verse} · ${devotional}`;
}

/**
 * **Make-ups still owed** (decision 0503, the owner's option M2): one row an absence, with
 * *Record make-up*, which asks the make-up's date; it becomes M on the register.
 */
function Owed({ data }: { data: ClassAttendance }) {
  const [making, setMaking] = useState<ClassAttendance['owed'][number] | null>(null);
  if (data.owed.length === 0) {
    return null;
  }
  return (
    <section aria-labelledby="owed-heading" className="border-line bg-surface rounded-xl border p-4">
      <h2 id="owed-heading" className="font-semibold">
        Make-ups still owed · {data.owed.length}
      </h2>
      <p className="text-muted text-sm">
        After playing Bishop Oriel&rsquo;s recorded teaching for that lesson, record it here. It becomes M on the
        register.
      </p>
      <ul className="mt-3 flex flex-col">
        {data.owed.map((each) => (
          <li
            key={`${each.enrollment_id}:${each.lesson}`}
            className="border-line flex flex-wrap items-center justify-between gap-3 border-t py-2"
          >
            <span>
              <span className="font-semibold">{listName(each.person)}</span> · L{each.lesson}
              {each.before_joining
                ? ', held before they joined'
                : each.held_on
                  ? `, missed ${longDay(each.held_on)}`
                  : ''}
              <span className="text-muted block text-xs">
                Cell leader {each.cell_leader?.full_name ?? 'none'}
                {each.before_joining ? ' · not counted as an absence' : ''}
              </span>
            </span>
            {data.may_record ? (
              <Button type="button" variant="secondary" className="w-auto" onClick={() => setMaking(each)}>
                Record make-up
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {/* Keyed by the absence, so each opens on today's date. */}
      <MakeUpDialog
        key={making ? `${making.enrollment_id}:${making.lesson}` : 'none'}
        classId={data.class.id}
        sol={data.class.level !== 'LIFE_CLASS'}
        owed={making}
        onClose={() => setMaking(null)}
      />
    </section>
  );
}

function manilaToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
}

function MakeUpDialog({
  classId,
  sol,
  owed,
  onClose,
}: {
  classId: string;
  sol: boolean;
  owed: ClassAttendance['owed'][number] | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [madeUpOn, setMadeUpOn] = useState(manilaToday());
  // SOL's make-up says whether the verse was recited and the devotional handed in (0514, point 9).
  const [verse, setVerse] = useState(false);
  const [devotional, setDevotional] = useState(false);
  const [writeKey, renewWriteKey] = useWriteKey();
  const save = useMutation({
    mutationFn: () => {
      const body = {
        enrollment_id: owed!.enrollment_id,
        lesson: owed!.lesson,
        made_up_on: madeUpOn,
        ...(sol ? { verse, devotional } : {}),
      };
      return recordMakeUp(classId, body, idempotencyKeyFor('equipping-make-up', writeKey, { classId, ...body }));
    },
    onSuccess: async () => {
      renewWriteKey();
      await queryClient.invalidateQueries({ queryKey: ['equipping'] });
      onClose();
    },
  });
  return (
    <Dialog
      open={owed !== null}
      onClose={onClose}
      title={owed ? `Make-up for ${owed.person.full_name ?? 'this student'} · L${owed.lesson}` : 'Make-up'}
    >
      {owed?.held_on ? <p className="text-muted text-sm">Missed {longDay(owed.held_on)}.</p> : null}
      <div className="mt-4">
        <Field
          label="Date of the make-up"
          type="date"
          autoComplete="off"
          value={madeUpOn}
          onChange={(event) => setMadeUpOn(event.target.value)}
          required
        />
      </div>
      {sol && owed ? (
        <div className="mt-3 flex flex-col">
          <label className="flex min-h-11 cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              className="accent-accent size-6 shrink-0"
              checked={verse}
              onChange={(event) => setVerse(event.target.checked)}
            />
            Recited the L{owed.lesson} memory verse
          </label>
          <label className="flex min-h-11 cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              className="accent-accent size-6 shrink-0"
              checked={devotional}
              onChange={(event) => setDevotional(event.target.checked)}
            />
            Handed in the L{owed.lesson} devotional
          </label>
        </div>
      ) : null}
      <FailureNotice failure={save.isError ? describeFailure(save.error) : null} />
      <DialogActions>
        <Button type="button" disabled={save.isPending || madeUpOn === ''} onClick={() => save.mutate()}>
          Record make-up
        </Button>
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/**
 * **Attendance so far** (decision 0501, point 10): a row per student and a column per lesson, ✓
 * came, ✗ absent, M made up, – not yet, and a total, never colour alone.
 */
function Register({ data }: { data: ClassAttendance }) {
  return (
    <section aria-labelledby="register-heading" className="border-line bg-surface rounded-xl border p-4">
      <h2 id="register-heading" className="font-semibold">
        Attendance so far
      </h2>
      <p className="text-muted text-sm">✓ came · ✗ absent · M made up · – not yet · ○ before they joined</p>
      {data.students.length === 0 ? (
        <p className="text-muted mt-3 text-sm">Nobody is enrolled yet.</p>
      ) : (
        // Positioned, so the sr-only words in each cell, which are absolute, scroll inside it rather
        // than widening the page at 320px.
        <div className="relative mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Attendance so far, lesson by lesson</caption>
            <thead>
              <tr>
                <th scope="col" className="px-2 py-2 text-left">
                  Student
                </th>
                {COLUMNS.map((n) => (
                  <th key={n} scope="col" className="px-2 py-2">
                    {lessonLabel(n)}
                  </th>
                ))}
                <th scope="col" className="px-2 py-2 text-left">
                  Came
                </th>
              </tr>
            </thead>
            <tbody>
              {data.students.map((s) => {
                const kept = s.marks.filter((m) => m.came || m.made_up_on !== null).length;
                // A lesson held before they joined and not yet made up is not counted against
                // them (decision 0503).
                const counted = s.marks.filter((m) => !(m.before_joining && m.made_up_on === null)).length;
                // Lessons 1 to 4 kept by one joined at Lesson 6 are named as that, not as a move.
                const moved = s.marks.filter((m) => m.from_class !== null && !(s.carried && m.lesson <= 4));
                const joinedLater = s.marks.some((m) => m.before_joining);
                return (
                  <tr key={s.enrollment_id} className="border-line border-t">
                    <th scope="row" className="px-2 py-2 text-left font-semibold whitespace-nowrap">
                      {listName(s.person)}
                      {moved.length > 0 ? (
                        <span className="text-muted block text-xs font-normal">
                          Moved from {[...new Set(moved.map((m) => m.from_class!.name))].join(', ')} ·{' '}
                          {moved.map((m) => `L${m.lesson}`).join(', ')} there
                        </span>
                      ) : null}
                      {joinedLater ? (
                        <span className="text-muted block text-xs font-normal">Joined {longDay(s.joined_on)}</span>
                      ) : null}
                      {s.carried ? (
                        <span className="text-muted block text-xs font-normal">
                          Joins at Lesson 6 · L1 to L4 and ENC kept from {s.carried.class_name}, {termLabel(s.carried)}
                        </span>
                      ) : null}
                    </th>
                    {COLUMNS.map((n) => {
                      const mark = n === 5 ? null : markFor(s, n);
                      // ENC is the Registrar's record of the weekend (decision 0507).
                      const sign =
                        n === 5
                          ? s.encounter === 'CAME'
                            ? '✓'
                            : s.encounter === 'MISSED'
                              ? '✗'
                              : '–'
                          : mark === null
                          ? '–'
                          : mark.came
                            ? '✓'
                            : mark.made_up_on
                              ? 'M'
                              : mark.before_joining
                                ? '○'
                                : '✗';
                      return (
                        <td
                          key={n}
                          className={cn('px-2 py-2 text-center', sign === '✗' && 'text-field-invalid font-semibold')}
                        >
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
                    <td className="px-2 py-2 whitespace-nowrap">
                      {kept} of {counted}
                    </td>
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
