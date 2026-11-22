'use client';

import Link from 'next/link';
import { useState } from 'react';

import { TeachFrame } from '@/components/teach-frame';
import { ViewSwitch } from '@/components/ui/view-switch';
import { timeLabel } from '@/lib/cells';
import { DAY_NAMES, type MyClass, type MyPerson } from '@/lib/equipping';
import { useMyClasses } from '@/lib/my-classes';
import { cn } from '@/lib/utils';

type Level = 'LIFE_CLASS' | 'SOL_1' | 'SOL_2' | 'SOL_3';

const LEVELS: readonly { key: Level; label: string }[] = [
  { key: 'LIFE_CLASS', label: 'Life Class' },
  { key: 'SOL_1', label: 'SOL 1' },
  { key: 'SOL_2', label: 'SOL 2' },
  { key: 'SOL_3', label: 'SOL 3' },
];

/** Lessons 1 to 9, the Encounter taking lesson 5's place (decision 0503). */
const COLUMNS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

/**
 * **A leader's Equipping** (decision 0501, point 21; decision 0504): one level at a time, *Life
 * Class*, *SOL 1*, *SOL 2* and *SOL 3*, each with the classes the reader teaches or guides
 * (grouped by what the reader does in each, *Classes you teach* first, as Google Classroom splits
 * Teaching from Enrolled) and then their people in the school, read only, their own twelve first
 * and then each of the twelve's people under that leader's name. The item is drawn only while
 * there is a class or a person.
 */
export default function TeachPage() {
  const { classes: unsorted, people, loading } = useMyClasses();
  const [level, setLevel] = useState<Level>('LIFE_CLASS');
  // Every class the school runs is Life Class today (decision 0499).
  const classes = level === 'LIFE_CLASS' ? [...unsorted].sort((a, b) => a.name.localeCompare(b.name)) : [];
  const teaching = classes.filter((each) => each.role === 'TEACHER');
  const guiding = classes.filter((each) => each.role === 'GUIDE');
  const atLevel = people.filter((each) => each.level === level);
  const name = LEVELS.find((each) => each.key === level)!.label;
  return (
    <TeachFrame title="Equipping" lead="Your classes and your people in the school.">
      {loading ? (
        <p className="text-muted text-sm">Loading…</p>
      ) : (
        <div className="flex flex-col gap-6">
          <ViewSwitch<Level> label="Level" options={LEVELS} value={level} onChange={setLevel} className="mt-0 lg:self-start" />
          <ClassGroup title="Classes you teach" note="You record each lesson and its make-ups." classes={teaching} />
          <ClassGroup title="Classes you guide" note="You see your own students. You record nothing." classes={guiding} />
          <PeopleGroup level={name} people={atLevel} nothingElse={classes.length === 0} />
        </div>
      )}
    </TeachFrame>
  );
}

function ClassGroup({ title, note, classes }: { title: string; note: string; classes: MyClass[] }) {
  if (classes.length === 0) {
    return null;
  }
  return (
    <section aria-label={title}>
      <h2 className="font-semibold">
        {title} · {classes.length}
      </h2>
      <p className="text-muted text-sm">{note}</p>
      <ul className="mt-3 flex flex-col gap-3">
        {classes.map((each) => (
          <li key={each.id}>
            <Link
              href={`/equipping/teach/${each.id}`}
              className="border-line bg-surface hover:bg-raised flex min-h-13 flex-col rounded-xl border px-4 py-3"
            >
              <span className="font-semibold">{each.name}</span>
              <span className="text-muted text-sm">
                {DAY_NAMES[each.day_of_week - 1]} {timeLabel(each.time_of_day)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * **The reader's people at one level** (decision 0501, point 5): a card each, their own twelve
 * first and then each of the twelve's people under that leader's name, in first-name order
 * (decision 0359). Read only; nothing is sent.
 */
function PeopleGroup({ level, people, nothingElse }: { level: string; people: MyPerson[]; nothingElse: boolean }) {
  if (people.length === 0) {
    return nothingElse ? <p className="text-muted text-sm">None of your people are in {level} this term.</p> : null;
  }
  const twelve = people.filter((each) => each.twelve);
  const throughs = new Map<string, { name: string; people: MyPerson[] }>();
  const others: MyPerson[] = [];
  for (const each of people) {
    if (each.twelve) {
      continue;
    }
    if (each.through === null) {
      others.push(each);
      continue;
    }
    const group = throughs.get(each.through.id) ?? { name: each.through.full_name ?? 'Somebody', people: [] };
    group.people.push(each);
    throughs.set(each.through.id, group);
  }
  const groups = [
    ...(twelve.length > 0 ? [{ key: 'twelve', title: 'Your 12', people: twelve }] : []),
    // In the order the server gives, which orders the leaders by first name (decision 0504).
    ...[...throughs.entries()].map(([id, group]) => ({ key: id, title: `${group.name}’s people`, people: group.people })),
    ...(others.length > 0 ? [{ key: 'others', title: 'Others', people: others }] : []),
  ];
  return (
    <section aria-label={`Your people in ${level}`}>
      <h2 className="font-semibold">
        Your people in {level} · {people.length}
      </h2>
      <p className="text-muted text-sm">View only. Your 12 first, then everyone beneath them.</p>
      {groups.map((group) => (
        <div key={group.key} className="mt-4">
          <h3 className="text-sm font-semibold">
            {group.title} · {group.people.length}
          </h3>
          <ul className="mt-2 grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
            {group.people.map((each) => (
              <PersonCard key={each.enrollment_id} person={each} />
            ))}
          </ul>
        </div>
      ))}
      <p className="text-muted mt-3 text-sm">✓ came · ✗ absent · M made up · – not yet · ○ before they joined</p>
    </section>
  );
}

function PersonCard({ person }: { person: MyPerson }) {
  const markFor = (n: number) => person.marks.find((m) => m.lesson === n) ?? null;
  // Counted as the class's own register counts them (decision 0503): a lesson held before they
  // joined and not yet made up is not counted against them.
  const kept = person.marks.filter((m) => m.came || m.made_up_on !== null).length;
  const counted = person.marks.filter((m) => !(m.before_joining && m.made_up_on === null)).length;
  const owed = person.marks.filter((m) => !m.came && m.made_up_on === null).map((m) => `L${m.lesson}`);
  return (
    <li className="border-line bg-surface rounded-xl border px-4 py-3">
      <p className="font-semibold">{person.person.full_name}</p>
      <p className="text-muted text-sm">
        {person.class.name} · Teacher {person.teacher?.full_name ?? 'not named yet'}
      </p>
      <p className="text-muted text-sm">Guide: {person.guide?.full_name ?? 'No Guide yet'}</p>
      <div className="relative mt-2 overflow-x-auto">
        <table className="w-full text-center text-sm">
          <caption className="sr-only">{person.person.full_name}’s lessons</caption>
          <thead>
            <tr>
              {COLUMNS.map((n) => (
                <th key={n} scope="col" className="text-muted px-1 py-1 font-normal">
                  {n === 5 ? 'ENC' : `L${n}`}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {COLUMNS.map((n) => {
                const mark = n === 5 ? null : markFor(n);
                // ENC is the Registrar's record of the weekend (decision 0507).
                const sign =
                  n === 5
                    ? person.encounter === 'CAME'
                      ? '✓'
                      : person.encounter === 'MISSED'
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
                  <td key={n} className={cn('px-1 py-1', sign === '✗' && 'text-field-invalid font-semibold')}>
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
            </tr>
          </tbody>
        </table>
      </div>
      <p className={cn('mt-2 text-sm', owed.length > 0 && 'font-semibold')}>
        {kept} of {counted} came{owed.length > 0 ? ` · ${owed.join(', ')} not made up yet` : ''}
      </p>
    </li>
  );
}
