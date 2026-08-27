'use client';

import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { AppShell } from '@/components/app-shell';
import { LeaderPicker } from '@/components/leader-picker';
import { PossibleMatches } from '@/components/possible-matches';
import { Button } from '@/components/ui/button';
import { FailureNotice } from '@/components/ui/failure-notice';
import { Field } from '@/components/ui/field';
import { RadioGroup } from '@/components/ui/radio-group';
import { ApiRequestError } from '@/lib/api-client';
import { describeFailure, fieldErrorFor, type Failure } from '@/lib/messages';
import {
  CIVIL_STATUS_OPTIONS,
  SEX_OPTIONS,
  createPerson,
  isWithheld,
  type CivilStatus,
  type DuplicateCandidate,
  type Sex,
} from '@/lib/people';

/**
 * Adding a person (SKILL.md sections 3 and 9).
 *
 * **The duplicate rule is the whole shape of this screen.** Section 3 never
 * auto-merges and never blocks creation; what it does is refuse to create
 * silently past a strong candidate. So the API answers `409` with the candidates
 * it found, this screen shows them, and the encoder either opens one — because it
 * is the same person — or says these are different people and resubmits.
 *
 * **A candidate outside the viewer's scope carries no tier and no reasons, and
 * that is a security rule rather than a gap.** Three rulings record three
 * attempts at it: withholding the reasons left the tier, which is derived from
 * which rule fired and leaks the same fact; withholding the tier left membership
 * of the list, which leaks it again. What may be said is that the person is a
 * possible match — which is all section 3 needs, because the answer is to ask the
 * leader who holds them.
 *
 * **Birthday and mobile number are optional, and nothing here nags for them.**
 * The 2026-08-24 ruling made the birthday optional because a mandatory field
 * people cannot fill gets filled with fictions — and for this field a fiction is
 * worse than a blank, since two of the three Tier 1 rules read it and a false
 * match refuses a real person. Somebody may also decline, which is a decision
 * this form must not press on.
 */
export default function NewPersonPage() {
  return (
    <AppShell>
      <NewPersonForm />
    </AppShell>
  );
}

const EMPTY = {
  first_name: '',
  middle_name: '',
  last_name: '',
  sex: '' as Sex | '',
  civil_status: '' as CivilStatus | '',
  birth_date: '',
  mobile_number: '',
};

function NewPersonForm() {
  const router = useRouter();
  const [values, setValues] = useState(EMPTY);
  const [leaderId, setLeaderId] = useState<string | null>(null);
  const [leaderName, setLeaderName] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<DuplicateCandidate[] | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | null>>({});

  /**
   * **Accumulated, never replaced.** Each refusal carries only the Tier 1
   * candidates still unacknowledged, so acknowledging the newest set alone drops
   * the earlier ones and the next attempt is refused on those again. With a
   * second candidate appearing between two attempts — which section 2 names
   * initial encoding across many hands as the likeliest source of — the button
   * alternates for ever, and section 3's rule that the system never blocks
   * creation is broken by the screen meant to satisfy it.
   */
  const [acknowledged, setAcknowledged] = useState<string[]>([]);

  /**
   * The idempotency key for the write as it currently stands.
   *
   * **One key per body, not one key per attempt** — and the difference is the
   * whole rule. A key exists so that a *bare retry of an unchanged body* replays
   * the stored answer instead of writing twice (section 23). A body that has
   * changed is a different logical write, and section 22 makes reusing a key
   * with a different body `IDEMPOTENCY_KEY_REUSED`, which it defines as
   * permanent and never to be retried.
   *
   * Holding one key across the acknowledgement round trip therefore does not
   * merely fail to help — it makes creation past a Tier 1 candidate impossible.
   * The refusal is a 409, section 22 stores a 4xx against the key, and the
   * resubmission adds `acknowledged_duplicate_ids`, so the fingerprint differs
   * and the second request is refused permanently with no way forward. That was
   * a real defect here, introduced by the fix for the opposite one.
   *
   * So every change to what will be sent mints a new key: the fields, the two
   * radio groups, the pastoral leader, and the acknowledgement set.
   */
  const [writeKey, setWriteKey] = useState(() => crypto.randomUUID());

  /** Call wherever the body changes. See `writeKey`. */
  function beginNewWrite() {
    setWriteKey(crypto.randomUUID());
  }

  function set(key: keyof typeof EMPTY, value: string) {
    setValues((current) => ({ ...current, [key]: value }));
    beginNewWrite();
  }

  const create = useMutation({
    // The key travels with the attempt rather than being read from state.
    // `setWriteKey` does not apply until the next render, so a mutation started
    // in the same handler that reset the key would still send the old one —
    // which is exactly the permanent refusal this is here to avoid.
    mutationFn: ({ acknowledgedIds, key }: { acknowledgedIds: string[]; key: string }) =>
      createPerson(
        {
          first_name: values.first_name.trim(),
          middle_name: values.middle_name.trim() || null,
          last_name: values.last_name.trim(),
          sex: values.sex as Sex,
          civil_status: values.civil_status as CivilStatus,
          birth_date: values.birth_date || null,
          mobile_number: values.mobile_number.trim() || null,
          pastoral_leader_id: leaderId as string,
          acknowledged_duplicate_ids: acknowledgedIds.length > 0 ? acknowledgedIds : undefined,
        },
        key,
      ),
    onSuccess: (person) => router.push(`/people/${person.id}`),
    onError: (error) => {
      if (error instanceof ApiRequestError && error.code === 'DUPLICATE_ACKNOWLEDGEMENT_REQUIRED') {
        setCandidates((error.details.candidates as DuplicateCandidate[]) ?? []);
        setFailure(null);
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
    setCandidates(null);
    create.mutate({ acknowledgedIds: [], key: writeKey });
  }

  if (candidates) {
    return (
      <main id="main" className="mx-auto max-w-3xl px-5 py-8 sm:py-12">
        <h1 className="text-2xl font-semibold tracking-tight">Is this someone already recorded?</h1>
        <p className="text-muted mt-2 max-w-2xl text-sm leading-relaxed">
          Before {values.first_name} {values.last_name} is added, check these. Recording one
          person twice splits their history in two, and the two records are hard to put back
          together.
        </p>

        <ul className="border-line divide-line mt-6 divide-y border-t border-b">
          {candidates.map((candidate) => (
            <li key={candidate.id} className="py-4">
              <p className="font-medium">{candidate.full_name}</p>
              <p className="text-muted font-mono text-sm">{candidate.member_id}</p>

              {/*
                Withheld is read from the API's own flag, not inferred from a
                missing tier: section 8 protects every field the matching rules
                read, and the API already states which candidates it redacted.
                Guessing that from the shape of the payload would render
                "visible to their own leaders" for somebody the viewer pastors,
                the first time a rule matches without pushing a reason.
              */}
              {isWithheld(candidate) ? (
                <p className="text-muted mt-2 text-sm leading-relaxed">
                  A possible match. Their details are visible to the leaders who pastor them —
                  ask before adding a second record.
                </p>
              ) : candidate.reasons?.length ? (
                <ul className="text-muted mt-2 list-inside list-disc text-sm">
                  {candidate.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              ) : null}

              <a
                href={`/people/${candidate.id}`}
                className="text-accent focus-visible:outline-accent mt-2 inline-flex min-h-11 items-center rounded-md text-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                Open this record
              </a>
            </li>
          ))}
        </ul>

        <div className="mt-6 flex flex-wrap gap-3">
          <Button
            disabled={create.isPending}
            onClick={() => {
              // Union, not replace. See `acknowledged` above.
              const union = Array.from(
                new Set([...acknowledged, ...candidates.map((candidate) => candidate.id)]),
              );
              setAcknowledged(union);
              // A new key, because this body differs from the one the refusal
              // was stored against. See `writeKey`.
              const key = crypto.randomUUID();
              setWriteKey(key);
              create.mutate({ acknowledgedIds: union, key });
            }}
          >
            {create.isPending ? 'Adding…' : 'These are different people — add anyway'}
          </Button>
          <Button variant="secondary" onClick={() => setCandidates(null)}>
            Go back and change the details
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main id="main" className="mx-auto max-w-3xl px-5 py-8 sm:py-12">
      <h1 className="text-2xl font-semibold tracking-tight">Add a person</h1>

      <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-5" noValidate>
        <FailureNotice failure={failure} />

        <Field
          label="First name"
          name="first_name"
          autoComplete="off"
          required
          value={values.first_name}
          error={fieldErrors.first_name}
          onChange={(event) => set('first_name', event.target.value)}
        />
        <Field
          label="Middle name"
          name="middle_name"
          autoComplete="off"
          value={values.middle_name}
          onChange={(event) => set('middle_name', event.target.value)}
          description="Optional."
        />
        <Field
          label="Last name"
          name="last_name"
          autoComplete="off"
          required
          value={values.last_name}
          error={fieldErrors.last_name}
          onChange={(event) => set('last_name', event.target.value)}
          description="A generational suffix such as Jr or III belongs here, with the surname."
        />

        {/*
          Section 4 assigns the Network from sex rather than proposing it, and the
          mapping is total — so the consequence is stated here as a fact rather
          than as a step to confirm. A confirmation of a tautology gets clicked
          unread.
        */}
        <RadioGroup
          legend="Sex"
          name="sex"
          required
          description="This decides their Network: men join the Men’s Network and women the Women’s. Correcting it later is a separate, recorded action."
          options={SEX_OPTIONS}
          value={values.sex}
          onChange={(next) => set('sex', next)}
        />

        <RadioGroup
          legend="Civil status"
          name="civil_status"
          required
          options={CIVIL_STATUS_OPTIONS}
          value={values.civil_status}
          onChange={(next) => set('civil_status', next)}
        />

        <Field
          label="Birthday"
          type="date"
          name="birth_date"
          autoComplete="off"
          value={values.birth_date}
          error={fieldErrors.birth_date}
          onChange={(event) => set('birth_date', event.target.value)}
          description="Optional. Leave it blank rather than guessing — an invented date can stop a real person being recorded later."
        />
        <Field
          label="Mobile number"
          type="tel"
          name="mobile_number"
          autoComplete="off"
          value={values.mobile_number}
          error={fieldErrors.mobile_number}
          onChange={(event) => set('mobile_number', event.target.value)}
          description="Optional."
        />

        {/*
          **The pre-flight lookup, which is why section 3 has that endpoint.**
          Creation can only ever refuse on Tier 1, so without this every Tier 2
          match would be "computed and discarded" — section 3's own words for the
          failure it exists to prevent, and section 9 makes it the first step of
          registering a VIP.

          Advisory, never blocking: section 3 says the system never blocks
          creation, and a weaker match is something for the encoder to look at
          rather than something to answer.
        */}
        <PossibleMatches
          firstName={values.first_name}
          lastName={values.last_name}
          birthDate={values.birth_date}
          mobileNumber={values.mobile_number}
        />

        <LeaderPicker
          selectedId={leaderId}
          selectedName={leaderName}
          onSelect={(person) => {
            setLeaderId(person?.id ?? null);
            setLeaderName(person?.full_name ?? null);
            // The leader is in the body, so changing it is a different write.
            // Without this, a `SCOPE_DENIED` or a cross-Network refusal — both
            // 4xx, both stored — left the key spent, and picking a valid leader
            // then met `IDEMPOTENCY_KEY_REUSED` with no way to finish the record.
            beginNewWrite();
          }}
        />

        <div>
          <Button type="submit" disabled={create.isPending || !leaderId}>
            {create.isPending ? 'Adding…' : 'Add person'}
          </Button>
        </div>
      </form>
    </main>
  );
}
