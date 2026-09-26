'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';

import { AppShell, PAGE_WIDTH } from '@/components/app-shell';
import {
  GrowthCards,
  GrowthFilters,
  GrowthSaveBar,
  GrowthTabs,
  StillToFinish,
  longDay,
} from '@/components/growth-controls';
import { Button } from '@/components/ui/button';
import { FailureNotice } from '@/components/ui/failure-notice';
import { HeaderCell, Table, rowClasses } from '@/components/ui/table';
import { ApiRequestError } from '@/lib/api-client';
import {
  PROGRAM_LABELS,
  TRAINING_PROGRAMS,
  getTrainingCounts,
  listTrainingPeople,
  submitTraining,
  type TrainingChange,
  type TrainingPerson,
  type TrainingProgram,
} from '@/lib/growth';
import { idempotencyKeyFor } from '@/lib/idempotency';
import { getMe } from '@/lib/me';
import { describeFailure } from '@/lib/messages';
import { todayInManila } from '@/lib/reporting-month';
import { usePageSize } from '@/lib/page-size';
import { useScreenAddress } from '@/lib/screen-address';

/**
 * The Training tab of Growth (SKILL.md section 28; decisions 0278 to 0282, and the owner's
 * choice of 2026-09-24).
 *
 * **Five graduations, the Encounter first, and the order shown and never required.** A
 * row reads "2 of 5" rather than naming a next school, and a person with all five
 * reads "All five" in plain text: a tag coloured for them would colour a person by a
 * figure (sections 17 and 19).
 *
 * **A graduation carries a date where the leader knows it.** A new tick offers a date
 * and leaves it blank if nobody knows. Changing the date of a saved graduation is a
 * correction, as unticking one is, so the save bar asks why.
 */
export default function TrainingPage() {
  return (
    <AppShell>
      <TrainingTab />
    </AppShell>
  );
}


interface DraftEntry {
  person_id: string;
  full_name: string;
  program: TrainingProgram;
  graduated: boolean;
  graduated_on: string | null;
  seen_id: string | null;
  /** The saved date, where one is saved, so an unchanged re-date is no change. */
  stored_on: string | null;
}

function keyOf(personId: string, program: TrainingProgram): string {
  return `${personId}|${program}`;
}

/** Whether an entry differs from what is saved. */
function isChange(entry: DraftEntry): boolean {
  if (entry.seen_id === null) {
    return entry.graduated;
  }
  return !entry.graduated || entry.graduated_on !== entry.stored_on;
}

function TrainingTab() {
  const search = useSearchParams();
  const go = useScreenAddress();
  const queryClient = useQueryClient();
  const q = search.get('q') ?? '';
  const mine = search.get('mine') === '1';
  const step = search.get('step');
  const everyone = search.get('all') === '1';
  // Opens on those still to finish (decision 0287); a card, a search, Only my disciples or
  // Show everyone widens it.
  const listStep = step ?? (q === '' && !mine && !everyone ? 'STILL_TO_FINISH' : null);

  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [page, setPage] = useState(0);
  const me = useQuery({ queryKey: ['me'], queryFn: ({ signal }) => getMe(signal) });
  const pageSize = usePageSize();
  // A new size starts the list again, so no row is skipped between two page lengths.
  const filterKey = `${q}|${mine}|${listStep ?? ''}|${pageSize}`;
  const [lastFilter, setLastFilter] = useState(filterKey);
  if (lastFilter !== filterKey) {
    setLastFilter(filterKey);
    setCursors([null]);
    setPage(0);
  }

  const counts = useQuery({
    queryKey: ['training-counts'],
    queryFn: ({ signal }) => getTrainingCounts(signal),
  });
  const people = useQuery({
    queryKey: ['training-people', q, mine, listStep, cursors[page], pageSize],
    queryFn: ({ signal }) =>
      listTrainingPeople(
        {
          q,
          mine,
          step: listStep ?? undefined,
          cursor: cursors[page],
          limit: pageSize,
        },
        signal,
      ),
  });

  const [draft, setDraft] = useState<Record<string, DraftEntry>>({});
  const [reason, setReason] = useState('');
  const [saved, setSaved] = useState(false);

  const rows = useMemo(() => people.data?.data ?? [], [people.data]);
  const entries = Object.values(draft).filter(isChange);
  const needsReason = entries.some((entry) => entry.seen_id !== null);
  const today = todayInManila();

  const changes = useMemo(
    (): TrainingChange[] =>
      Object.values(draft)
        .filter(isChange)
        .map((entry) => ({
          person_id: entry.person_id,
          program: entry.program,
          graduated: entry.graduated,
          ...(entry.graduated && entry.graduated_on ? { graduated_on: entry.graduated_on } : {}),
          seen_id: entry.seen_id,
          ...(entry.seen_id !== null ? { reason: reason.trim() } : {}),
        })),
    [draft, reason],
  );
  const idempotencyKey = useMemo(() => idempotencyKeyFor('training', changes), [changes]);

  const save = useMutation({
    mutationFn: () => submitTraining(changes, idempotencyKey),
    onSuccess: async () => {
      setDraft({});
      setReason('');
      setSaved(true);
      await queryClient.invalidateQueries({ queryKey: ['training-people'] });
      await queryClient.invalidateQueries({ queryKey: ['training-counts'] });
    },
  });

  const stale = save.error instanceof ApiRequestError && save.error.code === 'VERSION_CONFLICT';

  /** Refetch, and keep only the draft lines still made against what is now stored. */
  async function reload() {
    const fresh = await people.refetch();
    await counts.refetch();
    const byPerson = new Map((fresh.data?.data ?? []).map((row) => [row.person_id, row]));

    setDraft((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([, entry]) => {
          const row = byPerson.get(entry.person_id);
          if (row === undefined) {
            return true;
          }
          const stored = row.graduations.find((item) => item.program === entry.program) ?? null;
          return (stored?.id ?? null) === entry.seen_id;
        }),
      ),
    );
    save.reset();
  }

  function update(row: TrainingPerson, program: TrainingProgram, change: Partial<DraftEntry>) {
    const stored = row.graduations.find((item) => item.program === program) ?? null;
    const key = keyOf(row.person_id, program);

    setSaved(false);
    setDraft((current) => {
      const base: DraftEntry = current[key] ?? {
        person_id: row.person_id,
        full_name: row.full_name,
        program,
        graduated: stored !== null,
        graduated_on: stored?.graduated_on ?? null,
        seen_id: stored?.id ?? null,
        stored_on: stored?.graduated_on ?? null,
      };
      const next = { ...base, ...change };
      const copy = { ...current };
      if (isChange(next) || (next.seen_id !== null && next.graduated)) {
        copy[key] = next;
      } else {
        delete copy[key];
      }
      return copy;
    });
  }

  const cards = [
    ...TRAINING_PROGRAMS.map((program) => ({
      step: program,
      label: PROGRAM_LABELS[program],
      count: counts.data?.[program.toLowerCase() as keyof typeof counts.data],
    })),
    { step: 'NOT_STARTED', label: 'None yet', count: counts.data?.not_started },
  ];

  function cell(row: TrainingPerson, program: TrainingProgram) {
    return (
      <SchoolCell
        row={row}
        program={program}
        entry={draft[keyOf(row.person_id, program)]}
        today={today}
        onToggle={(graduated) => update(row, program, { graduated })}
        onDate={(graduated_on) => update(row, program, { graduated: true, graduated_on })}
        onChangeDate={() => update(row, program, { graduated: true })}
      />
    );
  }

  return (
    <main id="main" className={PAGE_WIDTH.INDEX}>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Growth</h1>
        <p className="text-muted text-sm">
          {counts.data
            ? `${counts.data.people} ${counts.data.people === 1 ? 'person' : 'people'} in your care, as of today.`
            : 'The people in your care, as of today.'}{' '}
          A count of graduations in a period counts only the dated ones.
        </p>
      </div>

      <GrowthTabs current="/growth/training" />

      {/* The Encounter seasons are kept here (decision 0296); Reports only reads the next. */}
      <p className="mt-4 text-sm">
        <Link
          href="/growth/training/encounters"
          className="text-accent focus-visible:outline-accent inline-flex min-h-11 items-center underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          Encounter seasons
        </Link>
      </p>

      <GrowthCards
        cards={cards}
        selected={step}
        onSelect={(next) => go({ step: next, all: null })}
      />

      <GrowthFilters
        submitted={q}
        mine={mine}
        onSearch={(term) => go({ q: term })}
        onMine={(next) => go({ mine: next ? '1' : null })}
      />

      {step === null && q === '' && !mine ? (
        <StillToFinish
          everyone={everyone}
          finished={counts.data?.all_five}
          what="all five"
          onChange={(all) => go({ all: all ? '1' : null })}
        />
      ) : null}

      <div className="mt-8">
        <FailureNotice
          failure={
            people.isError
              ? describeFailure(people.error)
              : counts.isError
                ? describeFailure(counts.error)
                : save.isError
                  ? describeFailure(save.error)
                  : null
          }
        />
        {stale ? (
          <Button variant="secondary" className="mt-3" onClick={() => void reload()}>
            Reload
          </Button>
        ) : null}
      </div>

      <div className="mt-4">
        {people.isPending ? (
          <p className="text-muted text-sm">Loading&hellip;</p>
        ) : people.isError ? null : rows.length === 0 ? (
          <p className="text-sm">Nobody here matches.</p>
        ) : (
          <>
            <Table
              caption="Training graduations for the people in your care"
              className="hidden lg:block"
            >
              <thead>
                <tr>
                  <HeaderCell>Person</HeaderCell>
                  {TRAINING_PROGRAMS.map((program) => (
                    <HeaderCell key={program} className="px-1 text-center">
                      {PROGRAM_LABELS[program]}
                    </HeaderCell>
                  ))}
                  <HeaderCell className="text-right">Done</HeaderCell>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.person_id} className={rowClasses}>
                    <td className="px-3 py-3 align-top">
                      <PersonName row={row} self={row.person_id === me.data?.person_id} />
                    </td>
                    {TRAINING_PROGRAMS.map((program) => (
                      <td key={program} className="px-1 py-3 text-center align-top">
                        {cell(row, program)}
                      </td>
                    ))}
                    <td className="px-3 py-3 text-right align-top">{doneLabel(row, draft)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>

            <ul className="border-line divide-line divide-y border-t border-b lg:hidden">
              {rows.map((row) => (
                <li key={row.person_id} className="py-4">
                  <div className="flex items-start justify-between gap-3">
                    <PersonName row={row} self={row.person_id === me.data?.person_id} />
                    <span className="text-sm">{doneLabel(row, draft)}</span>
                  </div>
                  <ul className="mt-2">
                    {TRAINING_PROGRAMS.map((program) => (
                      <li
                        key={program}
                        className="border-line flex min-h-11 items-center justify-between gap-3 border-t py-2 first:border-t-0"
                      >
                        <span aria-hidden="true" className="text-sm">
                          {PROGRAM_LABELS[program]}
                        </span>
                        <div className="flex flex-col items-end">{cell(row, program)}</div>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>

            <nav aria-label="Results" className="mt-6 flex items-center gap-3">
              <Button
                variant="secondary"
                disabled={page === 0}
                onClick={() => setPage((current) => Math.max(0, current - 1))}
              >
                Previous
              </Button>
              <Button
                variant="secondary"
                disabled={!people.data.next_cursor}
                onClick={() => {
                  const next = people.data.next_cursor;
                  if (!next) return;
                  setCursors((current) => [...current.slice(0, page + 1), next]);
                  setPage((current) => current + 1);
                }}
              >
                Next
              </Button>
            </nav>
          </>
        )}
      </div>

      <GrowthSaveBar
        summary={
          entries.length > 0
            ? `${entries.length === 1 ? '1 graduation' : `${entries.length} graduations`} changed, not saved yet.`
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
          setReason('');
          save.reset();
        }}
        saving={save.isPending}
      />
    </main>
  );
}

function PersonName({ row, self }: { row: TrainingPerson; self: boolean }) {
  return (
    <div>
      <Link
        href={`/people/${row.person_id}`}
        className="focus-visible:outline-accent inline-flex min-h-6 items-center font-medium underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        {row.full_name}
      </Link>
      <span className="text-muted block font-mono text-xs">{row.member_id}</span>
      {!row.may_file ? (
        // Decision 0280: nobody records their own; anyone else here is somebody the
        // reader may not file for, a Network root among them, who has no leader.
        <span className="text-muted block text-xs">
          {self ? 'You · another leader records these' : 'Not yours to record'}
        </span>
      ) : null}
    </div>
  );
}

function SchoolCell({
  row,
  program,
  entry,
  today,
  onToggle,
  onDate,
  onChangeDate,
}: {
  row: TrainingPerson;
  program: TrainingProgram;
  entry: DraftEntry | undefined;
  today: string;
  onToggle: (graduated: boolean) => void;
  onDate: (graduatedOn: string | null) => void;
  onChangeDate: () => void;
}) {
  const stored = row.graduations.find((item) => item.program === program) ?? null;
  const graduated = entry?.graduated ?? stored !== null;
  const name = `${PROGRAM_LABELS[program]}, ${row.full_name}`;
  const storedDate = stored ? (stored.graduated_on ? longDay(stored.graduated_on) : 'no date') : '';

  if (!row.may_file) {
    return (
      <span className="inline-flex flex-col items-center text-sm">
        <span aria-hidden="true">{graduated ? '✓' : '–'}</span>
        <span className="sr-only">
          {name}: {graduated ? `graduated, ${storedDate}` : 'not graduated'}
        </span>
        {graduated ? <span className="text-muted text-xs">{storedDate}</span> : null}
      </span>
    );
  }

  return (
    <span className="inline-flex flex-col items-center gap-1">
      <input
        type="checkbox"
        aria-label={stored ? `${name}, ${storedDate}` : name}
        checked={graduated}
        onChange={() => onToggle(!graduated)}
        className="accent-accent focus-visible:outline-accent size-6 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2"
      />
      {graduated && entry !== undefined ? (
        <input
          type="date"
          aria-label={`Date of ${name}, optional`}
          max={today}
          value={entry.graduated_on ?? ''}
          onChange={(event) => onDate(event.target.value === '' ? null : event.target.value)}
          className="border-edge focus-visible:outline-accent min-h-6 w-36 border px-1 text-xs focus-visible:outline-2 focus-visible:outline-offset-2"
        />
      ) : graduated && stored ? (
        <button
          type="button"
          onClick={onChangeDate}
          aria-label={`Change the date of ${name}, now ${storedDate}`}
          className="text-muted focus-visible:outline-accent min-h-6 text-xs underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          {storedDate}
        </button>
      ) : null}
    </span>
  );
}

function doneLabel(row: TrainingPerson, draft: Record<string, DraftEntry>): string {
  const done = TRAINING_PROGRAMS.filter(
    (program) =>
      draft[keyOf(row.person_id, program)]?.graduated ??
      row.graduations.some((item) => item.program === program),
  ).length;

  return done === 5 ? 'All five' : `${done} of 5`;
}
