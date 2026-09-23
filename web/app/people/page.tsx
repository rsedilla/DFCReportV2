'use client';

import { useQueries, useQuery } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { AppShell, PAGE_WIDTH } from '@/components/app-shell';
import { buttonClasses } from '@/components/ui/button';
import { Button } from '@/components/ui/button';
import { FailureNotice } from '@/components/ui/failure-notice';
import { Field } from '@/components/ui/field';
import { HeaderCell, Table, rowClasses } from '@/components/ui/table';
import { cellShortName, getPersonCells, type PersonCells } from '@/lib/cells';
import { describeFailure } from '@/lib/messages';
import {
  MINIMUM_SEARCH_LENGTH,
  networkLabel,
  searchPeople,
  type Person,
} from '@/lib/people';
import { useScreenAddress } from '@/lib/screen-address';
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
 * **It opens on everyone the searcher oversees, ten a page, A to Z by surname** (decision
 * 0259, the owner's design adjusted). Each row names the person's pastoral
 * leader and Cell; a search narrows it by name or Member ID. The design's journey stage
 * and "Last recorded" columns are not here: each needs a ruling first.
 *
 * **No result count and no page numbers.** Section 22 paginates by cursor and
 * returns no total, so both would be invented.
 */
export default function PeoplePage() {
  return (
    <AppShell>
      <PeopleList />
    </AppShell>
  );
}

const PAGE_SIZE = 10;

function PeopleList() {
  // The search lives in the address, so Back returns to the previous one and a reload — or a
  // link somebody sends — opens the same results.
  const search = useSearchParams();
  const go = useScreenAddress();
  const submitted = search.get('q') ?? '';
  // What is being typed is not yet what is being asked, so it stays here and follows the
  // address, which Back and a reload change underneath it.
  const [term, setTerm] = useState(submitted);
  // Paging is deliberately not in the address: a cursor belongs to one set of rows. A new
  // search — including one arrived at by pressing Back — starts the list again.
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [page, setPage] = useState(0);

  // Adjusted while rendering rather than in an effect, which is React's own answer for state
  // that follows something from outside: an effect would render the old results once first.
  const [lastSubmitted, setLastSubmitted] = useState(submitted);
  if (lastSubmitted !== submitted) {
    setLastSubmitted(submitted);
    setTerm(submitted);
    setCursors([null]);
    setPage(0);
  }

  const results = useQuery({
    queryKey: ['people', submitted, cursors[page], PAGE_SIZE],
    queryFn: ({ signal }) => searchPeople(submitted, cursors[page], signal, { limit: PAGE_SIZE }),
  });

  const rows = results.data?.data ?? [];
  // Each person's Cell, read one person at a time under `cell.view_subtree` (decision 0248).
  const cells = useQueries({
    queries: rows.map((person) => ({
      queryKey: ['person-cells', person.id],
      queryFn: ({ signal }: { signal: AbortSignal }) => getPersonCells(person.id, signal),
      enabled: person.scope === 'FULL',
      retry: false,
    })),
  });

  const trimmed = term.trim();
  const tooShort = trimmed.length > 0 && trimmed.length < MINIMUM_SEARCH_LENGTH;

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (tooShort) {
      return;
    }
    go({ q: trimmed });
  }

  return (
    <main id="main" className={PAGE_WIDTH.INDEX}>
      <h1 className="text-2xl font-semibold tracking-tight">People</h1>
      <p className="text-muted mt-2 max-w-2xl text-sm leading-relaxed">
        Everyone within your pastoral scope, you included. Adding a person, or a member to a
        Cell, still searches the whole church, so you can find an existing record rather than
        create a second one.
      </p>

      {/* Stacked on a phone and inline from `sm` up, so the search box keeps its width. */}
      <form
        onSubmit={onSubmit}
        // In the same grey bar as every other screen's controls (owner's choice, 2026-09-22).
        className="border-line bg-raised mt-6 flex flex-col gap-3 border p-4 sm:flex-row sm:items-end"
        noValidate
      >
        <Field
          label="Search by name or Member ID"
          type="search"
          name="q"
          autoComplete="off"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          className="min-w-0 sm:flex-1"
        />
        <div className="flex gap-3">
          <Button type="submit" disabled={tooShort}>
            {trimmed.length === 0 && submitted !== '' ? 'Show everyone' : 'Search'}
          </Button>
          <Link href="/people/new" className={cn(buttonClasses('secondary'))}>
            Add a person
          </Link>
        </div>
      </form>

      {/* Mounted always, per `FailureNotice`'s own rule. */}
      <div className="mt-8">
        <FailureNotice failure={results.isError ? describeFailure(results.error) : null} />
      </div>

      <div className="mt-4">
        {results.isPending ? (
          <p className="text-muted text-sm">Loading&hellip;</p>
        ) : results.isError ? null : rows.length === 0 ? (
          submitted === '' ? (
            <p className="text-sm">Nobody is within your scope.</p>
          ) : (
            <div>
              <p className="text-sm">Nobody you oversee matches &ldquo;{submitted}&rdquo;.</p>
              <p className="text-muted mt-2 text-sm leading-relaxed">
                They may still be elsewhere in the church. Adding a person searches every branch
                as you type, so start there rather than assuming they are new.
              </p>
            </div>
          )
        ) : (
          <>
            <Table caption="People within your scope" className="hidden sm:block">
              <thead>
                <tr>
                  <HeaderCell>Name</HeaderCell>
                  <HeaderCell>Pastoral leader</HeaderCell>
                  <HeaderCell>Cell</HeaderCell>
                </tr>
              </thead>
              <tbody>
                {rows.map((person, index) => (
                  <tr key={person.id} className={rowClasses}>
                    <td className="px-3 py-3 align-top">
                      <PersonName person={person} />
                    </td>
                    <td className="px-3 py-3 align-top">{leaderOf(person)}</td>
                    <td className="px-3 py-3 align-top">{cellOf(person, cells[index]?.data)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <ul className="border-line divide-line divide-y border-t border-b sm:hidden">
              {rows.map((person, index) => (
                <li key={person.id} className="py-3">
                  <PersonName person={person} />
                  <p className="text-muted mt-1 text-sm">
                    {[leaderOf(person), cellOf(person, cells[index]?.data)]
                      .filter((part) => part !== '')
                      .join(' · ')}
                  </p>
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

function PersonName({ person }: { person: Person }) {
  return (
    <>
      <Link
        href={`/people/${person.id}`}
        className="focus-visible:outline-accent inline-flex min-h-6 items-center font-medium underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        {person.full_name}
      </Link>
      <span className="text-muted block font-mono text-xs">{person.member_id}</span>
      {person.scope === 'IDENTITY_ONLY' ? (
        <span className="text-muted flex items-center gap-1.5 text-xs">
          {/* Decorative: the words beside it carry the meaning (1.4.1). */}
          <Lock aria-hidden="true" className="size-3 shrink-0" />
          {networkLabel(person.network)} · Details visible to their own leaders
        </span>
      ) : null}
    </>
  );
}

function leaderOf(person: Person): string {
  return person.direct_leader_name ?? '';
}

/** "Young Pro · Sat", "Leads Young Pro · Sat", or "Not in a Cell"; nothing while unread. */
function cellOf(person: Person, cells: PersonCells | undefined): string {
  if (person.scope !== 'FULL' || cells === undefined) {
    return '';
  }

  const parts = [
    ...cells.leads.map((cell) => `Leads ${cellShortName(cell)}`),
    ...(cells.membership ? [cellShortName(cells.membership)] : []),
  ];

  return parts.length > 0 ? parts.join('; ') : 'Not in a Cell';
}
