'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';

import { Button } from '@/components/ui/button';
import { FailureNotice } from '@/components/ui/failure-notice';
import { FRAME } from '@/components/ui/frame';
import { Field } from '@/components/ui/field';
import { RadioGroup } from '@/components/ui/radio-group';
import { Tag } from '@/components/ui/tag';
import {
  accountStatusLabel,
  getAccountForPerson,
  provisionAccount,
  resendActivation,
  roleLabel,
  type AccountRole,
} from '@/lib/accounts';
import { describeFailure, fieldErrorFor } from '@/lib/messages';

/**
 * A person's account, for an administrator (SKILL.md section 6; decision 0276).
 *
 * **On the person page rather than behind an Admin sidebar item**, because which
 * capabilities show that item is open. The page renders this only for a reader holding
 * `accounts.manage`; the API checks it on every request.
 *
 * Giving an account and resending its activation email are the two things the pilot's
 * setup needs. Changing a role or a grant is not offered: no route exists for either.
 */
export function PersonAccount({ personId, firstName }: { personId: string; firstName: string }) {
  const headingId = useId();
  const queryClient = useQueryClient();
  const [giving, setGiving] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<AccountRole>('LEADER');
  // One key per body (decision 0127): a retry of the same request replays, a changed one
  // is a new request.
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [resendKey, setResendKey] = useState(() => crypto.randomUUID());

  const account = useQuery({
    queryKey: ['person-account', personId],
    queryFn: ({ signal }) => getAccountForPerson(personId, signal),
    retry: false,
  });

  const give = useMutation({
    mutationFn: () => provisionAccount({ person_id: personId, email: email.trim(), role }, key),
    onSuccess: async () => {
      setGiving(false);
      await queryClient.invalidateQueries({ queryKey: ['person-account', personId] });
    },
  });

  const resend = useMutation({
    mutationFn: (accountId: string) => resendActivation(accountId, resendKey),
    onSuccess: () => setResendKey(crypto.randomUUID()),
  });

  const current = account.data?.account ?? null;

  return (
    <section aria-labelledby={headingId} className={FRAME}>
      <h2 id={headingId} className="field-label flex flex-wrap items-center gap-2">
        Account
        {current ? <Tag appearance="outline">{accountStatusLabel(current.status)}</Tag> : null}
      </h2>

      <div className="mt-3">
        <FailureNotice
          failure={
            account.isError
              ? describeFailure(account.error)
              : resend.isError
                ? describeFailure(resend.error)
                : give.isError && !fieldErrorFor(give.error, 'email')
                  ? describeFailure(give.error)
                  : null
          }
        />
      </div>

      {account.isPending ? (
        <p className="text-muted mt-2 text-sm">Loading&hellip;</p>
      ) : account.isError ? null : current ? (
        <div className="mt-2">
          <p className="text-muted text-sm">
            {current.email} · {current.roles.map(roleLabel).join(', ') || 'No role'} · created{' '}
            {new Date(current.created_at).toLocaleDateString('en-PH', {
              day: 'numeric',
              month: 'short',
              timeZone: 'Asia/Manila',
            })}
            {current.status === 'PENDING_ACTIVATION'
              ? `. ${firstName} hasn’t set a password yet.`
              : '.'}
          </p>
          {current.status === 'PENDING_ACTIVATION' ? (
            <div className="mt-3">
              <Button
                variant="secondary"
                onClick={() => resend.mutate(current.id)}
                disabled={resend.isPending}
              >
                {resend.isPending ? 'Sending…' : 'Resend the activation email'}
              </Button>
              {resend.isSuccess ? (
                <p aria-live="polite" className="mt-2 text-sm font-medium">
                  Sent to {current.email}.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : giving ? (
        <form
          className="mt-3 flex max-w-md flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            give.mutate();
          }}
        >
          <Field
            label="Email address"
            type="email"
            name="email"
            autoComplete="off"
            required
            value={email}
            error={fieldErrorFor(give.error, 'email')}
            onChange={(event) => {
              setEmail(event.target.value);
              setKey(crypto.randomUUID());
            }}
          />
          <RadioGroup
            legend="Role"
            description="A Leader needs to lead a Cell first, or the account is refused. A Senior Pastor must be one of the two people the configuration names."
            name="role"
            value={role}
            onChange={(value) => {
              setRole(value);
              setKey(crypto.randomUUID());
            }}
            options={[
              { value: 'LEADER', label: 'Leader' },
              { value: 'SENIOR_PASTOR', label: 'Senior Pastor' },
              { value: 'ADMIN', label: 'Admin' },
            ]}
          />
          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={email.trim() === '' || give.isPending}>
              {give.isPending ? 'Creating…' : 'Create and send the activation email'}
            </Button>
            <Button variant="quiet" type="button" onClick={() => setGiving(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="mt-2">
          <p className="text-muted text-sm">No account. {firstName} cannot sign in.</p>
          <Button
            className="mt-3"
            onClick={() => {
              // A new key each time the form opens, so a stored refusal is not replayed
              // once whatever caused it has been fixed.
              setKey(crypto.randomUUID());
              give.reset();
              setGiving(true);
            }}
          >
            Give {firstName} an account
          </Button>
        </div>
      )}
    </section>
  );
}
