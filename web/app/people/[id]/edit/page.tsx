'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import Link from 'next/link';

import { AppShell, PAGE_WIDTH } from '@/components/app-shell';
import { FieldPair, FormActions, FormSection } from '@/components/form-section';
import { SectionFrame } from '@/components/section-frame';
import { NameFields } from '@/components/name-fields';
import { PersonCells } from '@/components/person-cells';
import { PossibleMatches } from '@/components/possible-matches';
import { Button, buttonClasses } from '@/components/ui/button';
import { FailureNotice } from '@/components/ui/failure-notice';
import { Field } from '@/components/ui/field';
import { RadioGroup } from '@/components/ui/radio-group';
import { TextLink } from '@/components/ui/text-link';
import { MatchLink, MatchNote } from '@/components/archived-match';
import { ApiRequestError } from '@/lib/api-client';
import { classificationLabel, getPersonDccAttendance } from '@/lib/dcc';
import { directLeaderOf, getPastoralPath, noLeaderLabel } from '@/lib/hierarchy';
import { getMe, holdsWholeChurch } from '@/lib/me';
import { formatMobile } from '@/lib/mobile';
import { cn } from '@/lib/utils';
import { describeFailure, fieldErrorFor, type Failure } from '@/lib/messages';
import {
  CIVIL_STATUS_OPTIONS,
  editPerson,
  getPerson,
  sexLabel,
  shownOnly,
  type DuplicateCandidate,
  type ShownCandidate,
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
 *
 * **A changed name, birthday or mobile number is checked for duplicates as adding a person
 * is** (decision 0396): the same "Someone similar is already recorded" box while typing, the
 * person themself left out, and a strong match stops the save until "These are different
 * people" is pressed.
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
      <SectionFrame section="people">
      <p className="text-sm">
        <TextLink href={`/people/${id}`}>Back to this person</TextLink>
      </p>

      <h1 className="mt-4 text-xl font-semibold tracking-tight">Edit details</h1>

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
      </SectionFrame>
    </main>
  );
}

function Fields({ person, id }: { person: PersonFull; id: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  // **Only the Admin is shown the title and sends it** (decision 0374). Anybody else edits the
  // rest and leaves a title already recorded as it is.
  const me = useQuery({ queryKey: ['me'], queryFn: ({ signal }) => getMe(signal) });
  const mayTitle = holdsWholeChurch(me.data, 'people.set_title');

  const [values, setValues] = useState({
    title: person.title ?? '',
    first_name: person.first_name,
    middle_name: person.middle_name ?? '',
    last_name: person.last_name,
    civil_status: person.civil_status,
    birth_date: person.birth_date ?? '',
    mobile_number: person.mobile_number ?? '',
  });
  const [failure, setFailure] = useState<Failure | null>(null);

  // "Add" on the person page lands here with the field named in the hash
  // (decision 0272). Focus only: nothing is copied into state.
  useEffect(() => {
    const field = window.location.hash.slice(1);
    if (field === 'birth_date' || field === 'mobile_number') {
      document.querySelector<HTMLInputElement>(`input[name="${field}"]`)?.focus();
    }
  }, []);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | null>>({});

  /**
   * One key for this save, not one per request (section 23). Minted inside the
   * request function, a retry after a lost response would present a body the
   * store has never seen — so the write would be applied twice rather than
   * replayed. Replaced when the values change, because that is a different write.
   */
  const [writeKey, setWriteKey] = useState(() => crypto.randomUUID());

  const mobileTyped = useRef(false);

  function edit<K extends keyof typeof values>(key: K, value: (typeof values)[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    setWriteKey(crypto.randomUUID());
  }

  // Whether the save will be checked for duplicates: a name, the birthday or the mobile number
  // differs from what is saved (decision 0396). Digits and a plus for the number, as the API compares.
  const digits = (value: string | null) => (value ?? '').replace(/[^\d+]/g, '');
  const identityChanged =
    values.first_name.trim() !== person.first_name ||
    (values.middle_name.trim() || null) !== person.middle_name ||
    values.last_name.trim() !== person.last_name ||
    (values.birth_date !== '' && values.birth_date !== (person.birth_date ?? '')) ||
    digits(values.mobile_number) !== digits(person.mobile_number);

  // Tier 1 candidates the API asked about, and those already passed over (decision 0396).
  const [candidates, setCandidates] = useState<ShownCandidate[] | null>(null);
  const [acknowledged, setAcknowledged] = useState<string[]>([]);
  const [pending, setPending] = useState<PersonEdit | null>(null);
  // One key for the answer to each question, so pressing "save anyway" again after a lost
  // response replays the save rather than making it twice (section 23).
  const [answerKey, setAnswerKey] = useState(() => crypto.randomUUID());

  const save = useMutation({
    // The key travels with the attempt, as on Add Person: a resubmission past a duplicate
    // is a different body and takes a new key in the same handler.
    mutationFn: ({ changes, key }: { changes: PersonEdit; key: string }) =>
      editPerson(id, changes, key),
    // The saved record replaces the cached one before the profile opens. Without this the
    // profile showed the copy it held from before the edit for up to `staleTime`, so a
    // saved change looked unsaved and was saved a second time (owner, 2026-09-22).
    // The lists that show the name are marked stale and not waited for.
    onSuccess: (saved) => {
      queryClient.setQueryData(['person', id], saved);
      void queryClient.invalidateQueries({ queryKey: ['people'] });
      void queryClient.invalidateQueries({ queryKey: ['pastoral-path'] });
      router.push(`/people/${id}`);
    },
    onError: (error) => {
      if (error instanceof ApiRequestError && error.code === 'DUPLICATE_ACKNOWLEDGEMENT_REQUIRED') {
        // Only a candidate in scope is ever refused on (section 3), so none is withheld.
        setCandidates(shownOnly((error.details.candidates as DuplicateCandidate[]) ?? []));
        setAnswerKey(crypto.randomUUID());
        setFailure(null);
        return;
      }
      // The question screen has no fields to name, so a failed "save anyway" is said there.
      if (candidates) {
        setFailure(describeFailure(error));
        return;
      }
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
      ...(mayTitle ? { title: values.title.trim() || null } : {}),
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
    if (acknowledged.length > 0) {
      changes.acknowledged_duplicate_ids = acknowledged;
    }

    setCandidates(null);
    setPending(changes);
    save.mutate({ changes, key: writeKey });
  }

  // Read to show the leader, never to change them: that is a reassignment (section 5).
  const path = useQuery({
    queryKey: ['pastoral-path', id],
    queryFn: ({ signal }) => getPastoralPath(id, signal),
  });
  const pathEntries = path.data?.data ?? [];
  const leader = directLeaderOf(pathEntries);

  // Read to show the stage, never to change it: it is worked out from Sundays (section 9,
  // decision 0247), under `dcc.view_subtree` against the person.
  const dcc = useQuery({
    queryKey: ['person-dcc-stage', id],
    queryFn: ({ signal }) => getPersonDccAttendance(id, null, signal),
    retry: false,
  });
  const stage = dcc.isPending
    ? 'Loading…'
    : dcc.isError
      ? dcc.error instanceof ApiRequestError &&
        (dcc.error.code === 'CAPABILITY_DENIED' || dcc.error.code === 'SCOPE_DENIED')
        ? 'Not available to your account'
        : 'Couldn’t load'
      : dcc.data.classification
        ? classificationLabel(dcc.data.classification)
        : 'None yet';

  if (candidates && pending) {
    return (
      <div className="mt-6">
        <h2 className="text-lg font-semibold tracking-tight">Is this someone already recorded?</h2>
        <p className="text-muted mt-2 max-w-2xl text-sm leading-relaxed">
          Before {pending.first_name} {pending.last_name}’s details are saved, check these.
          Recording one person twice splits their history in two, and the two records are hard to
          put back together.
        </p>

        <ul className="border-line divide-line mt-6 divide-y border-t border-b">
          {candidates.map((candidate) => (
            <li key={candidate.id} className="py-4">
              <p className="font-medium">{candidate.full_name}</p>
              <p className="text-muted font-mono text-sm">{candidate.member_id}</p>
              <MatchNote candidate={candidate} adding={false} className="mt-2" />
              <MatchLink candidate={candidate} className="mt-2 text-sm" />
            </li>
          ))}
        </ul>

        {failure ? (
          <div className="mt-6">
            <FailureNotice failure={failure} />
          </div>
        ) : null}

        <div className="mt-6 flex flex-wrap gap-3">
          <Button
            disabled={save.isPending}
            onClick={() => {
              // Union, not replace, as on Add Person; and the answer's own key, because this
              // body differs from the one the question was stored against.
              const union = Array.from(
                new Set([...acknowledged, ...candidates.map((candidate) => candidate.id)]),
              );
              setAcknowledged(union);
              setFailure(null);
              // The form now sends this body, so it takes this key: going back and saving
              // unchanged replays or reruns this answer rather than reusing the first key.
              setWriteKey(answerKey);
              save.mutate({
                changes: { ...pending, acknowledged_duplicate_ids: union },
                key: answerKey,
              });
            }}
          >
            {save.isPending ? 'Saving…' : 'These are different people — save anyway'}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setCandidates(null);
              setFailure(null);
            }}
          >
            Go back and change the details
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      {(
        <form onSubmit={onSubmit} className="mt-8 flex flex-col" data-form-layout noValidate>
          <FailureNotice failure={failure} />

          <FormSection title="Name" description="As they write it, so they can be found again.">
            <NameFields
              values={values}
              errors={fieldErrors}
              onChange={(key, value) => edit(key, value)}
              note="Middle name is optional."
              showTitle={mayTitle}
            />
          </FormSection>

          <FormSection title="About them">
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

            {/* Optional on an edit; only adding a person requires them (decision 0328). */}
            <FieldPair>
              <Field
                label="Birthday (optional)"
                type="date"
                name="birth_date"
                autoComplete="off"
                value={values.birth_date}
                error={fieldErrors.birth_date}
                onChange={(event) => edit('birth_date', event.target.value)}
                description={
                  person.birth_date
                    ? 'A recorded birthday cannot be removed here — only corrected.'
                    : undefined
                }
              />
              <Field
                label="Mobile number (optional)"
                type="tel"
                name="mobile_number"
                autoComplete="off"
                value={values.mobile_number}
                error={fieldErrors.mobile_number}
                onChange={(event) => {
                  mobileTyped.current = true;
                  edit('mobile_number', event.target.value);
                }}
                onBlur={(event) => {
                  // Only a number typed in is written with hyphens (lib/mobile.ts), so passing
                  // through the box leaves a saved number exactly as it was saved.
                  if (!mobileTyped.current) {
                    return;
                  }
                  mobileTyped.current = false;
                  const next = formatMobile(event.target.value);
                  if (next !== event.target.value) {
                    edit('mobile_number', next);
                  }
                }}
              />
            </FieldPair>

            {/*
              Only once a name, the birthday or the mobile number differs from what is saved, which is
              when the save is checked (decision 0396): opened for a civil status, the page asks
              nothing and looks nobody up.
            */}
            {identityChanged ? (
              <PossibleMatches
                firstName={values.first_name}
                lastName={values.last_name}
                birthDate={values.birth_date}
                mobileNumber={values.mobile_number}
                excludeId={id}
              />
            ) : null}
          </FormSection>

          {/* The three facts this form cannot change (owner's choice, 2026-09-22). */}
          <FormSection title="Not changed here" description="Each is changed somewhere else, as it says.">
            <div className="grid gap-6 lg:grid-cols-3 lg:gap-x-8">
              {/*
                Shown and not editable. Sex is not one of `people.edit_basic`'s fields: it
                decides the Network (section 4), and correcting it is Admin's alone
                (section 7).
              */}
              <div className="flex flex-col gap-1.5">
                <p className="field-label">Sex</p>
                <p className="text-sm">{sexLabel(person.sex)}</p>
                <p className="text-muted text-sm leading-relaxed">
                  Only an administrator can correct this, because it decides which Network they belong to.
                </p>
              </div>

              {/*
                Shown and not editable, as the design has it (owner's choice of 2026-09-15).
                Changing a pastoral leader is a reassignment with its own authority and audit
                entry (section 5), so it is its own action on the profile and never part of Save.
              */}
              <div className="flex flex-col gap-1.5">
                <p className="field-label">Cell Leader</p>
                <p className="text-sm">
                  {path.isPending
                    ? 'Loading…'
                    : path.isError
                      ? 'Not available'
                      : leader
                        ? leader.full_name
                        : noLeaderLabel(pathEntries, path.data?.no_leader_reason ?? null)}
                </p>
                <p className="text-muted text-sm leading-relaxed">
                  Changing it is a move, not an edit. Use Move to another leader on the profile.
                </p>
              </div>

              <div className="flex flex-col gap-1.5">
                <p className="field-label">DCC stage</p>
                <p className="text-sm">{stage}</p>
                <p className="text-muted text-sm leading-relaxed">
                  Worked out from their Sundays. If it looks wrong, correct the Sunday on their page.
                </p>
              </div>
            </div>
          </FormSection>

          <FormActions>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? 'Saving…' : 'Save changes'}
            </Button>
            {/*
              A link styled as a secondary button, which is the pattern already
              used for "Edit details" and "Add a person": it navigates, so it is
              a link, and it sits in a control row beside Save, so it looks like
              a control.

              It was briefly a `TextLink` with `text-ink no-underline`, which
              removed both the colour and the underline and left an interactive
              thing indistinguishable from plain text — and lost `text-sm`, so it
              was a different size from the button beside it. Whether a bare text
              link may carry no visual affordance at all is a question section 23
              does not answer; this avoids asking it by using an affordance the
              application already has.
            */}
            <Link href={`/people/${id}`} className={cn(buttonClasses('secondary'))}>
              Cancel
            </Link>
          </FormActions>
        </form>
      )}

      {/*
        Outside the form, because moving somebody is its own write rather than part of
        Save, and the move dialog carries a form of its own.
      */}
      <PersonCells
        personId={id}
        personName={person.full_name}
        note="A move is saved as soon as you confirm it. It is not part of Save changes."
      />
    </>
  );
}
