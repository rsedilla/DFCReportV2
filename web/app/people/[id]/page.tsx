'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';

import { AppShell, PAGE_WIDTH } from '@/components/app-shell';
import { ArchivePersonDialog } from '@/components/archive-person-dialog';
import { SectionFrame } from '@/components/section-frame';
import { CorrectSexDialog } from '@/components/correct-sex-dialog';
import { MoveLeaderDialog } from '@/components/move-leader-dialog';
import { PersonAccount } from '@/components/person-account';
import { PersonCells } from '@/components/person-cells';
import { PersonDcc } from '@/components/person-dcc';
import { PersonGrowth } from '@/components/person-growth';
import { Button, buttonClasses } from '@/components/ui/button';
import { FailureNotice } from '@/components/ui/failure-notice';
import { CONTROL_BAR, FRAME } from '@/components/ui/frame';
import { TextLink } from '@/components/ui/text-link';
import { ApiRequestError } from '@/lib/api-client';
import { cellShortName, getPersonCells, type PersonCells as PersonCellsData } from '@/lib/cells';
import {
  directLeaderOf,
  getPastoralPath,
  noLeaderLabel,
  type PastoralPath,
  type PathEntry,
} from '@/lib/hierarchy';
import { idempotencyKeyFor } from '@/lib/idempotency';
import { archiveReasonLabel, restorePerson, shortDate } from '@/lib/lifecycle';
import { getMe, holdsWholeChurch } from '@/lib/me';
import { describeFailure, type Failure } from '@/lib/messages';
import { formatMobile } from '@/lib/mobile';
import { NEGATIVE_AGE, ageFrom, civilStatusLabel, getPerson, sexLabel } from '@/lib/people';
import { useOffered } from '@/lib/screen-guard';
import { cn } from '@/lib/utils';

/**
 * One person's record (SKILL.md sections 3 and 8).
 *
 * **Reaching this screen for somebody outside your pastoral scope is a refusal,
 * not a redaction, and the code is `SCOPE_DENIED`.** `GET /people/{id}` is
 * guarded on the target, so the guard refuses with 403 — deliberately *not*
 * `NOT_FOUND`, which section 22 declines to substitute here "because Section 8
 * already discloses minimal identity church-wide by design".
 *
 * **The refusal is said in plain words, not the API's** (owner's choice of 2026-09-15).
 * The API's sentence names a capability no leader has reason to know, so a refusal of this
 * reader — scope or capability alike — reads as a fact about the person and what to do,
 * the way the DCC section of this profile already words its own. It is shown for those
 * two codes and no other: rendering it on every failure asserted a domain fact for a
 * mistyped id, a merged-away record, a server error and a dropped connection alike.
 *
 * **Who pastors them is shown under the name**, from the pastoral path, which is read under
 * the same capability as this record. On your own profile the leader is plain text rather
 * than a link, because your own leader is above you and their record would refuse you.
 *
 * **Move to another leader is its own action** beside Edit details, offered to an account
 * holding `people.manage_pastoral_assignment` at any scope and never on your own profile,
 * which section 5 forbids. Whether a particular move is allowed is still the API's. A Leader holds it
 * only when ticked *Moves people* (decision 0356); one without it reads, in its place, who makes moves.
 *
 * **Age is derived here and never stored.** Section 3 keeps the birthday as the
 * authoritative value precisely because it cannot go stale, and the API returns
 * no age at all — a client that wants one computes it.
 *
 * **A missing birthday is ordinary and is shown as such.** The 2026-08-24 ruling
 * made it optional, and gave the reason: a mandatory field people cannot fill
 * gets filled with fictions, and a fabricated date is worse than none because two
 * of the three Tier 1 duplicate rules read it — so an invented birthday makes the
 * matcher refuse a real person. Somebody may also simply have declined to give
 * it, which is a decision rather than a gap, so nothing here nags.
 */
export default function PersonPage() {
  return (
    <AppShell>
      <PersonDetail />
    </AppShell>
  );
}

function PersonDetail() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const person = useQuery({
    queryKey: ['person', id],
    queryFn: ({ signal }) => getPerson(id, signal),
  });

  const path = useQuery({
    queryKey: ['pastoral-path', id],
    queryFn: ({ signal }) => getPastoralPath(id, signal),
  });

  const me = useQuery({ queryKey: ['me'], queryFn: ({ signal }) => getMe(signal) });
  const offered = useOffered();
  // The same read the Cell section below makes, so the header line costs no request.
  const cells = useQuery({
    queryKey: ['person-cells', id],
    queryFn: ({ signal }) => getPersonCells(id, signal),
    retry: false,
  });
  const [moving, setMoving] = useState(false);
  const [correcting, setCorrecting] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const queryClient = useQueryClient();
  // Back to current and nothing else (decision 0397, point 9); the API checks it again.
  const restore = useMutation({
    mutationFn: () => restorePerson(id, idempotencyKeyFor('restore-person', id, person.data?.archived?.archived_at ?? '')),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['person', id] });
      await queryClient.invalidateQueries({ queryKey: ['people-archived'] });
    },
  });

  const own = me.data?.person_id === id;
  const mayMove =
    !own &&
    (me.data?.capabilities ?? []).some(
      (grant) => grant.capability === 'people.manage_pastoral_assignment',
    );

  // The Account section, for an administrator (decision 0276). The API checks it again.
  const mayManageAccounts = (me.data?.capabilities ?? []).some(
    (grant) => grant.capability === 'accounts.manage',
  );
  // Full view is ticked under `roles.manage` (decision 0323); the API checks it again.
  const mayTickFullView = (me.data?.capabilities ?? []).some(
    (grant) => grant.capability === 'roles.manage',
  );
  // Correct sex, the Admin's alone (section 4, decision 0367); the API checks it again.
  const mayCorrectSex = holdsWholeChurch(me.data, 'people.correct_sex');
  const mayBackdate = holdsWholeChurch(me.data, 'records.backdate_effective_date');
  const pathEntries = path.data?.data ?? [];
  // Archive and Restore, the Admin's alone (decision 0397); never on your own page, never for
  // a Network root, and for somebody leading a Cell the page says what to resolve first.
  const mayArchive = !own && holdsWholeChurch(me.data, 'people.manage_lifecycle');
  const isRoot = pathEntries.length === 1 && pathEntries[0].network_root === true;
  const leads = cells.data?.leads ?? [];

  // An unrecorded birthday or mobile number offers to add it, and there is no list of
  // them anywhere (SKILL.md section 3, decision 0272).
  const mayEdit = (me.data?.capabilities ?? []).some(
    (grant) => grant.capability === 'people.edit_basic',
  );

  const refused =
    person.error instanceof ApiRequestError &&
    (person.error.code === 'SCOPE_DENIED' || person.error.code === 'CAPABILITY_DENIED');

  return (
    <main id="main" className={PAGE_WIDTH.INDEX}>
      <SectionFrame section="people">
      {offered('/people') ? (
        <p className="text-sm">
          <TextLink href="/people">Back to people</TextLink>
        </p>
      ) : null}

      {person.isPending ? (
        <p className="text-muted mt-6 text-sm">Loading…</p>
      ) : person.isError ? (
        <div className="mt-6">
          <FailureNotice failure={refused ? REFUSED : describeFailure(person.error)} />

          {refused ? (
            <p className="text-muted mt-4 max-w-xl text-sm leading-relaxed">
              Their details are visible to the leaders who pastor them. If you need something
              from this record, ask one of those leaders.
            </p>
          ) : null}
        </div>
      ) : (
        <>
          <h1 className="mt-4 text-xl font-semibold tracking-tight">{person.data.full_name}</h1>
          <p className="text-muted mt-1 text-sm">
            <span className="font-mono">{person.data.member_id}</span>
            {cells.data ? ` · ${cellLine(cells.data)}` : null}
          </p>
          <PastoredBy
            path={path.data?.data ?? null}
            reason={path.data?.no_leader_reason ?? null}
            own={own}
          />

          {/* Read-only, for every reader who may open the page (decision 0397, point 10). */}
          {person.data.archived ? (
            <div className="border-line bg-raised mt-4 flex flex-col gap-3 border p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm leading-relaxed">
                <p>
                  <strong>Archived</strong> on {shortDate(person.data.archived.archived_at)} ·{' '}
                  {archiveReasonLabel(person.data.archived.reason)}
                </p>
                {person.data.archived.note ? (
                  <p className="text-muted mt-1">{person.data.archived.note}</p>
                ) : null}
              </div>
              {mayArchive ? (
                <Button
                  variant="secondary"
                  disabled={restore.isPending}
                  onClick={() => restore.mutate()}
                >
                  {restore.isPending ? 'Restoring…' : 'Restore'}
                </Button>
              ) : null}
            </div>
          ) : null}
          {restore.isError ? (
            <div className="mt-3">
              <FailureNotice failure={describeFailure(restore.error)} />
            </div>
          ) : null}

          {/* The actions in one bar under the name (owner's choice, 2026-09-22). */}
          <div className={`mt-6 ${CONTROL_BAR}`}>
            {/* Offered only to an account that may edit a person (decision 0379): a Senior
                Pastor holds no `people.edit_basic` (decision 0326), and the route still decides. */}
            {mayEdit ? (
              <Link href={`/people/${id}/edit`} className={cn(buttonClasses('secondary'))}>
                Edit details
              </Link>
            ) : null}
            {mayMove ? (
              <Button variant="secondary" onClick={() => setMoving(true)}>
                Move to another leader
              </Button>
            ) : null}
            <Link href={`/people/${id}/network`} className={cn(buttonClasses('secondary'))}>
              Where they sit
            </Link>
            {mayArchive &&
            !person.data.archived &&
            !isRoot &&
            cells.isSuccess &&
            leads.length === 0 &&
            (person.data.pastors ?? 0) === 0 ? (
              <Button variant="secondary" onClick={() => setArchiving(true)}>
                Archive
              </Button>
            ) : null}
          </div>
          {mayArchive && !person.data.archived && leads.length > 0 ? (
            <p className="text-muted mt-3 text-sm">
              Leads {leads.map((cell) => cell.cell_id).join(', ')}: hand{' '}
              {leads.length === 1 ? 'it' : 'them'} over or close {leads.length === 1 ? 'it' : 'them'}{' '}
              before archiving.
            </p>
          ) : mayArchive && !person.data.archived && (person.data.pastors ?? 0) > 0 ? (
            <p className="text-muted mt-3 text-sm">
              Pastors {person.data.pastors} {person.data.pastors === 1 ? 'person' : 'people'}: move
              them to another leader first.
            </p>
          ) : null}
          {mayArchive ? (
            <ArchivePersonDialog
              open={archiving}
              onClose={() => setArchiving(false)}
              person={{ id, full_name: person.data.full_name }}
            />
          ) : null}
          {/* No button and no request: the Primary decides (owner, 2026-10-16, decision 0356). */}
          {me.data && !own && !mayMove ? (
            <p className="text-muted mt-3 text-sm">Moves to another leader are made by your Primary.</p>
          ) : null}


          {/*
            Their attendance on the left, the facts about them on the right, from `lg`;
            below it one column in the order it always had.
          */}
          <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div className="flex min-w-0 flex-col gap-4">
          <PersonDcc personId={id} />
          <PersonGrowth personId={id} memberId={person.data.member_id} />
          </div>
          <div className="flex min-w-0 flex-col gap-4">
          <PersonCells personId={id} personName={person.data.full_name} className="" />
          <section aria-labelledby="details-heading" className={FRAME}>
            <h2 id="details-heading" className="field-label">
              Details
            </h2>
          <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-[9rem_1fr]">
            <Detail label="Title" value={person.data.title} />
            <Detail label="First name" value={person.data.first_name} />
            <Detail label="Middle name" value={person.data.middle_name} />
            <Detail label="Last name" value={person.data.last_name} />
            <Detail
              label="Sex"
              value={sexLabel(person.data.sex)}
              action={
                mayCorrectSex && path.data
                  ? { label: 'Correct', name: 'Correct sex', onClick: () => setCorrecting(true) }
                  : null
              }
            />
            <Detail label="Civil status" value={civilStatusLabel(person.data.civil_status)} />
            <Detail
              label="Birthday"
              value={person.data.birth_date}
              // Not "unknown" and not "missing": section 3 permits no birthday,
              // and somebody may have chosen not to give one.
              absent="Not recorded"
              add={mayEdit ? { href: `/people/${id}/edit#birth_date`, what: 'a birthday' } : null}
            />
            <Detail
              label="Age"
              value={ageLabel(person.data.birth_date)}
              // Only where no birthday is recorded. A birthday that *is*
              // recorded but cannot yield an age says so instead — see
              // `ageLabel` — because "needs a birthday" beside a displayed
              // birthday contradicts the line above it.
              absent="Needs a birthday"
            />
            <Detail
              label="Mobile number"
              value={person.data.mobile_number && formatMobile(person.data.mobile_number)}
              nowrap
              absent="Not recorded"
              add={
                mayEdit ? { href: `/people/${id}/edit#mobile_number`, what: 'a mobile number' } : null
              }
            />
          </dl>
          </section>
          {mayManageAccounts ? (
            <PersonAccount
              personId={id}
              firstName={person.data.first_name}
              own={own}
              mayTickFullView={mayTickFullView}
            />
          ) : null}
          </div>
          </div>

          {mayCorrectSex && path.data ? (
            <CorrectSexDialog
              open={correcting}
              onClose={() => setCorrecting(false)}
              personId={id}
              personName={person.data.full_name}
              sex={person.data.sex}
              isRoot={pathEntries.length === 1 && pathEntries[0].network_root === true}
              leaderName={directLeaderOf(pathEntries)?.full_name ?? null}
              cells={cells.data}
              mayBackdate={mayBackdate}
            />
          ) : null}

          {mayMove ? (
            <MoveLeaderDialog
              open={moving}
              onClose={() => setMoving(false)}
              personId={id}
              personName={person.data.full_name}
              currentLeaderName={directLeaderOf(path.data?.data ?? [])?.full_name ?? null}
            />
          ) : null}
        </>
      )}
      </SectionFrame>
    </main>
  );
}

const REFUSED: Failure = {
  message: 'This person is not one of the people you oversee, so their details are not shown to you.',
  aboutInput: false,
};

/**
 * Who pastors this person, or why nobody is shown.
 *
 * Nothing while the path loads or if it fails: the record above already carries this
 * screen's refusal, and a second notice about the same reader would say it twice.
 */
function PastoredBy({
  path,
  reason,
  own,
}: {
  path: readonly PathEntry[] | null;
  reason: PastoralPath['no_leader_reason'];
  own: boolean;
}) {
  if (path === null || path.length === 0) {
    return null;
  }

  const leader = directLeaderOf(path);

  return (
    <p className="mt-2 text-sm">
      {leader ? (
        <>
          Pastored by{' '}
          {own ? (
            <span className="font-medium">{leader.full_name}</span>
          ) : (
            <TextLink href={`/people/${leader.id}`}>{leader.full_name}</TextLink>
          )}
        </>
      ) : (
        noLeaderLabel(path, reason)
      )}
    </p>
  );
}

/**
 * The age, or why there is not one.
 *
 * Three outcomes rather than two: an age, no birthday at all, and a birthday
 * that cannot produce an age because it is in the future. The third is a
 * mis-keyed year, and calling it "needs a birthday" beside the date it was
 * derived from tells the reader something the record disproves.
 */
function ageLabel(birthDate: string | null): string | null {
  const age = ageFrom(birthDate);

  if (age === null) {
    return null;
  }

  return age === NEGATIVE_AGE ? 'Birthday is in the future — check the year' : `${age}`;
}

function Detail({
  label,
  value,
  absent = '—',
  add = null,
  action = null,
  nowrap = false,
}: {
  label: string;
  value: string | null;
  /** Kept on one line, as a hyphenated mobile number is (lib/mobile.ts). */
  nowrap?: boolean;
  absent?: string;
  /** Offered only where the value is absent and the reader may edit it. */
  add?: { href: string; what: string } | null;
  /** An action on the value itself, such as correcting a sex (decision 0367). */
  action?: { label: string; name: string; onClick: () => void } | null;
}) {
  return (
    <>
      <dt className="text-sm font-medium">{label}</dt>
      <dd className={value ? 'text-sm' : 'text-muted text-sm'}>
        {value && nowrap ? <span className="whitespace-nowrap">{value}</span> : value || absent}
        {!value && add ? (
          <>
            {' · '}
            <TextLink href={add.href} aria-label={`Add ${add.what}`}>
              Add
            </TextLink>
          </>
        ) : null}
        {action ? (
          <>
            {' · '}
            <button
              type="button"
              onClick={action.onClick}
              aria-label={action.name}
              className="focus-visible:outline-accent inline-flex min-h-6 items-center underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              {action.label}
            </button>
          </>
        ) : null}
      </dd>
    </>
  );
}

/** "Young Pro · Sat", or "Leads Young Pro · Sat", for the line under the name. */
function cellLine(cells: PersonCellsData): string {
  const parts = [
    ...cells.leads.map((cell) => `Leads ${cellShortName(cell)}`),
    ...(cells.membership ? [cellShortName(cells.membership)] : []),
  ];

  return parts.length > 0 ? parts.join('; ') : 'Not in a Cell';
}
