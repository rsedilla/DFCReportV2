'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { EquippingFrame } from '@/components/equipping-frame';
import { Button } from '@/components/ui/button';
import { FailureNotice } from '@/components/ui/failure-notice';
import { SelectField } from '@/components/ui/select-field';
import { ViewSwitch } from '@/components/ui/view-switch';
import {
  enrollEncounter,
  getEncounter,
  saveEncounterAttendance,
  type EncounterList,
  type EncounterNetwork,
  type EncounterSign,
} from '@/lib/equipping';
import { idempotencyKeyFor, useWriteKey } from '@/lib/idempotency';
import { describeFailure } from '@/lib/messages';
import { cn } from '@/lib/utils';

type Student = NonNullable<EncounterList['students']>[number];
type Enrolled = NonNullable<EncounterList['enrolled']>[number];

const NETWORKS: readonly { key: EncounterNetwork; label: string }[] = [
  { key: 'MENS', label: 'Men’s' },
  { key: 'WOMENS', label: 'Women’s' },
];

/** How each of lessons 1 to 4 reads, as the class's register writes it (decision 0503). */
const SIGNS: Record<EncounterSign, { sign: string; words: string }> = {
  CAME: { sign: '✓', words: 'came' },
  MADE_UP: { sign: 'M', words: 'made up' },
  ABSENT: { sign: '✗', words: 'absent' },
  BEFORE_JOINING: { sign: '○', words: 'before they joined, not made up' },
  NONE: { sign: '–', words: 'not marked' },
};

/** *Friday 4 December 2026*, with no comma after the day's name. */
function weekday(day: string): string {
  const at = new Date(`${day}T00:00:00Z`);
  const name = at.toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
  const date = at.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  return `${name} ${date}`;
}

function dayMonth(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
}

function month(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' });
}

/**
 * **The Encounter** (SKILL.md section 29, decision 0501, point 14; decision 0507): one Network's
 * weekend at a time. Before it begins, the students cleared after lesson 4 are ticked and
 * enrolled together, beside those who still owe a make-up, those who can't go and the classes
 * still waiting for lesson 4; from its first day, the Registrar ticks who came, the register's
 * ENC column.
 */
export default function EncounterPage() {
  const [network, setNetwork] = useState<EncounterNetwork>('MENS');
  const [seasonId, setSeasonId] = useState<string | null>(null);
  const read = useQuery({
    queryKey: ['equipping', 'encounter', network, seasonId],
    queryFn: ({ signal }) => getEncounter(network, seasonId, signal),
  });
  const data = read.data;
  const label = network === 'MENS' ? 'Men’s' : 'Women’s';

  return (
    <EquippingFrame
      current="/equipping/encounter"
      title="Encounter"
      lead="Enroll those cleared after lesson 4, and record who came."
    >
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-end gap-4">
          <ViewSwitch<EncounterNetwork>
            label="Weekend"
            options={NETWORKS}
            value={network}
            onChange={(next) => {
              setNetwork(next);
              setSeasonId(null);
            }}
            className="mt-0"
          />
          {data && data.seasons.length > 1 && data.season ? (
            <div className="w-full max-w-xs">
              <SelectField
                label="Season"
                value={data.season.id}
                onChange={(event) => setSeasonId(event.target.value)}
              >
                {data.seasons.map((each) => (
                  <option key={each.id} value={each.id}>
                    {label} Encounter · {longDayShort(each.weekend_on)}
                  </option>
                ))}
              </SelectField>
            </div>
          ) : null}
        </div>
        <FailureNotice failure={read.isError ? describeFailure(read.error) : null} />
        {!data ? (
          read.isError ? null : <p className="text-muted text-sm">Loading…</p>
        ) : data.season === null ? (
          <p className="text-muted text-sm">
            No Encounter weekend is recorded yet. An administrator records the dates.
          </p>
        ) : (
          <>
            <h2 className="font-semibold">
              {label} Encounter · {weekday(data.season.weekend_on)}
            </h2>
            {data.phase === 'RECORDING' ? (
              <WhoCame
                key={`${data.season.id}:${network}`}
                seasonId={data.season.id}
                network={network}
                label={label}
                enrolled={data.enrolled ?? []}
              />
            ) : (
              <Enrolling
                key={`${data.season.id}:${network}`}
                data={data}
                network={network}
                label={label}
              />
            )}
          </>
        )}
      </div>
    </EquippingFrame>
  );
}

function longDayShort(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function Enrolling({
  data,
  network,
  label,
}: {
  data: EncounterList;
  network: EncounterNetwork;
  label: string;
}) {
  const queryClient = useQueryClient();
  const students = data.students ?? [];
  const cleared = students.filter((s) => s.status === 'CLEARED');
  const needs = students.filter((s) => s.status === 'NEEDS_MAKE_UP');
  const cant = students.filter((s) => s.status === 'CANT_GO');
  const [ticked, setTicked] = useState<Set<string>>(() => new Set(cleared.map((s) => s.enrollment_id)));
  const [writeKey, renewWriteKey] = useWriteKey();
  const [justEnrolled, setJustEnrolled] = useState<number | null>(null);
  const chosen = cleared.filter((s) => ticked.has(s.enrollment_id)).map((s) => s.enrollment_id).sort();
  const save = useMutation({
    mutationFn: () => {
      const body = { season_id: data.season!.id, network, enrollment_ids: chosen };
      return enrollEncounter(body, idempotencyKeyFor('equipping-encounter-enroll', writeKey, body));
    },
    onSuccess: async () => {
      setJustEnrolled(chosen.length);
      renewWriteKey();
      await queryClient.invalidateQueries({ queryKey: ['equipping'] });
    },
  });
  const weekendDay = dayMonth(data.season!.weekend_on);

  return (
    <>
      <Group
        title="Cleared"
        note="Lessons 1 to 4 done, up to two made up, and 14 by the weekend’s first day."
        rows={cleared}
        weekendDay={weekendDay}
        tick={{ ticked, setTicked }}
        empty="Nobody is cleared yet."
      />
      {cleared.length > 0 ? (
        <div className="-mt-3 flex flex-col gap-2">
          <FailureNotice failure={save.isError ? describeFailure(save.error) : null} />
          <div>
            <Button
              type="button"
              className="w-auto"
              disabled={chosen.length === 0 || save.isPending}
              onClick={() => {
                setJustEnrolled(null);
                save.mutate();
              }}
            >
              Enroll {chosen.length} in the {label} Encounter
            </Button>
          </div>
        </div>
      ) : null}
      {justEnrolled !== null ? (
        <p className="text-sm font-semibold" role="status">
          {justEnrolled} enrolled in the {label} Encounter.
        </p>
      ) : null}
      {needs.length > 0 ? (
        <Group
          title="Needs make-up"
          note="Moves to Cleared once the Teacher records the make-up."
          rows={needs}
          weekendDay={weekendDay}
        />
      ) : null}
      {cant.length > 0 ? (
        <Group title="Can’t go" note="Not enrolled this season." rows={cant} weekendDay={weekendDay} />
      ) : null}
      {(data.waiting ?? []).length > 0 ? (
        <section aria-labelledby="waiting-heading" className="border-line bg-surface rounded-xl border p-4">
          <h3 id="waiting-heading" className="font-semibold">
            Waiting for lesson 4 · {data.waiting!.length} {data.waiting!.length === 1 ? 'class' : 'classes'}
          </h3>
          <ul className="mt-1 flex flex-col gap-1 text-sm">
            {data.waiting!.map((each) => (
              <li key={each.class.id}>
                {each.class.name} · lesson 4 on {weekday(each.lesson_4_on).replace(/ \d{4}$/, '')}. Its{' '}
                {network === 'MENS' ? 'men' : 'women'} are listed here once it is saved.
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section aria-labelledby="enrolled-heading" className="border-line bg-surface rounded-xl border p-4">
        <h3 id="enrolled-heading" className="font-semibold">
          Enrolled · {(data.enrolled ?? []).length}
        </h3>
        <p className="text-sm">
          {(data.enrolled ?? []).length === 0
            ? 'Nobody yet.'
            : data.enrolled!.map((e) => e.person.full_name ?? 'Somebody').join(', ')}
        </p>
      </section>
    </>
  );
}

function Group({
  title,
  note,
  rows,
  weekendDay,
  tick,
  empty,
}: {
  title: string;
  note: string;
  rows: Student[];
  weekendDay: string;
  tick?: { ticked: Set<string>; setTicked: (next: Set<string>) => void };
  empty?: string;
}) {
  const id = `group-${title.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <section aria-labelledby={id} className="border-line bg-surface rounded-xl border p-4">
      <h3 id={id} className="font-semibold">
        {title} · {rows.length}
      </h3>
      <p className="text-muted text-sm">{note}</p>
      {rows.length === 0 ? (
        <p className="text-muted mt-3 text-sm">{empty}</p>
      ) : (
        <ul className="mt-3 flex flex-col">
          {rows.map((s) => {
            const notes = [
              s.missed_weekend_on ? `Missed the ${month(s.missed_weekend_on)} Encounter` : null,
              s.from_weekend_on ? `From the ${month(s.from_weekend_on)} season` : null,
              ...(tick ? [] : s.reasons),
            ].filter((each): each is string => each !== null);
            const body = (
              <span className="flex flex-col gap-0.5">
                <span className="font-semibold">{s.person.full_name}</span>
                <span className="text-muted text-xs">
                  {s.class.name} · Cell leader {s.cell_leader?.full_name ?? 'none'}
                  {s.age_on_weekend !== null ? ` · ${s.age_on_weekend} on ${weekendDay}` : ''}
                </span>
                <Lessons signs={s.lessons} />
                {notes.map((each) => (
                  <span key={each} className={cn('text-sm', tick ? 'text-muted' : 'font-semibold')}>
                    {each}
                  </span>
                ))}
              </span>
            );
            return (
              <li key={s.enrollment_id} className="border-line border-t">
                {tick ? (
                  <label className="flex min-h-13 cursor-pointer items-start gap-3 py-2">
                    <input
                      type="checkbox"
                      aria-label={`Enroll ${s.person.full_name ?? 'this student'}`}
                      className="accent-accent mt-1 size-6 shrink-0"
                      checked={tick.ticked.has(s.enrollment_id)}
                      onChange={(event) => {
                        const next = new Set(tick.ticked);
                        if (event.target.checked) {
                          next.add(s.enrollment_id);
                        } else {
                          next.delete(s.enrollment_id);
                        }
                        tick.setTicked(next);
                      }}
                    />
                    {body}
                  </label>
                ) : (
                  <div className="py-2">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Lessons({ signs }: { signs: EncounterSign[] }) {
  return (
    <span className="flex flex-wrap gap-x-3 text-sm">
      {signs.map((each, i) => (
        <span key={i} className={cn(each === 'ABSENT' && 'text-field-invalid font-semibold')}>
          L{i + 1} <span aria-hidden="true">{SIGNS[each].sign}</span>
          <span className="sr-only">{SIGNS[each].words}</span>
        </span>
      ))}
    </span>
  );
}

/** From the weekend's first day: tick who came; anyone not ticked is saved as not attended. */
function WhoCame({
  seasonId,
  network,
  label,
  enrolled,
}: {
  seasonId: string;
  network: EncounterNetwork;
  label: string;
  enrolled: Enrolled[];
}) {
  const queryClient = useQueryClient();
  const [came, setCame] = useState<Set<string>>(
    () => new Set(enrolled.filter((e) => e.came === true).map((e) => e.encounter_enrollment_id)),
  );
  const [writeKey, renewWriteKey] = useWriteKey();
  const save = useMutation({
    mutationFn: () => {
      const body = { season_id: seasonId, network, came: [...came].sort() };
      return saveEncounterAttendance(body, idempotencyKeyFor('equipping-encounter-came', writeKey, body));
    },
    onSuccess: async () => {
      renewWriteKey();
      await queryClient.invalidateQueries({ queryKey: ['equipping'] });
    },
  });
  const didNot = enrolled.filter((e) => !came.has(e.encounter_enrollment_id));
  const recorded = enrolled.some((e) => e.came !== null);

  return (
    <section aria-labelledby="came-heading" className="border-line bg-surface rounded-xl border p-4">
      <h3 id="came-heading" className="font-semibold">
        Who came to the {label} Encounter · {enrolled.length} enrolled
      </h3>
      <p className="text-muted text-sm">
        Tick who came. Anyone not ticked is saved as not attended, and goes to a later Encounter.
        {recorded ? ' Saved; change it and save again to correct it.' : ''}
      </p>
      {enrolled.length === 0 ? (
        <p className="text-muted mt-3 text-sm">Nobody was enrolled in this weekend.</p>
      ) : (
        <>
          <ul className="mt-3 flex flex-col gap-2">
            {enrolled.map((e) => (
              <li key={e.encounter_enrollment_id}>
                <label className="border-line flex min-h-13 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2">
                  <input
                    type="checkbox"
                    className="accent-accent size-6 shrink-0"
                    checked={came.has(e.encounter_enrollment_id)}
                    onChange={(event) => {
                      const next = new Set(came);
                      if (event.target.checked) {
                        next.add(e.encounter_enrollment_id);
                      } else {
                        next.delete(e.encounter_enrollment_id);
                      }
                      setCame(next);
                    }}
                  />
                  <span>
                    <span className="block font-semibold">{e.person.full_name}</span>
                    <span className="text-muted block text-xs">{e.class.name}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm font-semibold" role="status">
            {came.size} came · {didNot.length} did not
            {didNot.length > 0 ? `: ${didNot.map((e) => e.person.full_name ?? 'Somebody').join(', ')}` : ''}
          </p>
          <FailureNotice failure={save.isError ? describeFailure(save.error) : null} />
          <Button type="button" className="mt-3 w-auto" disabled={save.isPending} onClick={() => save.mutate()}>
            Save who came
          </Button>
        </>
      )}
    </section>
  );
}
