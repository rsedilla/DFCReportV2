'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';

import { AppShell, PAGE_WIDTH } from '@/components/app-shell';
import { CountCards, ReportsHeading, ReportsTabs } from '@/components/reports-tabs';
import { FailureNotice } from '@/components/ui/failure-notice';
import { FRAME } from '@/components/ui/frame';
import {
  addDays,
  dayLabel,
  lastWeekendOf,
  listEncounterSeasons,
  seasonLabel,
  weekendLabel,
} from '@/lib/encounters';
import { getSuynlCounts } from '@/lib/growth';
import { getMe, holdsWholeChurch } from '@/lib/me';
import { describeFailure } from '@/lib/messages';
import { todayInManila } from '@/lib/reporting-month';

/**
 * SUYNL under Reports (decisions 0292 and 0296): the Growth tab's three counts, read only
 * and as of now, from the same route under the same capability, and the next Encounter
 * season an administrator has set. Lessons are ticked under Growth.
 */
export default function Page() {
  return (
    <AppShell>
      <Suynl />
    </AppShell>
  );
}

const link =
  'text-accent focus-visible:outline-accent inline-flex min-h-11 items-center underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2';

function Suynl() {
  const today = todayInManila();
  const counts = useQuery({ queryKey: ['suynl-counts'], queryFn: ({ signal }) => getSuynlCounts(signal) });
  const seasons = useQuery({
    queryKey: ['encounter-seasons'],
    queryFn: ({ signal }) => listEncounterSeasons(signal),
  });
  const me = useQuery({ queryKey: ['me'], queryFn: ({ signal }) => getMe(signal) });
  const mayChange = holdsWholeChurch(me.data, 'settings.manage');

  // The next season is the first whose later weekend, of those shown, has not yet ended. Which
  // half a reader is shown is the API's to decide (decision 0296).
  const shows = seasons.data?.shows;
  const next = (seasons.data?.data ?? []).find(
    (season) => lastWeekendOf(season) !== '' && addDays(lastWeekendOf(season), 2) >= today,
  );

  return (
    <main id="main" className={PAGE_WIDTH.INDEX}>
      <ReportsHeading
        line={`SUYNL for ${counts.data ? `the ${counts.data.people} ${counts.data.people === 1 ? 'person' : 'people'}` : 'the people'} in your care, as of today.`}
      />
      <ReportsTabs current="suynl" />
      <div className="mt-6">
        <FailureNotice
          failure={
            counts.isError
              ? describeFailure(counts.error)
              : seasons.isError
                ? describeFailure(seasons.error)
                : null
          }
        />
      </div>

      <section className={`mt-2 ${FRAME}`} aria-labelledby="encounter-heading">
        <h2 id="encounter-heading" className="field-label">
          {next ? `Next Encounter · ${seasonLabel(next)}` : 'Next Encounter'}
        </h2>
        {seasons.isPending ? (
          <p className="text-muted mt-2 text-sm">Loading&hellip;</p>
        ) : next ? (
          <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
            {next.mens_encounter_on && next.mens_lc_party_on ? (
              <div>
                <dt className="font-bold">Men</dt>
                <dd>LC Party {dayLabel(next.mens_lc_party_on)}</dd>
                <dd>Encounter {weekendLabel(next.mens_encounter_on)}</dd>
              </div>
            ) : null}
            {next.womens_encounter_on && next.womens_lc_party_on ? (
              <div>
                <dt className="font-bold">Women</dt>
                <dd>LC Party {dayLabel(next.womens_lc_party_on)}</dd>
                <dd>Encounter {weekendLabel(next.womens_encounter_on)}</dd>
              </div>
            ) : null}
          </dl>
        ) : shows === 'NEITHER' ? (
          <p className="mt-2 text-sm">You are in no Network, so no Encounter weekend is shown.</p>
        ) : (
          <p className="mt-2 text-sm">No Encounter season has been set yet.</p>
        )}
        <p className="mt-2 text-sm">
          <Link href="/growth/training/encounters" className={link}>
            {mayChange ? 'Encounter seasons: add or change dates' : 'Every Encounter season'}
          </Link>
        </p>
      </section>

      <CountCards
        cards={[
          { label: 'Not started', count: counts.data?.not_started },
          { label: 'In progress', count: counts.data?.in_progress },
          { label: 'Graduated', count: counts.data?.graduated },
        ]}
      />
      <p className="mt-6 text-sm">
        <Link href="/growth/suynl" className={link}>
          Tick lessons in Growth
        </Link>
      </p>
    </main>
  );
}
