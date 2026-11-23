'use client';

import { useState, type ReactNode } from 'react';

import { timeLabel } from '@/lib/cells';
import {
  DAY_NAMES,
  type ClassGrades,
  type EncounterSign,
  type FinalGrade,
  type GradesStatus,
} from '@/lib/equipping';
import { cn } from '@/lib/utils';

const COLUMNS = ['L1', 'L2', 'L3', 'L4', 'ENC', 'L6', 'L7', 'L8', 'L9'];
const WORDS: Record<FinalGrade, string> = {
  PASSED: 'Passed',
  NOT_PASSED: 'Not passed',
  NOT_YET: 'Not yet',
};
const ICON: Record<FinalGrade, string> = { PASSED: '✓', NOT_PASSED: '✗', NOT_YET: '…' };
/** What needs a look first, as Google Classroom puts missing work in front (decision 0508). */
const ORDER: Record<FinalGrade, number> = { NOT_PASSED: 0, NOT_YET: 1, PASSED: 2 };
const SIGNS: Record<EncounterSign, { sign: string; words: string }> = {
  CAME: { sign: '✓', words: 'came' },
  MADE_UP: { sign: 'M', words: 'made up' },
  ABSENT: { sign: '✗', words: 'absent' },
  BEFORE_JOINING: { sign: '○', words: 'before they joined' },
  NONE: { sign: '–', words: 'not marked' },
};

function shortDay(at: string): string {
  return new Date(at).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'Asia/Manila',
  });
}

/** A class's state in a few words, for its button and its heading (decision 0508). */
export function phaseWords(status: GradesStatus): string {
  switch (status.phase) {
    case 'NOT_READY':
      return `Lessons to record: ${status.missing_lessons.map((n) => `L${n}`).join(', ')}`;
    case 'WAITING_COORDINATOR':
      return 'Waiting for the Coordinator';
    case 'WAITING_ADMIN':
      return `Waiting for the Admin (${status.disciples_for_admin} ${
        status.disciples_for_admin === 1 ? 'disciple' : 'disciples'
      })`;
    case 'READY':
      return 'Ready to post';
    case 'POSTED':
      return `Posted ${shortDay(status.posted!.at)}`;
  }
}

function GradeTag({ grade }: { grade: FinalGrade }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold whitespace-nowrap',
        grade === 'NOT_PASSED' ? 'border-field-invalid text-field-invalid' : 'border-line',
      )}
    >
      <span aria-hidden="true">{ICON[grade]}</span>
      {WORDS[grade]}
    </span>
  );
}

function Mark({ sign }: { sign: EncounterSign }) {
  return (
    <>
      <span aria-hidden="true">{SIGNS[sign].sign}</span>
      <span className="sr-only">{SIGNS[sign].words}</span>
    </>
  );
}

function lessonsLine(s: ClassGrades['students'][number]): string {
  return `${s.lessons_kept} of 9${s.lessons_made_up > 0 ? ` · ${s.lessons_made_up} made up` : ''}`;
}

/**
 * **A class's final grades** (decision 0508, the owner's version B): where the class stands in
 * three steps, filters by grade, and each student with their grade and its reason beside the
 * name, the register after it. A table on a laptop, the name held in place; a card each on a
 * phone, the grade on its first line.
 */
export function GradesPanel({
  data,
  coordinatorView,
  action,
}: {
  data: ClassGrades;
  coordinatorView: boolean;
  action: ReactNode;
}) {
  const [filter, setFilter] = useState<FinalGrade | 'ALL'>('ALL');
  const { status } = data;
  const rows = [...data.students]
    .filter((s) => filter === 'ALL' || s.grade === filter)
    .sort(
      (a, b) =>
        ORDER[a.grade] - ORDER[b.grade] ||
        (a.person.full_name ?? '').localeCompare(b.person.full_name ?? ''),
    );
  const chips: { key: FinalGrade | 'ALL'; label: string }[] = [
    { key: 'ALL', label: `All · ${data.students.length}` },
    { key: 'NOT_PASSED', label: `Not passed · ${status.counts.not_passed}` },
    { key: 'NOT_YET', label: `Not yet · ${status.counts.not_yet}` },
    { key: 'PASSED', label: `Passed · ${status.counts.passed}` },
  ];
  const checked = status.admin_check ?? status.coordinator_check;
  const steps = [
    {
      label: 'Lessons recorded',
      done: status.missing_lessons.length === 0,
      detail:
        status.missing_lessons.length === 0
          ? 'Every lesson saved'
          : `To record: ${status.missing_lessons.map((n) => `L${n}`).join(', ')}`,
    },
    {
      label: 'Checked',
      done: status.phase === 'READY' || status.phase === 'POSTED',
      detail:
        status.phase === 'WAITING_ADMIN'
          ? `${status.coordinator_check?.by ?? 'The Coordinator'}, ${shortDay(
              status.coordinator_check!.at,
            )} · the Admin checks ${status.disciples_for_admin}`
          : checked
            ? `${checked.by ?? 'Checked'}, ${shortDay(checked.at)}${
                status.admin_check && status.coordinator_check ? ' · and the Admin' : ''
              }`
            : 'Not yet',
    },
    {
      label: 'Posted',
      done: status.phase === 'POSTED',
      detail: status.posted ? shortDay(status.posted.at) : 'Not yet',
    },
  ];

  return (
    <section aria-labelledby="grades-heading" className="border-line bg-surface rounded-xl border p-4">
      <h2 id="grades-heading" className="font-semibold">
        {data.class.name} · {DAY_NAMES[data.class.day_of_week - 1].slice(0, 3)}{' '}
        {timeLabel(data.class.time_of_day)} · {data.students.length}{' '}
        {data.students.length === 1 ? 'student' : 'students'}
      </h2>
      <ol className="mt-3 grid gap-2 sm:grid-cols-3" aria-label="Where this class stands">
        {steps.map((s, i) => (
          <li
            key={s.label}
            className={cn('rounded-lg border px-3 py-2', s.done ? 'border-accent bg-accent-soft' : 'border-line')}
          >
            <span className="text-sm font-semibold">
              <span aria-hidden="true">{s.done ? '✓ ' : `${i + 1} `}</span>
              {s.label}
              <span className="sr-only">{s.done ? ', done' : ', not yet'}</span>
            </span>
            <span className="text-muted block text-xs">{s.detail}</span>
          </li>
        ))}
      </ol>

      {data.students.length === 0 ? (
        <p className="text-muted mt-4 text-sm">Nobody is enrolled in this class.</p>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Show">
            {chips.map((c) => (
              <button
                key={c.key}
                type="button"
                aria-pressed={filter === c.key}
                onClick={() => setFilter(c.key)}
                className={cn(
                  'min-h-11 rounded-full border px-4 text-sm',
                  filter === c.key ? 'border-accent bg-accent-soft font-semibold' : 'border-line bg-surface',
                )}
              >
                {c.label}
              </button>
            ))}
          </div>

          <div className="border-line relative mt-3 hidden overflow-x-auto rounded-lg border lg:block">
            <table className="w-full text-sm">
              <caption className="sr-only">Final grades, {data.class.name}</caption>
              <thead className="bg-raised">
                <tr>
                  <th scope="col" className="bg-raised sticky left-0 px-3 py-2 text-left">
                    Student
                  </th>
                  <th scope="col" className="px-3 py-2 text-left">
                    Grade
                  </th>
                  <th scope="col" className="px-3 py-2 text-left">
                    Why
                  </th>
                  {COLUMNS.map((c) => (
                    <th key={c} scope="col" className="text-muted px-1.5 py-2 text-center font-normal">
                      {c}
                    </th>
                  ))}
                  <th scope="col" className="px-3 py-2 text-left">
                    Lessons
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.enrollment_id} className="border-line border-t">
                    <th scope="row" className="bg-surface sticky left-0 px-3 py-2 text-left font-semibold whitespace-nowrap">
                      {s.person.full_name}
                      {coordinatorView && s.your_disciple ? (
                        <span className="text-muted block text-xs font-normal">Your disciple: the Admin checks</span>
                      ) : null}
                    </th>
                    <td className="px-3 py-2">
                      <GradeTag grade={s.grade} />
                    </td>
                    <td className="px-3 py-2">{s.reason}</td>
                    {s.lessons.map((sign, i) => (
                      <td
                        key={i}
                        className={cn('px-1.5 py-2 text-center', sign === 'ABSENT' && 'text-field-invalid font-semibold')}
                      >
                        <Mark sign={sign} />
                      </td>
                    ))}
                    <td className="text-muted px-3 py-2 whitespace-nowrap">{lessonsLine(s)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="mt-3 flex flex-col gap-3 lg:hidden">
            {rows.map((s) => (
              <li key={s.enrollment_id} className="border-line rounded-lg border px-3 py-2">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-semibold">{s.person.full_name}</span>
                  <GradeTag grade={s.grade} />
                </div>
                {coordinatorView && s.your_disciple ? (
                  <p className="text-muted text-xs">Your disciple: the Admin checks</p>
                ) : null}
                <p className="text-sm">{s.reason}</p>
                <p className="text-muted mt-1 flex flex-wrap gap-x-2 text-xs">
                  {s.lessons.map((sign, i) => (
                    <span key={i} className={cn(sign === 'ABSENT' && 'text-field-invalid font-semibold')}>
                      {COLUMNS[i]} <Mark sign={sign} />
                    </span>
                  ))}
                </p>
                <p className="text-muted text-xs">Lessons {lessonsLine(s)}</p>
              </li>
            ))}
          </ul>
          <p className="text-muted mt-3 text-sm">✓ came · ✗ absent · M made up · – not marked</p>
        </>
      )}
      <div className="mt-4">{action}</div>
    </section>
  );
}
