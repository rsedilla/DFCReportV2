'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Fragment, useState } from 'react';

import { AppShell, PAGE_WIDTH } from '@/components/app-shell';
import { CountCards, ReportsHeading, ReportsTabs } from '@/components/reports-tabs';
import { FailureNotice } from '@/components/ui/failure-notice';
import { FRAME } from '@/components/ui/frame';
import { HeaderCell, Table, rowClasses } from '@/components/ui/table';
import {
  addDays,
  lastWeekendOf,
  listEncounterSeasons,
  seasonLabel,
  weekendLabel,
} from '@/lib/encounters';
import {
  getSuynlCounts,
  getSuynlReadiness,
  type ReadinessFigures,
  type SuynlReadiness,
} from '@/lib/growth';
import { getMe, holdsWholeChurch } from '@/lib/me';
import { describeFailure } from '@/lib/messages';
import { todayInManila } from '@/lib/reporting-month';

/**
 * SUYNL under Reports (decisions 0292, 0296 and 0297): the next Encounter season as four
 * steps, who is getting ready for its LC Party row by row, and
 * the Growth tab's three counts, all read only and as of now. Lessons are ticked under Growth.
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

/** How far ahead of the Encounter the steps begin: a reminder only, which refuses nothing. */
const READY_DAYS_BEFORE = 70;

const shortDay = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });

function Suynl() {
  const today = todayInManila();
  const leader = useSearchParams().get('leader');
  const counts = useQuery({ queryKey: ['suynl-counts'], queryFn: ({ signal }) => getSuynlCounts(signal) });
  const seasons = useQuery({
    queryKey: ['encounter-seasons'],
    queryFn: ({ signal }) => listEncounterSeasons(signal),
  });
  const readiness = useQuery({
    queryKey: ['suynl-readiness', leader],
    queryFn: ({ signal }) => getSuynlReadiness(leader, signal),
  });
  const me = useQuery({ queryKey: ['me'], queryFn: ({ signal }) => getMe(signal) });
  const mayChange = holdsWholeChurch(me.data, 'settings.manage');

  // The next season is the first whose later weekend, of those shown, has not yet ended. Which
  // half a reader is shown is the API's to decide (decision 0296).
  const shows = seasons.data?.shows;
  const next = (seasons.data?.data ?? []).find(
    (season) => lastWeekendOf(season) !== '' && addDays(lastWeekendOf(season), 2) >= today,
  );
  const lines = next
    ? [
        { network: 'Men’s', party: next.mens_lc_party_on, encounter: next.mens_encounter_on },
        { network: 'Women’s', party: next.womens_lc_party_on, encounter: next.womens_encounter_on },
      ].flatMap((line) =>
        line.party !== null && line.encounter !== null
          ? [{ network: line.network, party: line.party, encounter: line.encounter }]
          : [],
      )
    : [];

  return (
    <main id="main" className={PAGE_WIDTH.INDEX}>
      <ReportsHeading line="Who is getting ready for the next Encounter God Weekend, as of today." />
      <ReportsTabs current="suynl" />
      <div className="mt-6">
        <FailureNotice
          failure={
            readiness.isError
              ? describeFailure(readiness.error)
              : counts.isError
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
          lines.map((line) => (
            <div key={line.network} className="mt-3">
              {lines.length > 1 ? <h3 className="text-sm font-bold">{line.network} Network</h3> : null}
              <Steps party={line.party} encounter={line.encounter} today={today} />
            </div>
          ))
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

      {leader !== null ? (
        <p className="mt-4 text-sm">
          <Link href="/reports/suynl" className={link}>
            Back to your report
          </Link>
        </p>
      ) : null}

      {readiness.isPending ? (
        <p className="text-muted mt-4 text-sm">Loading&hellip;</p>
      ) : readiness.data ? (
        <ReadinessTable readiness={readiness.data} opened={leader !== null} />
      ) : null}

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

/**
 * The four steps to one Network's weekend (decision 0297): from ten weeks out, the LC Party,
 * Life Class lessons 1 to 4 weekly from the week after it, and the Encounter as lesson 5
 * (decision 0295). The step we are in is outlined, never coloured.
 */
function Steps({ party, encounter, today }: { party: string; encounter: string; today: string }) {
  const from = addDays(encounter, -READY_DAYS_BEFORE);
  const box = 'border-line border p-3';
  return (
    <ol className="mt-2 grid gap-2 text-sm sm:grid-cols-4">
      <li className={today >= from && today < party ? `${box} border-ink border-2` : box}>
        <b>From {shortDay(from)}</b>
        <br />
        <span className="text-muted">Ten weeks out: get people ready</span>
      </li>
      <li className={box}>
        <b>LC Party</b>
        <br />
        <span className="text-muted">{shortDay(party)}</span>
      </li>
      <li className={box}>
        <b>Life Class lessons 1–4</b>
        <br />
        <span className="text-muted">from {shortDay(addDays(party, 7))}</span>
      </li>
      <li className={box}>
        <b>Encounter = lesson 5</b>
        <br />
        <span className="text-muted">{weekendLabel(encounter)}</span>
      </li>
    </ol>
  );
}

const COLUMNS = [
  ['completed', 'Completed (10 of 10)'],
  ['seven_to_nine', '7–9 lessons'],
  ['one_to_six', '1–6 lessons'],
] as const;

/**
 * Who is getting ready for the LC Party (decision 0297): the subject's direct disciples, or a
 * whole-church reader's two pastors, each counting everyone in their branch now, then the
 * subject alone, then the total. People already at the Encounter or in Life Class are not
 * counted. Rows are in the API's order, never sorted by a figure, never coloured (section 13).
 * A name shows the people behind the row; "their 12" opens that leader's own table.
 */
function ReadinessTable({ readiness, opened }: { readiness: SuynlReadiness; opened: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  const cell = 'px-3 py-3 text-right tabular-nums';
  const byRoot = readiness.own === null;
  const subjectName = opened ? (readiness.subject?.full_name ?? 'This leader') : null;
  const title = subjectName !== null ? `${subjectName}’s 12` : byRoot ? 'The whole church' : 'My 12';

  const figureCells = (figures: Omit<ReadinessFigures, 'members'>) => (
    <>
      {COLUMNS.map(([key]) => (
        <td key={key} className={cell}>
          {figures[key]}
        </td>
      ))}
      <td className={`${cell} font-bold`}>{figures.people}</td>
    </>
  );

  return (
    <section className={`mt-4 ${FRAME}`} aria-labelledby="ready-heading">
      <h2 id="ready-heading" className="field-label">
        {title} · SUYNL, getting ready for the Encounter
      </h2>
      <p className="text-muted mt-1 text-sm leading-relaxed">
        Each row counts that leader and everyone under them, as of today. People already at the
        Encounter or in Life Class are not counted.
        {readiness.rows.length > 0 ? ' Open a name to see the people.' : ''}
      </p>
      <Table caption={`${title} · SUYNL readiness`} className="mt-3">
        <thead>
          <tr>
            <HeaderCell>Leader</HeaderCell>
            {COLUMNS.map(([key, label]) => (
              <HeaderCell key={key} className="text-right">
                {label}
              </HeaderCell>
            ))}
            <HeaderCell className="text-right">People</HeaderCell>
          </tr>
        </thead>
        <tbody>
          {readiness.rows.map((row, index) => {
            const key = row.leader?.id ?? `unnamed-${index}`;
            return (
              <Fragment key={key}>
                <tr className={rowClasses}>
                  <td className="px-3 py-3">
                    {row.leader === null ? (
                      <span className="text-muted">A leader who cannot be named</span>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => setOpen(open === key ? null : key)}
                          aria-expanded={open === key}
                          className="text-accent focus-visible:outline-accent inline-flex min-h-6 items-center text-left underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
                        >
                          {row.network
                            ? `${row.leader.full_name} · ${row.network === 'MENS' ? 'Men’s' : 'Women’s'}`
                            : row.leader.full_name}
                        </button>{' '}
                        {row.leads_anyone ? (
                          <Link
                            href={`/reports/suynl?${new URLSearchParams({ leader: row.leader.id }).toString()}`}
                            className="text-muted focus-visible:outline-accent inline-flex min-h-6 items-center text-xs underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
                          >
                            their 12
                          </Link>
                        ) : null}
                      </>
                    )}
                  </td>
                  {figureCells(row)}
                </tr>
                {open === key ? (
                  <tr>
                    <td colSpan={COLUMNS.length + 2} className="bg-raised px-3 py-3 text-sm">
                      <People members={row.members} />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}

          {readiness.own === null ? null : (
            <tr className={rowClasses}>
              <td className="px-3 py-3">{subjectName ?? 'You'}</td>
              {figureCells(readiness.own)}
            </tr>
          )}

          {readiness.elsewhere === null || readiness.elsewhere.people === 0 ? null : (
            <tr className={rowClasses}>
              <td className="text-muted px-3 py-3 italic">In neither pastor’s branch</td>
              {figureCells(readiness.elsewhere)}
            </tr>
          )}

          <tr className="border-edge border-t-2 font-bold">
            <td className="px-3 py-3">Total</td>
            {figureCells(readiness.total)}
          </tr>
        </tbody>
      </Table>
    </section>
  );
}

/** The people behind a row, grouped by column, each with their lessons. */
function People({ members }: { members: ReadinessFigures['members'] }) {
  if (members.length === 0) {
    return <span className="text-muted">Nobody in this branch is counted.</span>;
  }
  const groups = [
    ['Completed', members.filter((person) => person.lessons >= 10)],
    ['7–9 lessons', members.filter((person) => person.lessons >= 7 && person.lessons < 10)],
    ['1–6 lessons', members.filter((person) => person.lessons < 7)],
  ] as const;
  return (
    <>
      {groups.map(([label, people]) =>
        people.length === 0 ? null : (
          <p key={label}>
            <b>{label}:</b> {people.map((person) => `${person.full_name} (${person.lessons})`).join(' · ')}
          </p>
        ),
      )}
    </>
  );
}
