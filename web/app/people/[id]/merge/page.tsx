'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useState, type ReactNode } from 'react';

import { AppShell, PAGE_WIDTH } from '@/components/app-shell';
import { PersonPicker } from '@/components/person-picker';
import { SectionFrame } from '@/components/section-frame';
import { Button } from '@/components/ui/button';
import { FailureNotice } from '@/components/ui/failure-notice';
import { FRAME } from '@/components/ui/frame';
import { TextLink } from '@/components/ui/text-link';
import { getAccountForPerson } from '@/lib/accounts';
import { cellShortName, getPersonCells } from '@/lib/cells';
import { getPersonDccAttendance } from '@/lib/dcc';
import { directLeaderOf, getPastoralPath } from '@/lib/hierarchy';
import { idempotencyKeyFor } from '@/lib/idempotency';
import { getMergePreview, mergePerson } from '@/lib/merge';
import { getMe, holdsWholeChurch } from '@/lib/me';
import { describeFailure } from '@/lib/messages';
import { formatMobile } from '@/lib/mobile';
import { getPerson } from '@/lib/people';

/** The longest reason the API takes. */
const REASON_MAX = 500;

/**
 * Merge two records of one person (SKILL.md section 3, decision 0407), as the owner chose it
 * on 2026-10-27: the record kept on the left, the duplicate beside it, what will happen, and a
 * required reason. The API is asked what would refuse the merge before the button is offered,
 * and asks again when it is pressed.
 */
export default function MergePage() {
  // Keyed on both records, so *Swap which one is kept* starts the screen afresh.
  const params = useParams<{ id: string }>();
  const search = useSearchParams();

  return (
    <AppShell>
      <Merge key={`${params.id}:${search.get('duplicate') ?? ''}`} />
    </AppShell>
  );
}

function Merge() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const keptId = params.id;
  const [duplicate, setDuplicate] = useState<{ id: string; full_name: string } | null>(
    search.get('duplicate') ? { id: search.get('duplicate') as string, full_name: '' } : null,
  );
  const [reason, setReason] = useState('');

  const me = useQuery({ queryKey: ['me'], queryFn: ({ signal }) => getMe(signal) });
  const mayMerge = holdsWholeChurch(me.data, 'people.merge');

  const kept = useRecord(keptId);
  const other = useRecord(duplicate?.id ?? null);

  const preview = useQuery({
    queryKey: ['merge-preview', keptId, duplicate?.id],
    queryFn: ({ signal }) => getMergePreview(keptId, duplicate?.id as string, signal),
    enabled: mayMerge && duplicate !== null,
  });

  const merge = useMutation({
    mutationFn: () =>
      mergePerson(
        keptId,
        { duplicate_id: duplicate?.id as string, reason: reason.trim() },
        idempotencyKeyFor('merge-person', keptId, duplicate?.id, reason.trim()),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      router.push(`/people/${keptId}`);
    },
  });

  const refusals = preview.data?.refusals ?? [];
  const ready = duplicate !== null && preview.isSuccess && refusals.length === 0;
  const keptPerson = kept.person.data;
  const otherPerson = other.person.data;

  return (
    <main id="main" className={PAGE_WIDTH.RECORD}>
      <SectionFrame section="people">
        <p className="text-sm">
          <TextLink href={`/people/${keptId}`}>Back to this person</TextLink>
        </p>
        <h1 className="mt-4 text-xl font-semibold tracking-tight">Merge two records of one person</h1>
        <p className="text-muted mt-2 max-w-2xl text-sm leading-relaxed">
          The record you keep stays; the other is joined into it. Both histories are kept, and
          reports count them as one person from now on, past months included. A merge cannot be
          undone.
        </p>

        {!me.isPending && !mayMerge ? (
          <div className="mt-6">
            <FailureNotice
              failure={{ message: 'Only the Admin merges two records.', aboutInput: false }}
            />
          </div>
        ) : (
          <>
            <div className={`mt-6 ${FRAME}`}>
              <PersonPicker
                legend="The duplicate"
                description="The other record of this same person. It is joined into the record you keep and retired."
                searchLabel="Search for the duplicate by name or Member ID"
                selectedId={duplicate?.id ?? null}
                selectedName={duplicate?.full_name || otherPerson?.full_name || null}
                onSelect={(person) => {
                  merge.reset();
                  setDuplicate(person);
                }}
                excludeIds={[keptId]}
              />
            </div>

            {duplicate !== null && keptPerson && otherPerson ? (
              <>
                <div className="mt-6 overflow-x-auto">
                  <table className="w-full min-w-[32rem] text-sm">
                    <thead>
                      <tr>
                        <th className="w-36" />
                        <th className="py-2 pr-3 text-left font-semibold">Keep</th>
                        <th className="py-2 text-left font-semibold">Join into it</th>
                      </tr>
                    </thead>
                    <tbody>
                      <Row label="Name" kept={<strong>{keptPerson.full_name}</strong>} other={<strong>{otherPerson.full_name}</strong>} />
                      <Row label="Member ID" kept={keptPerson.member_id} other={otherPerson.member_id} />
                      <Row label="Birthday" kept={keptPerson.birth_date ?? '—'} other={otherPerson.birth_date ?? '—'} />
                      <Row
                        label="Mobile"
                        kept={keptPerson.mobile_number ? formatMobile(keptPerson.mobile_number) : '—'}
                        other={otherPerson.mobile_number ? formatMobile(otherPerson.mobile_number) : '—'}
                      />
                      <Row label="Leader" kept={kept.leader} other={other.leader} />
                      <Row label="Cell Group" kept={kept.cell} other={other.cell} />
                      <Row label="DCC Sundays" kept={kept.sundays} other={other.sundays} />
                      <Row label="Account" kept={kept.account} other={other.account} />
                    </tbody>
                  </table>
                </div>
                <p className="mt-3 text-sm">
                  <TextLink
                    href={`/people/${duplicate.id}/merge?duplicate=${keptId}`}
                    onClick={() => setReason('')}
                  >
                    Swap which one is kept
                  </TextLink>
                </p>

                {preview.isError ? (
                  <div className="mt-6">
                    <FailureNotice failure={describeFailure(preview.error)} />
                  </div>
                ) : null}

                {refusals.length > 0 ? (
                  <div className="border-field-invalid text-field-invalid mt-6 border p-4 text-sm leading-relaxed">
                    <p className="font-medium">This merge can’t be done yet</p>
                    <ul className="mt-1 list-inside list-disc">
                      {refusals.map((refusal) => (
                        <li key={refusal.code}>{refusal.message}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <div className={`mt-6 ${FRAME} text-sm leading-relaxed`}>
                  <p className="font-medium">What happens</p>
                  <ul className="text-muted mt-2 list-inside list-disc">
                    <li>{otherPerson.member_id} is retired and never reused.</li>
                    <li>The kept record keeps its leader and Cell; the other’s leader and Cell end.</li>
                    {copies(keptPerson, otherPerson).map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                    <li>Their Sundays, Cell meetings, lessons and graduations count for {keptPerson.member_id}.</li>
                    <li>Past totals that counted both drop by one.</li>
                    {other.accountActive ? <li>{otherPerson.member_id}’s account is disabled.</li> : null}
                  </ul>
                </div>

                {ready ? (
                  <>
                    <label htmlFor="merge-reason" className="field-label mt-6 block">
                      Why are these the same person? (required)
                    </label>
                    <textarea
                      id="merge-reason"
                      value={reason}
                      onChange={(event) => {
                        merge.reset();
                        setReason(event.target.value);
                      }}
                      rows={2}
                      maxLength={REASON_MAX}
                      className="border-edge focus-visible:outline-accent mt-2 w-full border px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
                    />
                    {merge.isError ? (
                      <div className="mt-3">
                        <FailureNotice failure={describeFailure(merge.error)} />
                      </div>
                    ) : null}
                    <div className="mt-6 flex flex-wrap gap-3">
                      <Button
                        disabled={merge.isPending || reason.trim() === ''}
                        onClick={() => merge.mutate()}
                      >
                        {merge.isPending
                          ? 'Merging…'
                          : `Merge ${otherPerson.member_id} into ${keptPerson.member_id}`}
                      </Button>
                      <Button variant="secondary" onClick={() => router.push(`/people/${keptId}`)}>
                        Cancel
                      </Button>
                    </div>
                  </>
                ) : null}
              </>
            ) : null}
          </>
        )}
      </SectionFrame>
    </main>
  );
}

function Row({ label, kept, other }: { label: string; kept: ReactNode; other: ReactNode }) {
  return (
    <tr className="border-line border-b">
      <th className="text-muted py-2 pr-3 text-left text-xs font-semibold tracking-wider uppercase">
        {label}
      </th>
      <td className="py-2 pr-3">{kept}</td>
      <td className="py-2">{other}</td>
    </tr>
  );
}

/** What point 3 of decision 0407 copies: a detail the kept record lacks. */
function copies(
  kept: { birth_date: string | null; mobile_number: string | null },
  other: { birth_date: string | null; mobile_number: string | null },
): string[] {
  const lines: string[] = [];
  if (kept.birth_date === null && other.birth_date !== null) {
    lines.push('The birthday the kept record lacks is copied over.');
  }
  if (kept.mobile_number === null && other.mobile_number !== null) {
    lines.push('The mobile number the kept record lacks is copied over.');
  }
  return lines;
}

/** One record's side of the comparison, read through the routes its page reads. */
function useRecord(id: string | null) {
  const enabled = id !== null;
  const person = useQuery({
    queryKey: ['person', id],
    queryFn: ({ signal }) => getPerson(id as string, signal),
    enabled,
  });
  const path = useQuery({
    queryKey: ['pastoral-path', id],
    queryFn: ({ signal }) => getPastoralPath(id as string, signal),
    enabled,
  });
  const cells = useQuery({
    queryKey: ['person-cells', id],
    queryFn: ({ signal }) => getPersonCells(id as string, signal),
    enabled,
    retry: false,
  });
  const dcc = useQuery({
    queryKey: ['person-dcc', id, null],
    queryFn: ({ signal }) => getPersonDccAttendance(id as string, null, signal),
    enabled,
    retry: false,
  });
  const account = useQuery({
    queryKey: ['account-for-person', id],
    queryFn: ({ signal }) => getAccountForPerson(id as string, signal),
    enabled,
    retry: false,
  });

  const entries = path.data?.data ?? [];
  const root = entries.length === 1 && entries[0].network_root === true;
  const membership = cells.data?.membership ?? null;
  const leads = cells.data?.leads ?? [];

  return {
    person,
    leader: root ? 'Network root' : (directLeaderOf(entries)?.full_name ?? '—'),
    cell:
      leads.length > 0
        ? `Leads ${leads.map((cell) => cellShortName(cell)).join(', ')}`
        : membership
          ? cellShortName(membership)
          : '—',
    sundays: dcc.data ? String(dcc.data.attended) : '—',
    account: account.data?.account
      ? account.data.account.status === 'DISABLED'
        ? 'Disabled'
        : 'Yes'
      : 'None',
    accountActive:
      account.data?.account !== null &&
      account.data?.account !== undefined &&
      account.data.account.status !== 'DISABLED',
  };
}
