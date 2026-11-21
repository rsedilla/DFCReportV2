'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useId, type ReactNode } from 'react';

import { PAGE_WIDTH } from '@/components/app-shell';
import { TAB_GRID, TAB_PANE, TAB_ROW, tabClasses } from '@/components/ui/frame';
import { termLabel, type Term } from '@/lib/equipping';
import {
  CoordinatorPhoneTabs,
  GrowthEquippingTabs,
  useGrowthCarriesEquipping,
} from '@/components/growth-controls';
import { coordinatesOnly, getMe } from '@/lib/me';
import { pageIsOffered } from '@/lib/screen-guard';
import { cn } from '@/lib/utils';

/**
 * What the two Equipping pages share (SKILL.md section 29, decision 0499).
 *
 * **A Registrar has the steps in the sidebar, so no tab row** (decision 0499, point 4); the
 * Admin has one `Equipping` item, and the steps are its tabs, *Classes* among them (decision
 * 0501). A Coordinator reaches *Classes* alone, so they see no tab row either: a tab is drawn
 * only for a page the account is offered, and a row of one is no row.
 */
const STEPS = [
  { href: '/equipping/registration', label: 'Registration' },
  { href: '/equipping/enrollment', label: 'Enrollment' },
  { href: '/equipping/classes', label: 'Classes' },
] as const;

export function EquippingFrame({
  current,
  title,
  lead,
  children,
}: {
  current: (typeof STEPS)[number]['href'];
  title: string;
  lead: string;
  children: ReactNode;
}) {
  const me = useQuery({ queryKey: ['me'], queryFn: ({ signal }) => getMe(signal) });
  const carriesEquipping = useGrowthCarriesEquipping();
  // No tabs until the server names the screens, so they never flash (owner, 2026-10-11).
  const steps =
    me.data === undefined || me.data.screens === 'EQUIPPING'
      ? []
      : STEPS.filter((step) => pageIsOffered(me.data!, step.href));
  const tabbed = steps.length > 1;

  return (
    <main id="main" className={PAGE_WIDTH.INDEX}>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{tabbed ? 'Equipping' : title}</h1>
        <p className="text-muted text-sm">{lead}</p>
      </div>
      {current === '/equipping/classes' && coordinatesOnly(me.data) ? (
        carriesEquipping ? (
          <div className="lg:hidden">
            <GrowthEquippingTabs current="/equipping/classes" />
          </div>
        ) : (
          <CoordinatorPhoneTabs current="/equipping/classes" />
        )
      ) : null}
      {tabbed ? (
        <nav aria-label="Equipping" className={cn('mt-6', TAB_GRID, TAB_ROW)}>
          {steps.map((step) => (
            <Link
              key={step.href}
              href={step.href}
              aria-current={step.href === current ? 'page' : undefined}
              className={tabClasses(step.href === current)}
            >
              {step.label}
            </Link>
          ))}
        </nav>
      ) : null}
      <div className={tabbed ? TAB_PANE : 'mt-6'}>{children}</div>
    </main>
  );
}

/**
 * A labelled tick box, 24px, as the Privacy Notice's is. `boxed` draws it as a bordered box
 * that answers a tap anywhere on it (decision 0500), where two ticks stand as one question.
 */
export function Tick({
  checked,
  onChange,
  boxed = false,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  boxed?: boolean;
  children: ReactNode;
}) {
  const id = useId();
  const input = (
    <input
      id={id}
      type="checkbox"
      className="accent-accent size-6 shrink-0"
      checked={checked}
      onChange={(event) => onChange(event.target.checked)}
    />
  );
  if (boxed) {
    return (
      <label
        htmlFor={id}
        className="border-line bg-surface hover:bg-raised flex min-h-13 cursor-pointer items-center gap-3 rounded-lg border px-4 py-2 text-sm font-semibold"
      >
        {input}
        <span>{children}</span>
      </label>
    );
  }
  return (
    <div className="flex min-h-11 items-center gap-3">
      {input}
      <label htmlFor={id} className="text-sm font-semibold">
        {children}
      </label>
    </div>
  );
}

/** A labelled box of several lines, styled as `Field`'s box is. */
export function TextBox({
  label,
  value,
  onChange,
  required = false,
  error,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  error?: string | null;
  placeholder?: string;
}) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="field-label">
        {label}
        {required ? null : <span className="text-muted font-normal normal-case"> (optional)</span>}
      </label>
      <textarea
        id={id}
        value={value}
        rows={2}
        maxLength={500}
        placeholder={placeholder}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          'border-edge bg-surface text-ink rounded-md border px-3 py-2 text-base',
          'focus-visible:outline-accent focus-visible:outline-2 focus-visible:outline-offset-2',
          'aria-[invalid=true]:border-field-invalid aria-[invalid=true]:border-2',
        )}
      />
      {error ? (
        <p id={errorId} className="text-field-invalid text-sm">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** The term to show: this year's three and next year's, the chosen one first in its year. */
export function TermPicker({ term, onChange }: { term: Term; onChange: (term: Term) => void }) {
  const id = useId();
  const year = new Date().getFullYear();
  const options = [year - 1, year, year + 1].flatMap((each) =>
    [1, 2, 3].map((number) => ({ term_year: each, term_number: number })),
  );
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="field-label">
        Term
      </label>
      <select
        id={id}
        className="border-edge bg-surface text-ink min-h-11 rounded-md border px-3 text-base font-semibold"
        value={`${term.term_year}-${term.term_number}`}
        onChange={(event) => {
          const [term_year, term_number] = event.target.value.split('-').map(Number);
          onChange({ ...term, term_year, term_number });
        }}
      >
        {options.map((option) => (
          <option key={`${option.term_year}-${option.term_number}`} value={`${option.term_year}-${option.term_number}`}>
            {termLabel(option)}
          </option>
        ))}
      </select>
    </div>
  );
}
