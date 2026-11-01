'use client';

import { useMemo, useState } from 'react';

import { AppShell, PAGE_WIDTH } from '@/components/app-shell';
import { GrowthSaveBar, GrowthTabs, longDay } from '@/components/growth-controls';
import { isBranchReader } from '@/components/reports-tabs';
import {
  GrowthFailure,
  GrowthListControls,
  GrowthPersonName,
  GrowthRows,
  GrowthSaveFailure,
  useGrowthList,
  useGrowthSave,
} from '@/components/growth-list';
import { Button } from '@/components/ui/button';
import { HeaderCell, Table, rowClasses } from '@/components/ui/table';
import {
  getSuynlCounts,
  listSuynlPeople,
  submitSuynl,
  type SuynlChange,
  type SuynlPerson,
} from '@/lib/growth';

/**
 * The SUYNL tab of Growth (SKILL.md section 28; decisions 0278 to 0282, and the owner's
 * choice of 2026-09-24).
 *
 * **Ten boxes a person, and a draft saved whole or not at all.** A tick is not filed as
 * it is made: a lesson filed is a dated statement naming a leader, so a mis-tap must not
 * file one. Nothing is typed as a date, because a lesson carries the day it was filed.
 *
 * **Two cards, Not started and In progress, that add up to everyone still to finish**
 * (decision 0386), each narrowing the list to its people. Graduated is hidden rather than
 * withdrawn: the list says nothing of those who have finished and offers no Show everyone, a
 * graduate is found by a search, and both addresses (`step=GRADUATED`, `all=1`) still answer.
 * A person who has done all ten folds to one line with the day the tenth was filed, and
 * an Edit lessons action that opens the ten boxes again, and Close to fold them back
 * while nothing has changed.
 *
 * **A row the reader may not file for shows marks rather than boxes** (`may_file`),
 * which covers the reader's own row (decision 0280). The API decides; this only shows
 * what it decided.
 */
export default function SuynlPage() {
  return (
    <AppShell>
      <SuynlTab />
    </AppShell>
  );
}

const LESSONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

interface DraftEntry {
  person_id: string;
  full_name: string;
  lesson: number;
  done: boolean;
  seen_id: string | null;
}

function keyOf(personId: string, lesson: number): string {
  return `${personId}|${lesson}`;
}

function SuynlTab() {
  const list = useGrowthList({
    name: 'suynl',
    getCounts: getSuynlCounts,
    listPeople: listSuynlPeople,
  });
  const { me, counts, rows } = list;

  const [draft, setDraft] = useState<Record<string, DraftEntry>>({});
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState('');
  const [saved, setSaved] = useState(false);

  const entries = Object.values(draft);
  const needsReason = entries.some((entry) => !entry.done);

  const changes = useMemo(
    (): SuynlChange[] =>
      Object.values(draft).map((entry) => ({
        person_id: entry.person_id,
        lesson: entry.lesson,
        done: entry.done,
        seen_id: entry.seen_id,
        ...(entry.done ? {} : { reason: reason.trim() }),
      })),
    [draft, reason],
  );

  const growthSave = useGrowthSave({
    list,
    changes,
    submit: submitSuynl,
    setDraft,
    keep: (entry, byPerson) => {
      const row = byPerson.get(entry.person_id);
      if (row === undefined) {
        return true;
      }
      const stored = row.lessons.find((lesson) => lesson.lesson === entry.lesson) ?? null;
      return (stored?.id ?? null) === entry.seen_id && (stored !== null) !== entry.done;
    },
    onSaved: () => {
      setDraft({});
      setOpened(new Set());
      setReason('');
      setSaved(true);
    },
  });
  const { save } = growthSave;

  function toggle(row: SuynlPerson, lesson: number) {
    const stored = row.lessons.find((entry) => entry.lesson === lesson) ?? null;
    const key = keyOf(row.person_id, lesson);
    const shown = draft[key]?.done ?? stored !== null;

    setSaved(false);
    setDraft((current) => {
      const next = { ...current };
      if (!shown === (stored !== null)) {
        delete next[key];
      } else {
        next[key] = {
          person_id: row.person_id,
          full_name: row.full_name,
          lesson,
          done: !shown,
          seen_id: stored?.id ?? null,
        };
      }
      return next;
    });
  }

  function close(row: SuynlPerson) {
    const next = new Set(opened);
    next.delete(row.person_id);
    setOpened(next);
  }

  const cards = [
    {
      step: 'NOT_STARTED',
      label: 'Not started',
      count: counts.data?.not_started,
    },
    {
      step: 'IN_PROGRESS',
      label: 'In progress',
      count: counts.data?.in_progress,
    },
  ];

  return (
    <main id="main" className={PAGE_WIDTH.INDEX}>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {/* SUYNL is an item of its own on the recording screens (decision 0323) and for a
              Full view leader (decision 0383). */}
          {me.isPending
            ? null
            : me.data?.screens === 'RECORDING' || isBranchReader(me.data)
              ? 'SUYNL'
              : 'Growth'}
        </h1>
        <p className="text-muted text-sm">
          {counts.data
            ? `${counts.data.people} ${counts.data.people === 1 ? 'person' : 'people'} you oversee, as of today.`
            : 'The people you oversee, as of today.'}{' '}
          SUYNL is Start Up Your New Life, ten lessons taken one to one.
        </p>
      </div>

      <GrowthTabs current="/growth/suynl">

        {/* No line counting those who have finished, and no Show everyone (decision 0386). */}
        <GrowthListControls list={list} cards={cards} />

        <GrowthFailure list={list} />

        <GrowthRows list={list}>
          <Table caption="SUYNL lessons for the people you oversee" className="hidden lg:block">
            <thead>
              <tr>
                <HeaderCell>Person</HeaderCell>
                {LESSONS.map((lesson) => (
                  <HeaderCell key={lesson} className="px-1 text-center">
                    {lesson}
                  </HeaderCell>
                ))}
                <HeaderCell className="text-right">Lessons</HeaderCell>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.person_id} className={rowClasses}>
                  <td className="px-3 py-3 align-top">
                    <GrowthPersonName row={row} self={row.person_id === me.data?.person_id} />
                  </td>
                  {folded(row, opened, draft) ? (
                    <td colSpan={10} className="px-1 py-3 align-top">
                      <Graduated
                        row={row}
                        onCorrect={() => setOpened(new Set(opened).add(row.person_id))}
                      />
                    </td>
                  ) : (
                    LESSONS.map((lesson) => (
                      <td key={lesson} className="px-1 py-3 text-center align-top">
                        <LessonBox row={row} lesson={lesson} draft={draft} onToggle={toggle} />
                      </td>
                    ))
                  )}
                  <td className="px-3 py-3 text-right align-top tabular-nums">
                    {doneCount(row, draft)} of 10
                    {closable(row, opened, draft) ? (
                      <Button
                        variant="secondary"
                        className="mt-2"
                        aria-label={`Close, ${row.full_name}`}
                        onClick={() => close(row)}
                      >
                        Close
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>

          <ul className="border-line divide-line divide-y border-t border-b lg:hidden">
            {rows.map((row) => (
              <li key={row.person_id} className="py-4">
                <div className="flex items-start justify-between gap-3">
                  <GrowthPersonName row={row} self={row.person_id === me.data?.person_id} />
                  <span className="text-sm tabular-nums">{doneCount(row, draft)} of 10</span>
                </div>
                {folded(row, opened, draft) ? (
                  <div className="mt-2">
                    <Graduated
                      row={row}
                      onCorrect={() => setOpened(new Set(opened).add(row.person_id))}
                    />
                  </div>
                ) : (
                  <div className="mt-3 grid w-fit grid-cols-5 gap-x-4 gap-y-2">
                    {LESSONS.map((lesson) => (
                      <div key={lesson} className="flex flex-col items-center gap-1">
                        <span aria-hidden="true" className="text-muted text-xs">
                          {lesson}
                        </span>
                        <LessonBox row={row} lesson={lesson} draft={draft} onToggle={toggle} />
                      </div>
                    ))}
                  </div>
                )}
                {closable(row, opened, draft) ? (
                  <Button
                    variant="secondary"
                    className="mt-3"
                    aria-label={`Close, ${row.full_name}`}
                    onClick={() => close(row)}
                  >
                    Close
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </GrowthRows>

        <GrowthSaveBar
          failure={<GrowthSaveFailure growthSave={growthSave} />}
          failing={growthSave.stale}
          summary={
            entries.length > 0
              ? `${entries.length === 1 ? '1 lesson' : `${entries.length} lessons`} ticked or unticked, not saved yet.`
              : saved
                ? 'Saved.'
                : null
          }
          count={entries.length}
          needsReason={needsReason}
          reason={reason}
          onReason={setReason}
          onSave={() => save.mutate()}
          onDiscard={() => {
            setDraft({});
            setOpened(new Set());
            setReason('');
            save.reset();
          }}
          saving={save.isPending}
        />
      </GrowthTabs>
    </main>
  );
}

function LessonBox({
  row,
  lesson,
  draft,
  onToggle,
}: {
  row: SuynlPerson;
  lesson: number;
  draft: Record<string, DraftEntry>;
  onToggle: (row: SuynlPerson, lesson: number) => void;
}) {
  const stored = row.lessons.find((entry) => entry.lesson === lesson) ?? null;
  const done = draft[keyOf(row.person_id, lesson)]?.done ?? stored !== null;
  const filed = stored ? `, filed ${longDay(stored.filed_on)}` : '';
  const label = `Lesson ${lesson}${filed}, ${row.full_name}`;

  if (!row.may_file) {
    return (
      <span className="inline-flex size-6 items-center justify-center text-sm">
        <span aria-hidden="true">{done ? '✓' : '–'}</span>
        <span className="sr-only">
          {label}: {done ? 'done' : 'not done'}
        </span>
      </span>
    );
  }

  return (
    <input
      type="checkbox"
      aria-label={label}
      checked={done}
      onChange={() => onToggle(row, lesson)}
      className="accent-accent focus-visible:outline-accent size-6 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2"
    />
  );
}

function Graduated({ row, onCorrect }: { row: SuynlPerson; onCorrect: () => void }) {
  return (
    <p className="flex flex-wrap items-center gap-3 text-sm">
      <span>Graduated {row.graduated_on ? longDay(row.graduated_on) : ''}</span>
      {row.may_file ? (
        <Button variant="secondary" onClick={onCorrect}>
          Edit
        </Button>
      ) : null}
    </p>
  );
}

/** Opened with Edit and nothing changed yet: Close folds it again. */
function closable(
  row: SuynlPerson,
  opened: Set<string>,
  draft: Record<string, DraftEntry>,
): boolean {
  return (
    row.graduated_on !== null &&
    opened.has(row.person_id) &&
    !Object.values(draft).some((entry) => entry.person_id === row.person_id)
  );
}

/** Folded to one line: all ten done, not opened for correcting, and nothing in the draft. */
function folded(row: SuynlPerson, opened: Set<string>, draft: Record<string, DraftEntry>): boolean {
  return (
    row.graduated_on !== null &&
    !opened.has(row.person_id) &&
    !Object.values(draft).some((entry) => entry.person_id === row.person_id)
  );
}

function doneCount(row: SuynlPerson, draft: Record<string, DraftEntry>): number {
  return LESSONS.filter(
    (lesson) =>
      draft[keyOf(row.person_id, lesson)]?.done ??
      row.lessons.some((entry) => entry.lesson === lesson),
  ).length;
}
