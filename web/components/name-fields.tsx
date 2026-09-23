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
 * apart from the name, so it is never compared as part of it.
 */
export function NameFields({
  values,
  errors,
  onChange,
  note,
}: {
  values: NameValues;
  errors: Record<string, string | null>;
  onChange: (key: keyof NameValues, value: string) => void;
  note: string;
}) {
  const noteId = useId();

  // As each name box is left (lib/names.ts), so the person sees the result before saving.
  // A letter the person lowers again in the name just raised, as in `dela`, stays lowered;
  // a name typed afresh is raised again.
  const raised = useRef(new Map<keyof NameValues, string>());

  function capitalize(key: keyof NameValues, value: string) {
    const next = capitalizeNameWords(value);
    const last = raised.current.get(key);
    const loweredByHand = last !== undefined && last.toLowerCase() === value.toLowerCase();

    if (next !== value && !loweredByHand) {
      raised.current.set(key, next);
      onChange(key, next);
    }
  }

  return (
    <fieldset className="flex flex-col gap-1.5" aria-describedby={noteId}>
      <legend className="field-label">Full name</legend>

      <div className="mt-1 grid gap-4 sm:grid-cols-4">
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
        <Field
          label="First"
          quietLabel
          aria-label="First name"
          name="first_name"
          autoComplete="off"
          required
          value={values.first_name}
          error={errors.first_name}
          onChange={(event) => onChange('first_name', event.target.value)}
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
          onChange={(event) => onChange('middle_name', event.target.value)}
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
          onChange={(event) => onChange('last_name', event.target.value)}
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
