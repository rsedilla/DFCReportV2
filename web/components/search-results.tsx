'use client';

import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';

/**
 * The people a search found, each with a *Choose* button (owner, 2026-11-20, option B, as *Add a
 * member* already shows them). A line above says how many were found and what choosing does,
 * so nobody looks for an OK button: choosing a person is the next step.
 */
export function SearchResults<T extends { id: string; full_name: string | null; member_id?: string | null }>({
  people,
  purpose,
  detail,
  onChoose,
}: {
  people: T[];
  /** What choosing does, finishing "Choose the person to …", e.g. "register". */
  purpose: string;
  /** A second line under the name, e.g. their leader. */
  detail?: (person: T) => ReactNode;
  onChoose: (person: T) => void;
}) {
  return (
    <>
      <p role="status" className="mt-4 text-sm font-semibold">
        {people.length === 1 ? '1 person found.' : `${people.length} people found.`} Choose the person to {purpose}.
      </p>
      <ul className="divide-line border-line mt-2 divide-y rounded-md border">
        {people.map((each) => (
          <li key={each.id} className="flex items-center justify-between gap-3 px-3 py-2">
            <span className="min-w-0">
              <span className="font-semibold">{each.full_name}</span>
              {each.member_id ? <span className="text-muted whitespace-nowrap"> · {each.member_id}</span> : null}
              {detail ? <span className="text-muted block text-sm">{detail(each)}</span> : null}
            </span>
            <Button type="button" variant="secondary" className="w-auto shrink-0" onClick={() => onChoose(each)}>
              Choose<span className="sr-only"> {each.full_name}</span>
            </Button>
          </li>
        ))}
      </ul>
    </>
  );
}
