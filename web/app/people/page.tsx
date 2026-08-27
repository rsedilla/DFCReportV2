'use client';

import { useQuery } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { AppShell } from '@/components/app-shell';
import { buttonClasses } from '@/components/ui/button';
import { Button } from '@/components/ui/button';
import { FailureNotice } from '@/components/ui/failure-notice';
import { Field } from '@/components/ui/field';
import { describeFailure } from '@/lib/messages';
import { networkLabel, searchPeople, sexLabel, type Person } from '@/lib/people';
import { cn } from '@/lib/utils';

/**
 * Church-wide people search (SKILL.md section 8).
 *
 * **The directory is church-wide on purpose, and this screen must not narrow
 * it.** Section 8 lets a leader search every name in the church precisely so that
 * duplicate prevention works: scoping results to their own subtree would have
 * them create a second record for somebody another leader already holds, which
 * is the failure section 3's whole matching apparatus exists to prevent. What is
 * scoped is the *fields*, not the rows.
 *
 * **So a row comes back in one of two shapes, and the difference is stated
 * rather than implied.** For somebody outside the viewer's pastoral scope the
 * API returns five fields — Member ID, full name, sex, Network, and the name of
 * their direct leader — and marks the row `IDENTITY_ONLY`. This screen says so in
 * words, because the alternative is a person who reads as though they have no
 * birthday and no mobile number rather than one whose details this viewer may
 * not see.
 *
 * It is not an error and is not rendered as one. There is no `field-invalid`
 * here, no warning colour, and nothing that ranks or grades a person — sections
 * 13, 17 and 19 forbid the last of those, and section 23 keeps the one state
 * token for form fields.
 *
 * **No result count and no page numbers.** Section 22 paginates by cursor and
 * returns no total, so both would be invented.
 */
export default function PeoplePage() {
  return (
    <AppShell>
      <PeopleSearch />
    </AppShell>
  );
}

function PeopleSearch() {
  const [term, setTerm] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [page, setPage] = useState(0);

  const results = useQuery({
    queryKey: ['people', submitted, cursors[page]],
    queryFn: ({ signal }) => searchPeople(submitted, cursors[page], signal),
    enabled: submitted.trim().length > 0,
  });

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCursors([null]);
    setPage(0);
    setSubmitted(term);
  }

  return (
    <main id="main" className="mx-auto max-w-5xl px-5 py-8 sm:py-12">
      <h1 className="text-2xl font-semibold tracking-tight">People</h1>
      <p className="text-muted mt-2 max-w-2xl text-sm leading-relaxed">
        Search everyone in the church by name. You will see the details of people you pastor;
        for everyone else you will see who they are and who leads them, so you can ask rather
        than create a second record.
      </p>

      {/*
        Stacked on a phone and inline from `sm` up. Wrapping all three onto one
        row left the search box 107px wide at 375px — narrower than the two
        buttons beside it, on the control the screen exists for. Section 23 makes
        the phone a current surface, so this is the layout that has to be right
        first.
      */}
      <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-end" noValidate>
        <Field
          label="Search by name"
          type="search"
          name="q"
          autoComplete="off"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          className="min-w-0 sm:flex-1"
        />
        <div className="flex gap-3">
          <Button type="submit" disabled={term.trim().length === 0}>
            Search
          </Button>
          <Link href="/people/new" className={cn(buttonClasses('secondary'))}>
            Add a person
          </Link>
        </div>
      </form>

      <div className="mt-8">
        {submitted.trim().length === 0 ? (
          <p className="text-muted text-sm">Type a name to begin.</p>
        ) : results.isPending ? (
          <p className="text-muted text-sm">Searching…</p>
        ) : results.isError ? (
          <FailureNotice failure={describeFailure(results.error)} />
        ) : results.data.data.length === 0 ? (
          <div>
            <p className="text-sm">Nobody matches “{submitted}”.</p>
            <p className="text-muted mt-2 text-sm leading-relaxed">
              This searched the whole church, not only the people you pastor. If they are new,
              add them.
            </p>
          </div>
        ) : (
          <>
            <ul className="border-line divide-line divide-y border-t border-b">
              {results.data.data.map((person) => (
                <li key={person.id}>
                  <PersonRow person={person} />
                </li>
              ))}
            </ul>

            <nav aria-label="Results" className="mt-6 flex items-center gap-3">
              <Button
                variant="secondary"
                disabled={page === 0}
                onClick={() => setPage((current) => Math.max(0, current - 1))}
              >
                Previous
              </Button>
              <Button
                variant="secondary"
                disabled={!results.data.next_cursor}
                onClick={() => {
                  const next = results.data.next_cursor;
                  if (!next) {
                    return;
                  }
                  setCursors((current) => {
                    const copy = current.slice(0, page + 1);
                    copy.push(next);
                    return copy;
                  });
                  setPage((current) => current + 1);
                }}
              >
                Next
              </Button>
            </nav>
          </>
        )}
      </div>
    </main>
  );
}

function PersonRow({ person }: { person: Person }) {
  const withheld = person.scope === 'IDENTITY_ONLY';

  return (
    <Link
      href={`/people/${person.id}`}
      className={
        'focus-visible:outline-accent hover:bg-raised flex flex-wrap items-baseline gap-x-3 ' +
        'gap-y-1 rounded-md px-2 py-3 focus-visible:outline-2 focus-visible:outline-offset-2'
      }
    >
      <span className="text-base font-medium">{person.full_name}</span>
      <span className="text-muted font-mono text-sm">{person.member_id}</span>

      {withheld ? (
        <span className="text-muted flex basis-full items-center gap-1.5 text-sm">
          {/*
            Decorative: the sentence beside it carries the meaning. An icon is
            not text, and colour is never the only indicator (1.4.1).
          */}
          <Lock aria-hidden="true" className="size-3.5 shrink-0" />
          {networkLabel(person.network)}
          {person.direct_leader_name ? ` · led by ${person.direct_leader_name}` : ''}
          {' · '}
          <span>Details visible to their own leaders</span>
        </span>
      ) : (
        <span className="text-muted basis-full text-sm">
          {sexLabel(person.sex)}
          {person.mobile_number ? ` · ${person.mobile_number}` : ''}
        </span>
      )}
    </Link>
  );
}
