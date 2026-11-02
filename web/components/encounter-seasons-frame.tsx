'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { buttonClasses } from '@/components/ui/button';
import { FailureNotice } from '@/components/ui/failure-notice';
import { FRAME } from '@/components/ui/frame';
import { HeaderCell, Table, rowClasses } from '@/components/ui/table';
import { addDays } from '@/lib/calendar-day';
import {
  PARTY_DAYS_BEFORE,
  createEncounterSeason,
  dayLabel,
  listEncounterSeasons,
  seasonLabel,
  updateEncounterSeason,
  weekendLabel,
  type EncounterSeasonInput,
  type ShownSeason,
} from '@/lib/encounters';
import { idempotencyKeyFor } from '@/lib/idempotency';
import { getMe, holdsWholeChurch } from '@/lib/me';
import { describeFailure } from '@/lib/messages';
import { cn } from '@/lib/utils';

/**
 * The Encounter seasons (SKILL.md section 28, decision 0296): a list anyone who reads SUYNL
 * reads, and on Admin's Settings tab the place a Whole Church `settings.manage` holder adds
 * or changes them (decision 0425). The API decides both (section 7).
 *
 * **Each LC Party is at least five weeks before its own weekend**, and one left empty is
 * exactly five. The API refuses a later party and names the field; the hint says the rule
 * before anybody breaks it.
 */
const input =
  'border-line bg-surface focus-visible:outline-accent min-h-11 rounded-md border px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2';

interface Draft {
  id: string | null;
  /** One per opening of the form, so a change back to earlier dates is a write, not a replay. */
  editKey: string;
  mens: string;
  womens: string;
  mensParty: string;
  womensParty: string;
}

function draftOf(season: ShownSeason | null): Draft {
  return {
    id: season?.id ?? null,
    editKey: crypto.randomUUID(),
    mens: season?.mens_encounter_on ?? '',
    womens: season?.womens_encounter_on ?? '',
    mensParty: season?.mens_lc_party_on ?? '',
    womensParty: season?.womens_lc_party_on ?? '',
  };
}

export function EncounterSeasonsFrame({ editable }: { editable: boolean }) {
  const queries = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: ({ signal }) => getMe(signal) });
  const seasons = useQuery({
    queryKey: ['encounter-seasons'],
    queryFn: ({ signal }) => listEncounterSeasons(signal),
  });
  // Changed only on Admin's Settings tab (decision 0425); everywhere else a list to read.
  const mayChange = editable && holdsWholeChurch(me.data, 'settings.manage');
  // Which half a reader is shown is the API's to decide (decision 0296): a Whole Church reader,
  // who is the only one who edits, both; anyone else their own Network's.
  const shows = seasons.data?.shows ?? 'BOTH';
  const showMen = shows === 'BOTH' || shows === 'MENS';
  const showWomen = shows === 'BOTH' || shows === 'WOMENS';
  const shown = (date: string | null, label: (d: string) => string) => (date ? label(date) : '—');

  const [draft, setDraft] = useState<Draft | null>(null);

  const body = useMemo<EncounterSeasonInput | null>(
    () =>
      draft
        ? {
            mens_encounter_on: draft.mens,
            womens_encounter_on: draft.womens,
            ...(draft.mensParty ? { mens_lc_party_on: draft.mensParty } : {}),
            ...(draft.womensParty ? { womens_lc_party_on: draft.womensParty } : {}),
          }
        : null,
    [draft],
  );
  // The form's own key is part of it, so changing a season back to dates it held earlier the
  // same day is a new write rather than a replay of the earlier one; a retry of the same save
  // still sends the same key.
  const key = useMemo(
    () => idempotencyKeyFor('encounter-season', draft?.editKey, draft?.id, body),
    [draft?.editKey, draft?.id, body],
  );

  const save = useMutation({
    mutationFn: () =>
      draft?.id
        ? updateEncounterSeason(draft.id, body!, key)
        : createEncounterSeason(body!, key),
    onSuccess: async () => {
      setDraft(null);
      await queries.invalidateQueries({ queryKey: ['encounter-seasons'] });
    },
  });

  const change = (field: keyof Omit<Draft, 'id' | 'editKey'>, value: string) => {
    setDraft((current) => (current ? { ...current, [field]: value } : current));
    save.reset();
  };

  const field = (
    label: string,
    name: keyof Omit<Draft, 'id' | 'editKey'>,
    hint: string,
  ) => (
    // The hint is described by, not part of, the field's name (WCAG 1.3.1).
    <div className="flex flex-col gap-1 text-sm">
      <label htmlFor={`season-${name}`} className="field-label">
        {label}
      </label>
      <input
        id={`season-${name}`}
        type="date"
        value={draft?.[name] ?? ''}
        onChange={(event) => change(name, event.target.value)}
        aria-describedby={`season-${name}-hint`}
        className={input}
      />
      <span id={`season-${name}-hint`} className="text-muted text-xs">
        {hint}
      </span>
    </div>
  );

  const partyHint = (weekend: string | undefined) =>
    `At least 5 weeks before the weekend; left empty, exactly 5${
      weekend ? ` (${dayLabel(addDays(weekend, -PARTY_DAYS_BEFORE))})` : ''
    }.`;

  return (
    <section className={`mt-2 ${FRAME}`} aria-labelledby="seasons-heading">
      <h2 id="seasons-heading" className="field-label">
        Encounter seasons
      </h2>
      <p className="text-muted mt-1 text-sm leading-relaxed">
        Each season has a Men’s Encounter, for men only, and a Women’s Encounter, for women only,
        each with its own LC Party. The Encounter is Life Class lesson 5.
      </p>
      {!editable ? (
        <p className="mt-3 text-sm">An administrator sets these dates in Admin, under Settings.</p>
      ) : null}

      <div className="mt-4">
        <FailureNotice failure={seasons.isError ? describeFailure(seasons.error) : null} />
      </div>

      {seasons.isPending ? (
        <p className="text-muted mt-3 text-sm">Loading&hellip;</p>
      ) : shows === 'NEITHER' ? (
        <p className="mt-3 text-sm">You are in no Network, so no Encounter God Weekend is shown.</p>
      ) : seasons.data && seasons.data.data.length === 0 ? (
        <p className="mt-3 text-sm">No Encounter season has been set yet.</p>
      ) : seasons.data ? (
        <Table caption="Encounter seasons" className="mt-3">
          <thead>
            <tr>
              <HeaderCell>Season</HeaderCell>
              {showMen ? <HeaderCell>Men’s LC Party</HeaderCell> : null}
              {showMen ? <HeaderCell>Men’s Encounter Weekend</HeaderCell> : null}
              {showWomen ? <HeaderCell>Women’s LC Party</HeaderCell> : null}
              {showWomen ? <HeaderCell>Women’s Encounter Weekend</HeaderCell> : null}
              {mayChange ? <HeaderCell>{''}</HeaderCell> : null}
            </tr>
          </thead>
          <tbody>
            {seasons.data.data.map((season) => (
              <tr key={season.id} className={rowClasses}>
                <td className="px-3 py-3 font-bold">{seasonLabel(season)}</td>
                {showMen ? (
                  <td className="px-3 py-3">{shown(season.mens_lc_party_on, dayLabel)}</td>
                ) : null}
                {showMen ? (
                  <td className="px-3 py-3">{shown(season.mens_encounter_on, weekendLabel)}</td>
                ) : null}
                {showWomen ? (
                  <td className="px-3 py-3">{shown(season.womens_lc_party_on, dayLabel)}</td>
                ) : null}
                {showWomen ? (
                  <td className="px-3 py-3">{shown(season.womens_encounter_on, weekendLabel)}</td>
                ) : null}
                {mayChange ? (
                  <td className="px-3 py-3 text-right">
                    <button
                      type="button"
                      className="text-accent focus-visible:outline-accent relative inline-flex min-h-6 items-center underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
                      onClick={() => {
                        setDraft(draftOf(season));
                        save.reset();
                      }}
                    >
                      Edit <span className="sr-only">{seasonLabel(season)}</span>
                    </button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </Table>
      ) : null}

      {mayChange && draft === null ? (
        <button
          type="button"
          className={cn(buttonClasses('secondary'), 'mt-4')}
          onClick={() => {
            setDraft(draftOf(null));
            save.reset();
          }}
        >
          Add an Encounter season
        </button>
      ) : null}

      {mayChange && draft !== null ? (
        <form
          className="border-line mt-4 flex flex-col gap-4 rounded-xl border p-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (draft.mens && draft.womens) save.mutate();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <fieldset className="flex flex-col gap-3">
              <legend className="field-label mb-2">Men</legend>
              {field('Men’s LC Party', 'mensParty', partyHint(draft.mens || undefined))}
              {field('Men’s Encounter starts', 'mens', 'Men only.')}
            </fieldset>
            <fieldset className="flex flex-col gap-3">
              <legend className="field-label mb-2">Women</legend>
              {field('Women’s LC Party', 'womensParty', partyHint(draft.womens || undefined))}
              {field('Women’s Encounter starts', 'womens', 'Women only. Usually a week apart from the men’s.')}
            </fieldset>
          </div>
          {!draft.mens || !draft.womens ? (
            <p className="text-muted text-sm">Enter the day each weekend starts.</p>
          ) : null}
          <FailureNotice failure={save.isError ? describeFailure(save.error) : null} />
          <div className="flex gap-3">
            <button
              type="submit"
              disabled={!draft.mens || !draft.womens || save.isPending}
              className={buttonClasses('primary')}
            >
              {save.isPending ? 'Saving…' : 'Save'}
            </button>
            <button type="button" className={buttonClasses('secondary')} onClick={() => setDraft(null)}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
