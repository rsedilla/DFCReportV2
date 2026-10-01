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
  correctAccountEmail,
  getAccountForPerson,
  provisionAccount,
  resendActivation,
  resetSecondStep,
  roleLabel,
  setAccountAccess,
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
 * Giving an account, resending its activation email, correcting a mistyped address
 * before activation (decision 0300), and disabling and re-enabling it (decision 0307) are
 * what the pilot's setup needs. Changing a role or a grant is not offered: no route exists
 * for either.
 */
export function PersonAccount({
  personId,
  firstName,
  own,
}: {
  personId: string;
  firstName: string;
  own: boolean;
}) {
  const headingId = useId();
  const queryClient = useQueryClient();
  const [giving, setGiving] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<AccountRole>('LEADER');
  // One key per body (decision 0127): a retry of the same request replays, a changed one
  // is a new request.
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [resendKey, setResendKey] = useState(() => crypto.randomUUID());
  const [correcting, setCorrecting] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [correctKey, setCorrectKey] = useState(() => crypto.randomUUID());
  // Where the link went and which address it replaced, for the line after saving.
  const [corrected, setCorrected] = useState<{ from: string; to: string } | null>(null);

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

  const correct = useMutation({
    mutationFn: (input: { accountId: string; from: string }) =>
      correctAccountEmail(input.accountId, newEmail.trim(), correctKey),
    onSuccess: async (saved, input) => {
      setCorrecting(false);
      setCorrected({ from: input.from, to: saved.email });
      resend.reset();
      await queryClient.invalidateQueries({ queryKey: ['person-account', personId] });
    },
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
                : correct.isError && !fieldErrorFor(correct.error, 'email')
                  ? describeFailure(correct.error)
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
              : current.status === 'DISABLED'
                ? `. ${firstName} can’t sign in.`
                : '.'}
          </p>
          {current.status === 'PENDING_ACTIVATION' ? (
            <div className="mt-3">
              <div className="flex flex-wrap gap-3">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setCorrected(null);
                    resend.mutate(current.id);
                  }}
                  disabled={resend.isPending || correcting}
                >
                  {resend.isPending ? 'Sending…' : 'Resend the activation email'}
                </Button>
                {correcting ? null : (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      // A new key each time the form opens, as for giving an account.
                      setCorrectKey(crypto.randomUUID());
                      setNewEmail('');
                      correct.reset();
                      resend.reset();
                      setCorrected(null);
                      setCorrecting(true);
                    }}
                  >
                    Correct the email
                  </Button>
                )}
              </div>
              {resend.isSuccess ? (
                <p aria-live="polite" className="mt-2 text-sm font-medium">
                  Sent to {current.email}.
                </p>
              ) : null}
              {corrected ? (
                <p aria-live="polite" className="mt-2 text-sm font-medium">
                  Sent to {corrected.to}. The link sent to {corrected.from} no longer works.
                </p>
              ) : null}
              {correcting ? (
                <form
                  className="mt-4 flex max-w-md flex-col gap-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    correct.mutate({ accountId: current.id, from: current.email });
                  }}
                >
                  <Field
                    label="Correct email address"
                    type="email"
                    name="corrected-email"
                    autoComplete="off"
                    required
                    value={newEmail}
                    error={fieldErrorFor(correct.error, 'email')}
                    onChange={(event) => {
                      setNewEmail(event.target.value);
                      setCorrectKey(crypto.randomUUID());
                    }}
                  />
                  <div className="flex flex-wrap gap-3">
                    <Button type="submit" disabled={newEmail.trim() === '' || correct.isPending}>
                      {correct.isPending ? 'Saving…' : 'Save and send to the new address'}
                    </Button>
                    <Button variant="quiet" type="button" onClick={() => setCorrecting(false)}>
                      Cancel
                    </Button>
                  </div>
                </form>
              ) : null}
            </div>
          ) : null}
          {current.second_step.required ? (
            <SecondStepRow
              accountId={current.id}
              personId={personId}
              firstName={firstName}
              administrator={current.roles.includes('ADMIN')}
              setUpAt={current.second_step.set_up_at}
            />
          ) : null}
          <AccessRow
            accountId={current.id}
            personId={personId}
            firstName={firstName}
            disabled={current.status === 'DISABLED'}
            own={own}
          />
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

/**
 * Disabling an account and re-enabling it, each asked before it acts (SKILL.md section 6,
 * decision 0307). Nobody disables their own, and the API refuses it anyway.
 */
function AccessRow({
  accountId,
  personId,
  firstName,
  disabled,
  own,
}: {
  accountId: string;
  personId: string;
  firstName: string;
  disabled: boolean;
  own: boolean;
}) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [key, setKey] = useState(() => crypto.randomUUID());

  const change = useMutation({
    mutationFn: () => setAccountAccess(accountId, disabled ? 'reactivate' : 'disable', key),
    onSuccess: async () => {
      setConfirming(false);
      setKey(crypto.randomUUID());
      await queryClient.invalidateQueries({ queryKey: ['person-account', personId] });
    },
  });

  if (own && !disabled) {
    return (
      <p className="text-muted mt-3 text-sm">
        This is your own account. Another administrator can disable it.
      </p>
    );
  }

  return (
    <div className="mt-3">
      <FailureNotice failure={change.isError ? describeFailure(change.error) : null} />
      {confirming ? (
        <div className="mt-3">
          <p className="text-sm">
            {disabled
              ? `Re-enable ${firstName}’s account? They sign in with their own password, or, if they never set one, you resend the activation email. No old session comes back.`
              : `Disable ${firstName}’s account? They’re signed out on every device at once and can’t sign in until an administrator re-enables it. Their records, Cell and disciples stay as they are.`}
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            <Button disabled={change.isPending} onClick={() => change.mutate()}>
              {change.isPending
                ? disabled
                  ? 'Re-enabling…'
                  : 'Disabling…'
                : disabled
                  ? 'Re-enable'
                  : 'Disable'}
            </Button>
            <Button variant="quiet" type="button" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="secondary"
          onClick={() => {
            // A new key each time, so a refused disable is not replayed as a re-enable.
            setKey(crypto.randomUUID());
            change.reset();
            setConfirming(true);
          }}
        >
          {disabled ? 'Re-enable the account' : 'Disable the account'}
        </Button>
      )}
    </div>
  );
}

/**
 * Whether an administrator's or Senior Pastor's account has its second sign-in step set
 * up, and the reset (SKILL.md section 6, decision 0302). Only a Senior Pastor's is reset
 * here; an administrator's is reset on the server, so no administrator can remove
 * another's, and the API refuses it anyway.
 */
function SecondStepRow({
  accountId,
  personId,
  firstName,
  administrator,
  setUpAt,
}: {
  accountId: string;
  personId: string;
  firstName: string;
  administrator: boolean;
  setUpAt: string | null;
}) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [resetKey, setResetKey] = useState(() => crypto.randomUUID());

  const reset = useMutation({
    mutationFn: () => resetSecondStep(accountId, resetKey),
    onSuccess: async () => {
      setConfirming(false);
      setResetKey(crypto.randomUUID());
      await queryClient.invalidateQueries({ queryKey: ['person-account', personId] });
    },
  });

  return (
    <div className="mt-3">
      <FailureNotice failure={reset.isError ? describeFailure(reset.error) : null} />
      <p className="text-muted text-sm">
        {setUpAt === null
          ? `Second step not set up yet. ${firstName} sets it up at their next sign-in.`
          : `Second step set up ${new Date(setUpAt).toLocaleDateString('en-PH', {
              day: 'numeric',
              month: 'short',
              timeZone: 'Asia/Manila',
            })}.`}
      </p>
      {reset.isSuccess ? (
        <p aria-live="polite" className="mt-2 text-sm font-medium">
          Reset. {firstName} is signed out everywhere and sets it up again at their next sign-in.
        </p>
      ) : null}
      {administrator ? (
        <p className="text-muted mt-2 text-sm">
          An administrator’s second step is reset on the server.
        </p>
      ) : setUpAt === null ? null : confirming ? (
        <div className="mt-3">
          <p className="text-sm">
            Reset {firstName}’s second step? They are signed out on every device and set it up
            again at their next sign-in.
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            <Button disabled={reset.isPending} onClick={() => reset.mutate()}>
              {reset.isPending ? 'Resetting…' : 'Reset'}
            </Button>
            <Button variant="quiet" type="button" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button
          className="mt-3"
          variant="secondary"
          onClick={() => {
            reset.reset();
            setConfirming(true);
          }}
        >
          Reset the second step
        </Button>
      )}
    </div>
  );
}
