'use client';

import { useId } from 'react';

import { Field } from '@/components/ui/field';

export interface NameValues {
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

  return (
    <fieldset className="flex flex-col gap-1.5" aria-describedby={noteId}>
      <legend className="field-label">Full name</legend>

      <div className="mt-1 grid gap-4 sm:grid-cols-3">
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
        />
        <Field
          label="Middle"
          quietLabel
          aria-label="Middle name"
          name="middle_name"
          autoComplete="off"
          value={values.middle_name}
          onChange={(event) => onChange('middle_name', event.target.value)}
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
        />
      </div>

      <p id={noteId} className="text-muted text-sm leading-relaxed">
        {note}
      </p>
    </fieldset>
  );
}
