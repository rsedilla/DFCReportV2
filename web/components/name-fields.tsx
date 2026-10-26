'use client';

import { useId, useRef } from 'react';

import { Field } from '@/components/ui/field';
import { capitalizeNameWords } from '@/lib/names';

export interface NameValues {
  title: string;
  first_name: string;
  middle_name: string;
  last_name: string;
}

/**
 * A person's name as one question with three boxes (SKILL.md section 3).
 *
 * **One "Full name" legend over First, Middle and Last**, which is what
 * `docs/DESIGN_RECONCILIATION.md` settles in place of the design's single box: section 3
 * records the three names separately, so the screen asks for three while reading as one.
 *
 * **Each box shows a short label and is announced by its full one**, so a screen reader
 * hears "First name" rather than "First" on its own.
 *
 * **Title comes first and is optional** (decision 0271): Bishop, Pastora. It is stored
 * apart from the name, so it is never compared as part of it. **Only the Admin is shown it**
 * (decision 0374): `showTitle` is the caller's reading of `people.set_title`, and the server
 * refuses a title from anyone else whatever the screen shows.
 */
export function NameFields({
  values,
  errors,
  onChange,
  note,
  showTitle,
}: {
  values: NameValues;
  errors: Record<string, string | null>;
  onChange: (key: keyof NameValues, value: string) => void;
  note: string;
  showTitle: boolean;
}) {
  const noteId = useId();

  // As each name box is left (lib/names.ts), so the person sees the result before saving.
  // **Only a box typed in is written over**, so on Edit details a name saved as the family
  // writes it, `DeVera` or `dela Cruz`, is not changed by passing through its box.
  // **A name changed by hand after it was written stays as changed**: the same letters,
  // capitals moved, as in `dela` or `DeVera`. A name typed afresh is written again.
  const formatted = useRef(new Map<keyof NameValues, string>());
  const typed = useRef(new Set<keyof NameValues>());

  function change(key: keyof NameValues, value: string) {
    typed.current.add(key);
    onChange(key, value);
  }

  function capitalize(key: keyof NameValues, value: string) {
    if (!typed.current.has(key)) {
      return;
    }
    typed.current.delete(key);

    const next = capitalizeNameWords(value);
    const last = formatted.current.get(key);
    const changedByHand = last !== undefined && last.toLowerCase() === value.toLowerCase();

    if (next !== value && !changedByHand) {
      formatted.current.set(key, next);
      onChange(key, next);
    }
  }

  return (
    <fieldset className="flex flex-col gap-1.5" aria-describedby={noteId}>
      <legend className="field-label">Full name</legend>

      <div className={showTitle ? 'mt-1 grid gap-4 sm:grid-cols-4' : 'mt-1 grid gap-4 sm:grid-cols-3'}>
        {showTitle ? (
          <Field
            label="Title"
            quietLabel
            aria-label="Title, optional"
            name="title"
            autoComplete="off"
            placeholder="Optional"
            value={values.title}
            onChange={(event) => onChange('title', event.target.value)}
          />
        ) : null}
        <Field
          label="First"
          quietLabel
          aria-label="First name"
          name="first_name"
          autoComplete="off"
          required
          value={values.first_name}
          error={errors.first_name}
          onChange={(event) => change('first_name', event.target.value)}
          autoCapitalize="words"
          onBlur={(event) => capitalize('first_name', event.target.value)}
        />
        <Field
          label="Middle"
          quietLabel
          aria-label="Middle name"
          name="middle_name"
          autoComplete="off"
          value={values.middle_name}
          onChange={(event) => change('middle_name', event.target.value)}
          autoCapitalize="words"
          onBlur={(event) => capitalize('middle_name', event.target.value)}
        />
        <Field
          label="Last"
          quietLabel
          aria-label="Last name"
          name="last_name"
          autoComplete="off"
          required
          value={values.last_name}
          error={errors.last_name}
          onChange={(event) => change('last_name', event.target.value)}
          autoCapitalize="words"
          onBlur={(event) => capitalize('last_name', event.target.value)}
        />
      </div>

      <p id={noteId} className="text-muted text-sm leading-relaxed">
        {note}
      </p>
    </fieldset>
  );
}
