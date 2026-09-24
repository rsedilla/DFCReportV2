'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { CONTROL_BAR } from '@/components/ui/frame';
import { cn } from '@/lib/utils';

/**
 * What the Growth tabs share (SKILL.md section 28; the owner's choices of 2026-09-24).
 *
 * Nothing here counts, grades or ranks: a card is a count of people and a filter, and
 * the only colour is the accent on the active tab and a selected card's border.
 */

const TABS = [
  { href: '/growth/suynl', label: 'SUYNL' },
  { href: '/growth/training', label: 'Training' },
  { href: '/growth/conquest', label: 'Conquest' },
] as const;

/** The tabs, as links: each is its own address, so Back and a reload keep the tab. */
export function GrowthTabs({ current }: { current: (typeof TABS)[number]['href'] }) {
  return (
    <nav aria-label="Growth" className="border-line mt-6 flex border-b">
      {TABS.map((tab) => {
        const active = tab.href === current;

        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              // px-3 below `sm`: three tabs fit a 320px phone with room for font differences.
              'focus-visible:outline-accent inline-flex min-h-11 items-center border border-b-0 px-3 sm:px-4',
              'text-xs font-bold tracking-[0.08em] uppercase',
              'focus-visible:outline-2 focus-visible:-outline-offset-2',
              active
                ? 'bg-accent text-surface border-accent'
                : 'border-line text-ink hover:bg-raised',
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * The cards fill the row on a wide screen, however many a tab has (owner's choice of
 * 2026-09-24): SUYNL's three, Conquest's four, Training's six. Spelled out whole so
 * Tailwind sees each class.
 */
const COLUMNS: Record<number, string> = {
  3: 'sm:grid-cols-3',
  4: 'lg:grid-cols-4',
  6: 'sm:grid-cols-3 lg:grid-cols-6',
};

export interface GrowthCard {
  step: string;
  label: string;
  count: number | undefined;
}

/**
 * The count cards, each a toggle that narrows the list to the people behind it
 * (decision 0281). Pressing the chosen one again clears it.
 */
export function GrowthCards({
  cards,
  selected,
  onSelect,
}: {
  cards: GrowthCard[];
  selected: string | null;
  onSelect: (step: string | null) => void;
}) {
  return (
    <ul className={cn('mt-6 grid grid-cols-2 gap-3', COLUMNS[cards.length] ?? COLUMNS[6])}>
      {cards.map((card) => {
        const pressed = card.step === selected;

        return (
          <li key={card.step}>
            <button
              type="button"
              aria-pressed={pressed}
              onClick={() => onSelect(pressed ? null : card.step)}
              className={cn(
                // h-full: every card in a row is as tall as the tallest, whose label wraps.
                'bg-surface flex h-full min-h-11 w-full flex-col items-start border p-3 text-left',
                'focus-visible:outline-accent focus-visible:outline-2 focus-visible:outline-offset-2',
                pressed
                  ? 'border-accent shadow-[inset_0_0_0_1px_var(--accent)]'
                  : 'border-edge hover:bg-raised',
              )}
            >
              <span className="text-accent text-xs font-bold tracking-[0.08em] uppercase">
                {card.label}
              </span>
              <span className="mt-1 text-2xl font-bold tabular-nums">{card.count ?? '–'}</span>
              <span className="text-muted mt-auto pt-1 text-xs">
                {pressed ? 'Showing these' : 'Show these'}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * What the list's opening view leaves out, and the way to see it (decision 0287). The
 * list opens on the people still to finish; this line names how many have finished, so
 * nobody looks missing, and switches to everyone and back.
 */
export function StillToFinish({
  everyone,
  finished,
  what,
  onChange,
}: {
  everyone: boolean;
  /** How many have finished, from the counts; nothing is said until it is read. */
  finished: number | undefined;
  /** "all ten" or "all five". */
  what: string;
  onChange: (everyone: boolean) => void;
}) {
  if (finished === undefined || finished === 0) {
    return null;
  }

  return (
    <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
      <span className="text-muted">
        {everyone
          ? `Showing everyone, the ${finished} who ${finished === 1 ? 'has' : 'have'} finished ${what} included.`
          : `${finished} who ${finished === 1 ? 'has' : 'have'} finished ${what} ${finished === 1 ? 'is' : 'are'} not shown.`}
      </span>
      <Button variant="secondary" onClick={() => onChange(!everyone)}>
        {everyone ? 'Show only those still to finish' : 'Show everyone'}
      </Button>
    </p>
  );
}

/** The search and the "only my disciples" toggle, in the grey bar every screen's controls sit in. */
export function GrowthFilters({
  submitted,
  mine,
  onSearch,
  onMine,
}: {
  submitted: string;
  mine: boolean;
  onSearch: (term: string) => void;
  onMine: (mine: boolean) => void;
}) {
  const [term, setTerm] = useState(submitted);
  // Follows the address, which Back and a reload change underneath it.
  const [lastSubmitted, setLastSubmitted] = useState(submitted);
  if (lastSubmitted !== submitted) {
    setLastSubmitted(submitted);
    setTerm(submitted);
  }

  const trimmed = term.trim();
  const tooShort = trimmed.length > 0 && trimmed.length < 2;

  return (
    <form
      className={cn(CONTROL_BAR, 'mt-6')}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (!tooShort) {
          onSearch(trimmed);
        }
      }}
    >
      <Field
        label="Find a name or Member ID"
        type="search"
        name="q"
        autoComplete="off"
        value={term}
        onChange={(event) => setTerm(event.target.value)}
        className="w-full min-w-0 sm:w-auto sm:flex-1"
      />
      <Button type="submit" disabled={tooShort}>
        {trimmed.length === 0 && submitted !== '' ? 'Clear search' : 'Search'}
      </Button>
      <Button variant="secondary" aria-pressed={mine} onClick={() => onMine(!mine)}>
        {mine ? 'Showing only my disciples' : 'Only my disciples'}
      </Button>
    </form>
  );
}

/**
 * The draft's save bar, pinned above the phone's tab bar as the recording screens pin
 * theirs. Where the draft withdraws or re-dates a saved record, it asks why, and Save
 * waits for an answer (section 28, *Correcting*).
 */
export function GrowthSaveBar({
  summary,
  count,
  needsReason,
  reason,
  onReason,
  onSave,
  onDiscard,
  saving,
}: {
  /** Null where there is nothing to say, which hides the bar. */
  summary: ReactNode | null;
  count: number;
  needsReason: boolean;
  reason: string;
  onReason: (reason: string) => void;
  onSave: () => void;
  onDiscard: () => void;
  saving: boolean;
}) {
  const missingReason = needsReason && reason.trim() === '';

  // Nothing pinned over the list until there is something to say: a bar reading "nothing
  // to save" takes a phone's screen from the rows it would be saving.
  if (count === 0 && summary === null) {
    return null;
  }

  return (
    <div className="border-edge bg-surface sticky bottom-[calc(3.5625rem+env(safe-area-inset-bottom))] z-20 -mx-5 mt-8 flex flex-col gap-3 border-t px-5 py-3 lg:bottom-0">
      <p aria-live="polite" className="text-sm">
        {summary}
      </p>
      {needsReason ? (
        <div>
          <label htmlFor="growth-reason" className="field-label block">
            Why is this being withdrawn or changed? (required)
          </label>
          <textarea
            id="growth-reason"
            value={reason}
            onChange={(event) => onReason(event.target.value)}
            rows={2}
            maxLength={500}
            className="border-edge focus-visible:outline-accent mt-2 w-full border px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
          />
        </div>
      ) : null}
      {count > 0 ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onDiscard} disabled={saving}>
            Discard
          </Button>
          <Button onClick={onSave} disabled={saving || missingReason}>
            {saving ? 'Saving…' : count === 1 ? 'Save 1 change' : `Save ${count} changes`}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** "14 August 2026", from a `YYYY-MM-DD` day. */
export function longDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
