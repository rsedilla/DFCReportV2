'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useMemo, type Dispatch, type ReactNode, type SetStateAction } from 'react';

import { GrowthCards, GrowthFilters, StillToFinish, type GrowthCard } from '@/components/growth-controls';
import { Button } from '@/components/ui/button';
import { CursorPager } from '@/components/ui/cursor-pager';
import { FailureNotice } from '@/components/ui/failure-notice';
import { ApiRequestError } from '@/lib/api-client';
import { type GrowthListQuery } from '@/lib/growth';
import { idempotencyKeyFor } from '@/lib/idempotency';
import { getMe } from '@/lib/me';
import { describeFailure } from '@/lib/messages';
import { useCursorPages } from '@/lib/cursor-pages';
import { usePageSize } from '@/lib/page-size';
import { useScreenAddress } from '@/lib/screen-address';

/**
 * The list and draft the SUYNL and Training tabs share (SKILL.md section 28): the address
 * that holds the search, filter and card, the two reads, and saving a draft whole.
 */

interface PersonRow {
  person_id: string;
  full_name: string;
  may_file: boolean;
}

/** The address, the counts and one page of people, for the tab named. */
export function useGrowthList<Counts, Row extends PersonRow>({
  name,
  getCounts,
  listPeople,
}: {
  name: 'suynl' | 'training';
  getCounts: (signal?: AbortSignal) => Promise<Counts>;
  listPeople: (
    query: GrowthListQuery,
    signal?: AbortSignal,
  ) => Promise<{ data: Row[]; next_cursor: string | null }>;
}) {
  const search = useSearchParams();
  const go = useScreenAddress();
  const q = search.get('q') ?? '';
  const mine = search.get('mine') === '1';
  const step = search.get('step');
  const everyone = search.get('all') === '1';
  // Opens on those still to finish (decision 0287); a card, a search, Only my disciples or
  // Show everyone widens it.
  const listStep = step ?? (q === '' && !mine && !everyone ? 'STILL_TO_FINISH' : null);

  const me = useQuery({ queryKey: ['me'], queryFn: ({ signal }) => getMe(signal) });
  const pageSize = usePageSize();
  // A new size starts the list again, so no row is skipped between two page lengths.
  const pages = useCursorPages(`${q}|${mine}|${listStep ?? ''}|${pageSize}`);

  const counts = useQuery({
    queryKey: [`${name}-counts`],
    queryFn: ({ signal }) => getCounts(signal),
  });
  const people = useQuery({
    queryKey: [`${name}-people`, q, mine, listStep, pages.cursor, pageSize],
    queryFn: ({ signal }) =>
      listPeople(
        {
          q,
          mine,
          step: listStep ?? undefined,
          cursor: pages.cursor,
          limit: pageSize,
        },
        signal,
      ),
  });

  const rows = useMemo(() => people.data?.data ?? [], [people.data]);

  return { name, q, mine, step, everyone, go, me, pages, counts, people, rows };
}

type GrowthList<Counts, Row extends PersonRow> = ReturnType<typeof useGrowthList<Counts, Row>>;

/**
 * Saving the draft whole, and Reload after a stale save: it refetches, and keeps only the
 * draft lines `keep` says are still made against what is now stored.
 */
export function useGrowthSave<Counts, Row extends PersonRow, Entry, Change>({
  list,
  changes,
  submit,
  setDraft,
  keep,
  onSaved,
}: {
  list: GrowthList<Counts, Row>;
  changes: Change[];
  submit: (changes: Change[], idempotencyKey: string) => Promise<unknown>;
  setDraft: Dispatch<SetStateAction<Record<string, Entry>>>;
  keep: (entry: Entry, rows: Map<string, Row>) => boolean;
  onSaved: () => void;
}) {
  const queryClient = useQueryClient();
  const idempotencyKey = useMemo(() => idempotencyKeyFor(list.name, changes), [list.name, changes]);

  const save = useMutation({
    mutationFn: () => submit(changes, idempotencyKey),
    onSuccess: async () => {
      onSaved();
      await queryClient.invalidateQueries({ queryKey: [`${list.name}-people`] });
      await queryClient.invalidateQueries({ queryKey: [`${list.name}-counts`] });
    },
  });

  const stale = save.error instanceof ApiRequestError && save.error.code === 'VERSION_CONFLICT';

  async function reload() {
    const fresh = await list.people.refetch();
    await list.counts.refetch();
    const byPerson = new Map((fresh.data?.data ?? []).map((row) => [row.person_id, row]));

    setDraft((current) =>
      Object.fromEntries(Object.entries(current).filter(([, entry]) => keep(entry, byPerson))),
    );
    save.reset();
  }

  return { save, stale, reload };
}

/**
 * The search bar, the cards, and what the opening view leaves out. A tab that says nothing of
 * those who have finished passes no `stillToFinish`, as SUYNL does (decision 0386).
 */
export function GrowthListControls<Counts, Row extends PersonRow>({
  list,
  cards,
  stillToFinish,
}: {
  list: GrowthList<Counts, Row>;
  cards: GrowthCard[];
  stillToFinish?: { finished: number | undefined; what: string };
}) {
  const { q, mine, step, everyone, go } = list;
  // **Only my disciples is offered where it would narrow the list** (decision 0384): once the
  // counts say someone listed is neither the reader nor a direct disciple, or could not be
  // read. It stays while it is on, so it can be turned off, and waits for the counts rather
  // than flashing.
  const counts = list.counts.data as { beyond_direct_disciples?: number } | undefined;
  const offersMine =
    mine || list.counts.isError || (counts !== undefined && counts.beyond_direct_disciples !== 0);

  return (
    <>
      <GrowthFilters
        submitted={q}
        mine={mine}
        offersMine={offersMine}
        onSearch={(term) => go({ q: term })}
        onMine={(next) => go({ mine: next ? '1' : null })}
      />

      <GrowthCards cards={cards} selected={step} onSelect={(next) => go({ step: next, all: null })} />

      {stillToFinish && step === null && q === '' && !mine ? (
        <StillToFinish
          everyone={everyone}
          finished={stillToFinish.finished}
          what={stillToFinish.what}
          onChange={(all) => go({ all: all ? '1' : null })}
        />
      ) : null}
    </>
  );
}

/**
 * The first failure of the two reads. A refused save is said in the save bar instead
 * ({@link GrowthSaveFailure}), beside Save, where the reader is looking.
 */
export function GrowthFailure<Counts, Row extends PersonRow>({
  list,
}: {
  list: GrowthList<Counts, Row>;
}) {
  const { people, counts } = list;

  return (
    <div className="mt-8">
      <FailureNotice
        failure={
          people.isError
            ? describeFailure(people.error)
            : counts.isError
              ? describeFailure(counts.error)
              : null
        }
      />
    </div>
  );
}

/** A refused save, with Reload after a stale one, for the save bar to show. */
export function GrowthSaveFailure({
  growthSave,
}: {
  growthSave: { save: { isError: boolean; error: unknown }; stale: boolean; reload: () => Promise<void> };
}) {
  const { save, stale, reload } = growthSave;

  // The live region is mounted with the bar, before anything goes wrong, so a screen
  // reader announces the refusal when it arrives; empty, it takes no room.
  return (
    <div className={save.isError ? undefined : 'sr-only'}>
      <FailureNotice failure={save.isError ? describeFailure(save.error) : null} />
      {stale ? (
        <Button variant="secondary" className="mt-3" onClick={() => void reload()}>
          Reload
        </Button>
      ) : null}
    </div>
  );
}

/** Loading, nobody, or the rows and the pager. */
export function GrowthRows<Counts, Row extends PersonRow>({
  list,
  children,
}: {
  list: GrowthList<Counts, Row>;
  children: ReactNode;
}) {
  const { people, rows, pages } = list;

  return (
    <div className="mt-4">
      {people.isPending ? (
        <p className="text-muted text-sm">Loading&hellip;</p>
      ) : people.isError ? null : rows.length === 0 ? (
        <p className="text-sm">Nobody here matches.</p>
      ) : (
        <>
          {children}
          <CursorPager
            label="Results"
            page={pages.page}
            nextCursor={people.data.next_cursor}
            onPrevious={pages.previous}
            onNext={() => pages.next(people.data.next_cursor)}
          />
        </>
      )}
    </div>
  );
}

/** A row's name, and why the reader may not file for them where they may not. */
export function GrowthPersonName({ row, self }: { row: PersonRow; self: boolean }) {
  return (
    <div>
      <Link
        href={`/people/${row.person_id}`}
        className="focus-visible:outline-accent inline-flex min-h-6 items-center font-medium underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        {row.full_name}
      </Link>
      {!row.may_file ? (
        // Decision 0280: nobody records their own; anyone else here is somebody the
        // reader may not file for, a Network root among them, who has no leader.
        <span className="text-muted block text-xs">
          {self ? 'You · another leader records these' : 'Not yours to record'}
        </span>
      ) : null}
    </div>
  );
}
