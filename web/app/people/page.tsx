'use client';

import { useQuery } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { AppShell, PAGE_WIDTH } from '@/components/app-shell';
import { buttonClasses } from '@/components/ui/button';
import { Button } from '@/components/ui/button';
import { FailureNotice } from '@/components/ui/failure-notice';
import { Field } from '@/components/ui/field';
import { describeFailure } from '@/lib/messages';
import {
  MINIMUM_SEARCH_LENGTH,
  networkLabel,
  searchPeople,
  sexLabel,
  type Person,
} from '@/lib/people';
import { cn } from '@/lib/utils';

/**
 * People search, over the searcher's own pastoral scope (SKILL.md section 8).
 *
 * **This screen narrows the directory, and that is the ruling rather than an
 * omission** (decision 0244). A leader opening People sees the people they
 * pastor; the church-wide directory stays reachable from the person pickers,
 * where a task already names somebody specific.
 *
 * *This docblock said the opposite in terms — that the screen "must not narrow"
 * the directory, because scoping the rows "would have them create a second record
 * for somebody another leader already holds". That was the argument the ruling
 * refutes. Duplicate prevention is answered by the church-wide duplicate-candidate
 * lookup, which `/people/new` fires as a name is typed and which `people.create`
 * backs with its own church-wide refusal. It never ran through this screen.*
 *
 * Both are scoped now: the rows by the request, the fields per person as before.
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
    <main id="main" className={PAGE_WIDTH.INDEX}>
      <h1 className="text-2xl font-semibold tracking-tight">People</h1>
      <p className="text-muted mt-2 max-w-2xl text-sm leading-relaxed">
        Search the people you oversee, by name. Somebody outside that will not appear
        here; when you add a person or add a member to a Cell, that search still reaches
        the whole church, so you can find an existing record rather than create a second
        one.
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
          <Button type="submit" disabled={term.trim().length < MINIMUM_SEARCH_LENGTH}>
            Search
          </Button>
          <Link href="/people/new" className={cn(buttonClasses('secondary'))}>
            Add a person
          </Link>
        </div>
      </form>

      {/*
        The live region is mounted always and only its contents change, per
        `FailureNotice`'s own rule: one inserted together with its text is
        frequently not announced at all.
      */}
      <div className="mt-8">
        <FailureNotice failure={results.isError ? describeFailure(results.error) : null} />
      </div>

      <div className="mt-4">
        {submitted.trim().length === 0 ? (
          <p className="text-muted text-sm">Type a name to begin.</p>
        ) : results.isPending ? (
          <p className="text-muted text-sm">Searching…</p>
        ) : results.isError ? null : results.data.data.length === 0 ? (
          <div>
            <p className="text-sm">Nobody you oversee matches &ldquo;{submitted}&rdquo;.</p>
            <p className="text-muted mt-2 text-sm leading-relaxed">
              They may still be elsewhere in the church. Adding a person searches every
              branch as you type, so start there rather than assuming they are new.
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
        // `min-h-11` rather than relying on `py-3` plus however many lines the
        // name happens to wrap to. A row's height was incidental, which made the
        // 2.5.8 exemption for this state true only by accident.
        'focus-visible:outline-accent hover:bg-raised flex min-h-11 flex-wrap items-baseline ' +
        'gap-x-3 gap-y-1 rounded-md px-2 py-3 focus-visible:outline-2 focus-visible:outline-offset-2'
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
