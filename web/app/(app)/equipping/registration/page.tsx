'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { EquippingFrame, LevelPicker, TermPicker, TextBox, Tick } from '@/components/equipping-frame';
import { SearchResults } from '@/components/search-results';
import { Button } from '@/components/ui/button';
import { Dialog, DialogActions } from '@/components/ui/dialog';
import { FailureNotice } from '@/components/ui/failure-notice';
import { SearchField } from '@/components/ui/field';
import { CONTROL_BAR } from '@/components/ui/frame';
import { HeaderCell, Table, rowClasses } from '@/components/ui/table';
import { Tag } from '@/components/ui/tag';
import {
  EQUIPPING_LEVELS,
  LEVEL_LABELS,
  REQUIREMENT_LABELS,
  SOL_TICKED,
  STATUS_LABELS,
  cancelRegistration,
  currentTerm,
  getCandidate,
  getRegistrationCounts,
  listRegistrations,
  register,
  searchPeople,
  termLabel,
  ordinal,
  tryLabel,
  type Candidate,
  type KeptFrom,
  type FoundPerson,
  type Registration,
  type Term,
  listName,
} from '@/lib/equipping';
import { describeFailure } from '@/lib/messages';
import { idempotencyKeyFor, useWriteKey } from '@/lib/idempotency';

/**
 * Registration (SKILL.md section 29, decision 0499, points 5 to 9; decision 0514): who has signed
 * up for a level this term, and the form that signs somebody up. A *Level* picker beside the Term
 * says which level, with how many are registered for each.
 *
 * **Life Class's requirements.** Four are read from the records when the person is picked; the
 * Registrar ticks two after asking the person's leader. **SOL 1's three**: Life Class passed, and
 * Win 3 or three direct disciples now, read from the records, and the manual ticked in its own row. A requirement not met asks why
 * they are registered anyway, and they are registered with exception (point 7). Nothing records
 * money.
 */
export default function RegistrationPage() {
  const [term, setTerm] = useState<Term>(() => currentTerm());
  const [open, setOpen] = useState(false);
  const counts = useQuery({
    queryKey: ['equipping', 'registrations', 'counts', term.term_year, term.term_number],
    queryFn: ({ signal }) => getRegistrationCounts(term, signal),
  });

  return (
    <EquippingFrame
      current="/equipping/registration"
      title="Registration"
      lead="Who has signed up for a class this term."
    >
      <div className={CONTROL_BAR}>
        <TermPicker term={term} onChange={setTerm} />
        <LevelPicker
          levels={EQUIPPING_LEVELS}
          value={term.level}
          onChange={(level) => setTerm({ ...term, level })}
          counts={counts.data}
        />
        <div className="lg:ml-auto">
          <Button type="button" onClick={() => setOpen(true)}>
            Register for {LEVEL_LABELS[term.level]}
          </Button>
        </div>
      </div>
      {/* Keyed by the term and level, so another starts on its first page. */}
      <RegistrationList key={`${term.level}-${term.term_year}-${term.term_number}`} term={term} />
      <RegisterDialog term={term} open={open} onClose={() => setOpen(false)} />
    </EquippingFrame>
  );
}

function cancellable(row: Registration): boolean {
  return row.status === 'REGISTERED' || row.status === 'REGISTERED_WITH_EXCEPTION';
}

/** The leader of the Cell they attend (decision 0518), or why there is none. */
function cellLeaderText(row: Registration): string {
  if (row.cell_leader_name !== null) {
    return row.cell_leader_name;
  }
  return row.leads_a_cell ? 'Leads a Cell' : 'No Cell yet';
}

/**
 * The status as a short label (decision 0518), each carrying its meaning in its words and a tick
 * or an exclamation mark, never in its colour alone (1.4.1).
 */
function StatusPill({ status }: { status: Registration['status'] }) {
  if (status === 'REGISTERED_WITH_EXCEPTION') {
    return (
      <Tag appearance="outline">
        !<span className="sr-only"> Registered</span>&nbsp;With exception
      </Tag>
    );
  }
  if (status === 'CANCELLED') {
    return <span className="text-muted text-sm">{STATUS_LABELS[status]}</span>;
  }
  return <Tag>&#10003;&nbsp;{STATUS_LABELS[status]}</Tag>;
}

function RegistrationList({ term }: { term: Term }) {
  const [cursor, setCursor] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ['equipping', 'registrations', term, cursor],
    queryFn: ({ signal }) => listRegistrations(term, cursor, signal),
  });
  const [cancelling, setCancelling] = useState<Registration | null>(null);
  // How many rows the pages before this one held, so the numbers run on (decision 0518).
  const [offset, setOffset] = useState(0);

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
        Nobody is registered for {LEVEL_LABELS[term.level]} in {termLabel(term)} yet.
      </p>
    );
  }

  return (
    <>
      <Table caption={`Registered for ${LEVEL_LABELS[term.level]}, ${termLabel(term)}`} className="mt-4">
        <thead>
          <tr>
            <HeaderCell>Name</HeaderCell>
            {/* Under the name on a phone, so the table fits 320px. */}
            <HeaderCell className="hidden sm:table-cell">Cell Leader</HeaderCell>
            <HeaderCell className="hidden sm:table-cell">Birthday</HeaderCell>
            <HeaderCell>Status</HeaderCell>
            <HeaderCell className="hidden sm:table-cell">
              <span className="sr-only">Action</span>
            </HeaderCell>
          </tr>
        </thead>
        <tbody>
          {list.data.data.map((row, index) => (
            <tr key={row.id} className={rowClasses}>
              {/* A number and the name alone (decision 0518): the requirements not met and the
                  reason stay on the registration, and leave the list. */}
              <td className="px-3 py-3 align-top">
                <div className="flex items-start gap-2">
                  <span className="text-muted shrink-0 tabular-nums sm:w-7 sm:text-right">{offset + index + 1}.</span>
                  <div>
                    <span className="font-semibold">{listName(row.person)}</span>
                    {tryLabel(row.try_number) ? <span className="text-muted text-sm"> · {tryLabel(row.try_number)}</span> : null}
                    <span className="text-muted block text-sm sm:hidden">
                      {cellLeaderText(row)} ·{' '}
                      {row.birthday_recorded ? 'birthday recorded' : 'birthday missing'}
                    </span>
                  </div>
                </div>
              </td>
              <td className={`hidden px-3 py-3 align-top sm:table-cell ${row.cell_leader_name === null ? 'text-muted' : ''}`}>
                {cellLeaderText(row)}
              </td>
              <td className="hidden px-3 py-3 align-top sm:table-cell">
                {row.birthday_recorded ? (
                  <span className="text-muted text-sm">&#10003; Recorded</span>
                ) : (
                  <Tag appearance="outline">!&nbsp;Missing</Tag>
                )}
              </td>
              <td className="px-3 py-3 align-top">
                <StatusPill status={row.status} />
                {row.class ? <span className="text-muted mt-1 block text-sm">{row.class.name}</span> : null}
                {/* Under the status on a phone, where a column of its own runs past 320px. */}
                {cancellable(row) ? (
                  <div className="mt-2 sm:hidden">
                    <Button type="button" variant="secondary" onClick={() => setCancelling(row)}>
                      Cancel<span className="sr-only"> {row.person.full_name}&rsquo;s registration</span>
                    </Button>
                  </div>
                ) : null}
              </td>
              <td className="hidden px-3 py-3 text-right align-top sm:table-cell">
                {cancellable(row) ? (
                  <Button type="button" variant="secondary" onClick={() => setCancelling(row)}>
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
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              // The next page goes on counting from where this one stopped.
              setOffset(offset + list.data.data.length);
              setCursor(list.data.next_cursor);
            }}
          >
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
  const [writeKey, renewWriteKey] = useWriteKey();
  const cancel = useMutation({
    mutationFn: () =>
      cancelRegistration(
        registration!.id,
        reason.trim(),
        idempotencyKeyFor('equipping-cancel', writeKey, registration!.id, reason.trim()),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['equipping'] });
      setReason('');
      renewWriteKey();
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
        <DialogActions>
          <Button type="submit" disabled={cancel.isPending}>
            Cancel registration
          </Button>
          <Button type="button" variant="secondary" onClick={onClose} data-autofocus>
            Keep it
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

function RegisterDialog({ term, open, onClose }: { term: Term; open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [searched, setSearched] = useState<string | null>(null);
  const [person, setPerson] = useState<FoundPerson | null>(null);
  const [bible, setBible] = useState(false);
  const [manual, setManual] = useState(false);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  const [writeKey, renewWriteKey] = useWriteKey();

  const reset = () => {
    setQuery('');
    setSearched(null);
    setPerson(null);
    setBible(false);
    setManual(false);
    setReason('');
    setNote('');
    setShowErrors(false);
    renewWriteKey();
  };

  const found = useQuery({
    queryKey: ['equipping', 'search', searched],
    queryFn: ({ signal }) => searchPeople(searched!, signal),
    enabled: searched !== null,
  });
  const candidate = useQuery({
    queryKey: ['equipping', 'candidate', person?.id, term.level],
    queryFn: ({ signal }) => getCandidate(person!.id, term.level, signal),
    enabled: person !== null,
  });
  const solTicked = term.level === 'LIFE_CLASS' ? null : SOL_TICKED[term.level];
  const sol = solTicked !== null;
  // A SOL level's manual or book is its third requirement, ticked in its own row, and warns
  // (decisions 0514 and 0516).
  const unmet = [
    ...(candidate.data?.requirements ?? []).filter((each) => !each.met),
    ...(solTicked !== null && !manual ? [{ code: solTicked.code }] : []),
  ];
  const total = (candidate.data?.requirements.length ?? 0) + (sol ? 1 : 0);
  const ticked = sol || (bible && manual);
  const needsReason = unmet.length > 0;
  const today = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Manila',
  }).format(new Date());

  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...term,
        person_id: person!.id,
        ...(sol ? {} : { bible_confirmed: bible }),
        manual_confirmed: manual,
        ...(needsReason ? { exception_reason: reason.trim() } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      };
      return register(body, idempotencyKeyFor('equipping-register', writeKey, body));
    },
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
      title={`Register for ${LEVEL_LABELS[term.level]}`}
    >
      <p className="text-muted text-sm">
        {termLabel(term)} &middot;{' '}
        {solTicked !== null
          ? `the ${LEVEL_LABELS[term.level]} ${solTicked.item} is the tuition, paid outside DREAMS`
          : 'fees and the manual are paid outside DREAMS'}
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
              <SearchResults
                people={found.data.data}
                purpose="register"
                detail={(each) => (each.direct_leader_name ? `Leader: ${each.direct_leader_name}` : null)}
                onChoose={setPerson}
              />
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
          {/* The name on its own line, so a narrow screen never splits it from the Member ID
              (decision 0500). */}
          <div className="border-edge flex items-center justify-between gap-3 rounded-xl border px-4 py-3">
            <div className="min-w-0">
              <p className="font-semibold">{person.full_name}</p>
              <p className="text-muted text-sm">
                <span className="whitespace-nowrap">{person.member_id}</span>
                {person.direct_leader_name ? <> &middot; Leader {person.direct_leader_name}</> : null}
              </p>
            </div>
            <Button type="button" variant="secondary" className="w-auto shrink-0" onClick={() => setPerson(null)}>
              Change
            </Button>
          </div>

          {candidate.data?.earlier_tries && candidate.data.earlier_tries.length > 0 ? (
            <EarlierTries
              tries={candidate.data.earlier_tries}
              term={term}
              level={LEVEL_LABELS[term.level]}
              joins={candidate.data.joins_at_lesson_6 ?? null}
            />
          ) : null}

          <section aria-labelledby="requirements-heading">
            <h3 id="requirements-heading" className="font-semibold">
              Requirements
              {candidate.data ? (
                unmet.length > 0 ? (
                  <span className="text-field-invalid text-sm">
                    {' '}
                    &middot; {unmet.length} of {total} not met
                  </span>
                ) : (
                  <span className="text-muted text-sm font-normal"> &middot; all met</span>
                )
              ) : null}
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
                      {each.met ? <span className="sr-only">, met</span> : null}
                      <span className={each.met ? 'text-muted block text-sm' : 'text-field-invalid block text-sm'}>
                        {each.met ? each.detail : <>Not met &middot; {each.detail}</>}
                      </span>
                    </span>
                  </li>
                ))}
                {solTicked !== null ? (
                  <li className="border-line flex gap-3 px-3 py-2">
                    <input
                      id="sol-manual"
                      type="checkbox"
                      className="accent-accent mt-0.5 size-6 shrink-0"
                      checked={manual}
                      onChange={(event) => setManual(event.target.checked)}
                    />
                    <label htmlFor="sol-manual">
                      <span className="font-semibold">{REQUIREMENT_LABELS[solTicked.code]}</span>
                      <span className={manual ? 'text-muted block text-sm' : 'text-field-invalid block text-sm'}>
                        {manual ? `Ticked by you, ${today}` : 'Not met · tick when they have it'}
                      </span>
                    </label>
                  </li>
                ) : null}
              </ul>
            ) : (
              <FailureNotice failure={describeFailure(candidate.error)} />
            )}
            {/* SOL has no Encounter, so no birthday is needed (decision 0514). */}
            {candidate.data && candidate.data.birth_date === null && !sol ? (
              <p className="border-line mt-3 flex gap-3 rounded-lg border border-l-4 px-4 py-3 text-sm">
                <span aria-hidden="true" className="font-bold">
                  !
                </span>
                <span>
                  <strong>Birthday missing.</strong> Enrollment needs it. Ask{' '}
                  {candidate.data.leader_name ?? 'their leader'} to add it.
                </span>
              </p>
            ) : null}
          </section>

          {sol ? null : (
          <fieldset>
            <legend className="font-semibold">Ask {candidate.data?.leader_name ?? 'their leader'}, then tick</legend>
            <div className="mt-2 grid gap-2 lg:grid-cols-2">
              <Tick boxed checked={bible} onChange={setBible}>
                Has a physical Bible
              </Tick>
              <Tick boxed checked={manual} onChange={setManual}>
                Has the Life Class Manual
              </Tick>
            </div>
            {showErrors && !ticked ? (
              <p className="text-field-invalid mt-2 text-sm">Both are ticked before registering.</p>
            ) : null}
          </fieldset>
          )}

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
          <DialogActions>
            <Button type="submit" disabled={save.isPending}>
              Register
            </Button>
            <Button type="button" variant="secondary" disabled={save.isPending} onClick={() => void submit(true)}>
              Register and add another
            </Button>
            {/* On a phone the title bar's close button is the way out (decision 0500). */}
            <Button
              type="button"
              variant="secondary"
              className="max-lg:hidden"
              onClick={() => {
                reset();
                onClose();
              }}
            >
              Cancel
            </Button>
          </DialogActions>
        </form>
      )}
    </Dialog>
  );
}

/**
 * *Took Life Class before* on the Register form (decision 0511): each earlier try graded *Not
 * passed*, worked out from the posted grades, and which try this one would be. There is no limit
 * on tries, so it informs and never stops a registration.
 */
function EarlierTries({
  tries,
  term,
  level,
  joins,
}: {
  tries: NonNullable<Candidate['earlier_tries']>;
  term: Term;
  level: string;
  joins: KeptFrom | null;
}) {
  // Counted as the lists count it: the terms before this registration's, a term one try (0511).
  const earlierTerms = new Set(
    tries
      .filter(
        (each) =>
          each.term_year < term.term_year || (each.term_year === term.term_year && each.term_number < term.term_number),
      )
      .map((each) => termLabel(each)),
  ).size;
  return (
    <section aria-labelledby="earlier-tries-heading" className="border-line rounded-lg border p-3 text-sm">
      <h3 id="earlier-tries-heading" className="font-semibold">
        Took {level} before
      </h3>
      <ul className="mt-1">
        {tries.map((each) => (
          <li key={`${each.term_year}-${each.term_number}-${each.class_name}`}>
            {termLabel(each)} · {each.class_name} · <strong>Not passed</strong> · {each.reason}
          </li>
        ))}
      </ul>
      {/* Joining at Lesson 6 (decision 0512): what is kept, and what is left. */}
      {joins ? (
        <>
          <p className="mt-2 font-semibold">Joins a later class at Lesson 6</p>
          <p>
            Keeps lessons 1 to 4 and the Encounter from {termLabel(joins)}, so only lessons 6 to 9 are left.
          </p>
        </>
      ) : null}
      <p className="text-muted mt-1">
        This will be their {ordinal(earlierTerms + 1)} try. Every try is kept; there is no limit.
      </p>
    </section>
  );
}
