'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';

import { AppShell, PAGE_WIDTH } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { FailureNotice } from '@/components/ui/failure-notice';
import { Field } from '@/components/ui/field';
import { RadioGroup } from '@/components/ui/radio-group';
import { TextLink } from '@/components/ui/text-link';
import { describeFailure, fieldErrorFor, type Failure } from '@/lib/messages';
import {
  CIVIL_STATUS_OPTIONS,
  editPerson,
  getPerson,
  type PersonEdit,
  type PersonFull,
} from '@/lib/people';

/**
 * Editing a person's own descriptive fields (SKILL.md sections 3 and 7).
 *
 * **Only what `people.edit_basic` covers.** Section 7 scopes that capability to
 * "corrections to a person's own descriptive fields", and three things that look
 * like they belong on this form deliberately do not:
 *
 * - **Sex** has its own capability and its own screen. Correcting it moves the
 *   person between Networks and forces a pastoral reassignment, which is why
 *   section 7 keeps it Admin-only — and why leaving it here would be a route to
 *   moving people between Networks without ever holding
 *   `people.manage_pastoral_assignment`.
 * - **The pastoral leader** is a reassignment, with its own authority rules and
 *   its own audit entry (section 5).
 * - **Member ID** is server-assigned and immutable (section 3).
 *
 * **A birthday can be added and not removed.** Section 3 defines adding one and
 * does not define removing one, so the API refuses an explicit null and the
 * question is recorded as open rather than answered by a side effect. This form
 * therefore sends the field only when it has a value, and says so where somebody
 * would otherwise clear the box and expect it to take.
 */
export default function EditPersonPage() {
  return (
    <AppShell>
      <EditPersonForm />
    </AppShell>
  );
}

function EditPersonForm() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const person = useQuery({
    queryKey: ['person', id],
    queryFn: ({ signal }) => getPerson(id, signal),
  });

  return (
    <main id="main" className={PAGE_WIDTH.READING}>
      <p className="text-sm">
        <TextLink href={`/people/${id}`}>Back to this person</TextLink>
      </p>

      <h1 className="mt-6 text-2xl font-semibold tracking-tight">Edit details</h1>

      {person.isPending ? (
        <p className="text-muted mt-6 text-sm">Loading…</p>
      ) : person.isError ? (
        <div className="mt-6">
          <FailureNotice failure={describeFailure(person.error)} />
        </div>
      ) : (
        /*
          The fields are seeded from the loaded record by `useState`'s initial
          value, in a child that only exists once the record has arrived. Copying
          server state into local state inside an effect is the pattern React
          warns about and ESLint refuses: it renders once with empty inputs and
          again with the real ones, and it needs a flag to stop a later refetch
          discarding whatever the person has typed since.
        */
        <Fields person={person.data} id={id} />
      )}
    </main>
  );
}

function Fields({ person, id }: { person: PersonFull; id: string }) {
  const router = useRouter();

  const [values, setValues] = useState({
    first_name: person.first_name,
    middle_name: person.middle_name ?? '',
    last_name: person.last_name,
    civil_status: person.civil_status,
    birth_date: person.birth_date ?? '',
    mobile_number: person.mobile_number ?? '',
  });
  const [failure, setFailure] = useState<Failure | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | null>>({});

  /**
   * One key for this save, not one per request (section 23). Minted inside the
   * request function, a retry after a lost response would present a body the
   * store has never seen — so the write would be applied twice rather than
   * replayed. Replaced when the values change, because that is a different write.
   */
  const [writeKey, setWriteKey] = useState(() => crypto.randomUUID());

  function edit<K extends keyof typeof values>(key: K, value: (typeof values)[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    setWriteKey(crypto.randomUUID());
  }

  const save = useMutation({
    mutationFn: (changes: PersonEdit) => editPerson(id, changes, writeKey),
    onSuccess: () => router.push(`/people/${id}`),
    onError: (error) => {
      const next: Record<string, string | null> = {};
      for (const field of ['first_name', 'last_name', 'birth_date', 'mobile_number']) {
        next[field] = fieldErrorFor(error, field);
      }
      setFieldErrors(next);
      setFailure(Object.values(next).some(Boolean) ? null : describeFailure(error));
    },
  });

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFailure(null);
    setFieldErrors({});

    const changes: PersonEdit = {
      first_name: values.first_name.trim(),
      middle_name: values.middle_name.trim() || null,
      last_name: values.last_name.trim(),
      civil_status: values.civil_status,
      mobile_number: values.mobile_number.trim() || null,
    };

    // Sent only when it has a value. The API refuses an explicit null, because
    // section 3 never defined removing a birthday and a nullable column must not
    // become an erase capability nobody decided on.
    if (values.birth_date) {
      changes.birth_date = values.birth_date;
    }

    save.mutate(changes);
  }

  return (
    <>
      {(
        <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-5" noValidate>
          <FailureNotice failure={failure} />

          <Field
            label="First name"
            name="first_name"
            autoComplete="off"
            required
            value={values.first_name}
            error={fieldErrors.first_name}
            onChange={(event) => edit('first_name', event.target.value)}
          />
          <Field
            label="Middle name"
            name="middle_name"
            autoComplete="off"
            value={values.middle_name}
            onChange={(event) => edit('middle_name', event.target.value)}
            description="Optional."
          />
          <Field
            label="Last name"
            name="last_name"
            autoComplete="off"
            required
            value={values.last_name}
            error={fieldErrors.last_name}
            onChange={(event) => edit('last_name', event.target.value)}
          />
          {/*
            Section 7 gives `people.edit_basic` six fields, and civil status is
            the sixth. It belongs here for an ordinary reason: a marriage or a
            bereavement is a correction to somebody's own descriptive record, and
            leaving it out gave that change no path through this client at all.
          */}
          <RadioGroup
            legend="Civil status"
            name="civil_status"
            options={CIVIL_STATUS_OPTIONS}
            value={values.civil_status}
            onChange={(next) => edit('civil_status', next)}
          />

          <Field
            label="Birthday"
            type="date"
            name="birth_date"
            autoComplete="off"
            value={values.birth_date}
            error={fieldErrors.birth_date}
            onChange={(event) => edit('birth_date', event.target.value)}
            description={
              person.birth_date
                ? 'A recorded birthday cannot be removed here — only corrected.'
                : 'Optional. Leave it blank rather than guessing.'
            }
          />
          <Field
            label="Mobile number"
            type="tel"
            name="mobile_number"
            autoComplete="off"
            value={values.mobile_number}
            error={fieldErrors.mobile_number}
            onChange={(event) => edit('mobile_number', event.target.value)}
            description="Optional."
          />

          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? 'Saving…' : 'Save changes'}
            </Button>
            <TextLink href={`/people/${id}`} className="text-ink no-underline">
              Cancel
            </TextLink>
          </div>
        </form>
      )}
    </>
  );
}
