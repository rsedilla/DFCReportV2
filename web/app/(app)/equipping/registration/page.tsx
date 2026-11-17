'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { EquippingFrame, TermPicker, TextBox, Tick } from '@/components/equipping-frame';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { FailureNotice } from '@/components/ui/failure-notice';
import { SearchField } from '@/components/ui/field';
import { CONTROL_BAR } from '@/components/ui/frame';
import { HeaderCell, Table, rowClasses } from '@/components/ui/table';
import {
  REQUIREMENT_LABELS,
  STATUS_LABELS,
  cancelRegistration,
  currentTerm,
  getCandidate,
  listRegistrations,
  register,
  searchPeople,
  termLabel,
  type FoundPerson,
  type Registration,
  type Term,
} from '@/lib/equipping';
import { describeFailure } from '@/lib/messages';

/**
 * Registration (SKILL.md section 29, decision 0499, points 5 to 9): who has signed up for Life
 * Class this term, and the form that signs somebody up.
 *
 * **Seven requirements.** Four are read from the records when the person is picked; the
 * Equipper ticks three after asking the person's leader. A record not met asks why they are
 * registered anyway, and they are registered with exception (point 7). Nothing records money.
 */
export default function RegistrationPage() {
  const [term, setTerm] = useState<Term>(() => currentTerm());
  const [open, setOpen] = useState(false);

  return (
    <EquippingFrame
      current="/equipping/registration"
      title="Registration"
      lead="Who has signed up for a class this term."
    >
      <div className={CONTROL_BAR}>
        <TermPicker term={term} onChange={setTerm} />
        <p className="text-sm font-semibold">Life Class</p>
        <div className="lg:ml-auto">
          <Button type="button" onClick={() => setOpen(true)}>
            Register a person
          </Button>
        </div>
      </div>
      {/* Keyed by the term, so another term starts on its first page. */}
      <RegistrationList key={`${term.term_year}-${term.term_number}`} term={term} />
      <RegisterDialog term={term} open={open} onClose={() => setOpen(false)} />
    </EquippingFrame>
  );
}

function RegistrationList({ term }: { term: Term }) {
  const [cursor, setCursor] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ['equipping', 'registrations', term, cursor],
    queryFn: ({ signal }) => listRegistrations(term, cursor, signal),
  });
  const [cancelling, setCancelling] = useState<Registration | null>(null);

  if (list.isError) {
    return (
      <div className="mt-4">
        <FailureNotice failure={describeFailure(list.error)} />
      </div>
    );
  }
  if (list.isPending) {
    return <p className="text-muted mt-4 text-sm">Loading&hellip;</p>;
  }
  if (list.data.data.length === 0) {
    return (
      <p className="text-muted mt-4 text-sm">
        Nobody is registered for Life Class in {termLabel(term)} yet.
      </p>
    );
  }

  return (
    <>
      <Table caption={`Registered for Life Class, ${termLabel(term)}`} className="mt-4">
        <thead>
          <tr>
            <HeaderCell>Name</HeaderCell>
            {/* Under the name on a phone, so the table fits 320px. */}
            <HeaderCell className="hidden sm:table-cell">Leader</HeaderCell>
            <HeaderCell className="hidden sm:table-cell">Birthday</HeaderCell>
            <HeaderCell>Status</HeaderCell>
            <HeaderCell>
              <span className="sr-only">Action</span>
            </HeaderCell>
          </tr>
        </thead>
        <tbody>
          {list.data.data.map((row) => (
            <tr key={row.id} className={rowClasses}>
              <td className="px-3 py-3 align-top">
                {row.person.full_name}
                <span className="text-muted block text-sm sm:hidden">
                  {row.leader_name ?? 'No leader yet'} ·{' '}
                  {row.birthday_recorded ? 'birthday recorded' : 'birthday missing'}
                </span>
                {row.exception_reason ? (
                  <p className="text-muted mt-1 text-sm">Why: {row.exception_reason}</p>
                ) : null}
              </td>
              <td className="hidden px-3 py-3 align-top sm:table-cell">{row.leader_name ?? 'No leader yet'}</td>
              <td className="hidden px-3 py-3 align-top sm:table-cell">
                {row.birthday_recorded ? 'Recorded' : 'Missing: ask their leader'}
              </td>
              <td className="px-3 py-3 align-top">
                {STATUS_LABELS[row.status]}
                {row.class ? <span className="text-muted block text-sm">{row.class.name}</span> : null}
              </td>
              <td className="px-3 py-3 text-right align-top">
                {row.status === 'REGISTERED' || row.status === 'REGISTERED_WITH_EXCEPTION' ? (
                  <Button type="button" variant="quiet" onClick={() => setCancelling(row)}>
                    Cancel<span className="sr-only"> {row.person.full_name}&rsquo;s registration</span>
                  </Button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
      {list.data.next_cursor ? (
        <div className="mt-4">
          <Button type="button" variant="secondary" onClick={() => setCursor(list.data.next_cursor)}>
            Show more
          </Button>
        </div>
      ) : null}
      <CancelDialog registration={cancelling} onClose={() => setCancelling(null)} />
    </>
  );
}

function CancelDialog({
  registration,
  onClose,
}: {
  registration: Registration | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [key, setKey] = useState(() => crypto.randomUUID());
  const cancel = useMutation({
    mutationFn: () => cancelRegistration(registration!.id, reason.trim(), key),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['equipping'] });
      setReason('');
      setKey(crypto.randomUUID());
      onClose();
    },
  });

  return (
    <Dialog
      open={registration !== null}
      onClose={onClose}
      title={`Cancel ${registration?.person.full_name ?? ''}’s registration`}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (reason.trim() !== '') {
            cancel.mutate();
          }
        }}
      >
        <TextBox label="Why" value={reason} onChange={setReason} required />
        <FailureNotice failure={cancel.isError ? describeFailure(cancel.error) : null} />
        <div className="flex flex-col gap-3 lg:flex-row">
          <Button type="submit" disabled={cancel.isPending}>
            Cancel registration
          </Button>
          <Button type="button" variant="quiet" onClick={onClose} data-autofocus>
            Keep it
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function RegisterDialog({ term, open, onClose }: { term: Term; open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [searched, setSearched] = useState<string | null>(null);
  const [person, setPerson] = useState<FoundPerson | null>(null);
  const [devotion, setDevotion] = useState(false);
  const [bible, setBible] = useState(false);
  const [manual, setManual] = useState(false);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  const [key, setKey] = useState(() => crypto.randomUUID());

  const reset = () => {
    setQuery('');
    setSearched(null);
    setPerson(null);
    setDevotion(false);
    setBible(false);
    setManual(false);
    setReason('');
    setNote('');
    setShowErrors(false);
    setKey(crypto.randomUUID());
  };

  const found = useQuery({
    queryKey: ['equipping', 'search', searched],
    queryFn: ({ signal }) => searchPeople(searched!, signal),
    enabled: searched !== null,
  });
  const candidate = useQuery({
    queryKey: ['equipping', 'candidate', person?.id],
    queryFn: ({ signal }) => getCandidate(person!.id, signal),
    enabled: person !== null,
  });
  const unmet = (candidate.data?.requirements ?? []).filter((each) => !each.met);
  const ticked = devotion && bible && manual;
  const needsReason = unmet.length > 0;

  const save = useMutation({
    mutationFn: () =>
      register(
        {
          ...term,
          person_id: person!.id,
          devotion_confirmed: devotion,
          bible_confirmed: bible,
          manual_confirmed: manual,
          ...(needsReason ? { exception_reason: reason.trim() } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
        },
        key,
      ),
  });

  const submit = async (andAnother: boolean) => {
    setShowErrors(true);
    if (person === null || !ticked || (needsReason && reason.trim() === '')) {
      return;
    }
    try {
      await save.mutateAsync();
    } catch {
      // Shown by the notice below, from `save.error`.
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ['equipping', 'registrations'] });
    reset();
    if (!andAnother) {
      onClose();
    }
  };

  return (
    <Dialog
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="Register for Life Class"
    >
      <p className="text-muted text-sm">
        {termLabel(term)}. Fees and the manual are paid outside DREAMS.
      </p>

      {person === null ? (
        <div className="mt-4">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setSearched(query.trim());
            }}
          >
            <SearchField
              label="Person"
              description="At least three letters of their name."
              autoComplete="off"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              action={
                <Button type="submit" variant="secondary">
                  Search
                </Button>
              }
            />
          </form>
          <FailureNotice failure={found.isError ? describeFailure(found.error) : null} />
          {found.data ? (
            found.data.data.length === 0 ? (
              <p className="text-muted mt-3 text-sm">Nobody by that name.</p>
            ) : (
              <ul className="mt-3 flex flex-col gap-1">
                {found.data.data.map((each) => (
                  <li key={each.id}>
                    <Button
                      type="button"
                      variant="quiet"
                      className="w-full justify-start text-left"
                      onClick={() => setPerson(each)}
                    >
                      <span>
                        <span className="font-semibold">{each.full_name}</span>
                        <span className="text-muted"> · {each.member_id}</span>
                        {each.direct_leader_name ? (
                          <span className="text-muted block text-sm">Leader: {each.direct_leader_name}</span>
                        ) : null}
                      </span>
                    </Button>
                  </li>
                ))}
              </ul>
            )
          ) : null}
          {showErrors ? <p className="text-field-invalid mt-2 text-sm">Choose a person first.</p> : null}
        </div>
      ) : (
        <form
          className="mt-4 flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit(false);
          }}
        >
          <div className="border-edge flex items-center justify-between gap-3 rounded-md border px-3 py-2">
            <p>
              <span className="font-semibold">{person.full_name}</span>
              <span className="text-muted"> · {person.member_id}</span>
            </p>
            <Button type="button" variant="quiet" onClick={() => setPerson(null)}>
              Change
            </Button>
          </div>

          <section aria-labelledby="requirements-heading">
            <h3 id="requirements-heading" className="field-label">
              Life Class requirements
            </h3>
            {candidate.isPending ? (
              <p className="text-muted mt-2 text-sm">Reading their records&hellip;</p>
            ) : candidate.data ? (
              <ul className="border-line mt-2 rounded-md border">
                {candidate.data.requirements.map((each) => (
                  <li key={each.code} className="border-line flex gap-3 border-b px-3 py-2 last:border-b-0">
                    <span aria-hidden="true" className={each.met ? 'text-accent font-bold' : 'text-field-invalid font-bold'}>
                      {each.met ? '✓' : '✗'}
                    </span>
                    <span>
                      <span className="font-semibold">{REQUIREMENT_LABELS[each.code]}</span>
                      <span className="sr-only">{each.met ? ', met' : ', not met'}</span>
                      <span className={each.met ? 'text-muted block text-sm' : 'text-field-invalid block text-sm'}>
                        {each.detail}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <FailureNotice failure={describeFailure(candidate.error)} />
            )}
            {candidate.data && candidate.data.birth_date === null ? (
              <p className="mt-2 text-sm">
                Birthday not recorded yet. Enrollment will need it, so ask{' '}
                {candidate.data.leader_name ?? 'their leader'} to add it.
              </p>
            ) : null}
          </section>

          <fieldset className="flex flex-col">
            <legend className="field-label">
              Ticked by you, after asking {candidate.data?.leader_name ?? 'their leader'}
            </legend>
            <Tick checked={devotion} onChange={setDevotion}>
              Consistent in devotion
            </Tick>
            <Tick checked={bible} onChange={setBible}>
              Has a physical Bible
            </Tick>
            <Tick checked={manual} onChange={setManual}>
              Has the Life Class Manual
            </Tick>
            {showErrors && !ticked ? (
              <p className="text-field-invalid text-sm">All three are ticked before registering.</p>
            ) : null}
          </fieldset>

          {needsReason ? (
            <TextBox
              label="Why register them anyway?"
              value={reason}
              onChange={setReason}
              required
              error={showErrors && reason.trim() === '' ? 'Say why, since a requirement is not met.' : null}
              placeholder="Their leader confirms they attend every Sunday."
            />
          ) : null}
          <TextBox label="Note" value={note} onChange={setNote} />

          <FailureNotice failure={save.isError ? describeFailure(save.error) : null} />
          <div className="flex flex-col gap-3 lg:flex-row">
            <Button type="submit" disabled={save.isPending}>
              Register
            </Button>
            <Button type="button" variant="secondary" disabled={save.isPending} onClick={() => void submit(true)}>
              Register and add another
            </Button>
            <Button
              type="button"
              variant="quiet"
              onClick={() => {
                reset();
                onClose();
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
