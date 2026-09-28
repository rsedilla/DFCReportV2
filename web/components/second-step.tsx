'use client';

import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

import { AuthCard } from '@/components/auth-card';
import { Button } from '@/components/ui/button';
import { FailureNotice } from '@/components/ui/failure-notice';
import { Field } from '@/components/ui/field';
import { ApiRequestError } from '@/lib/api-client';
import { describeFailure, type Failure } from '@/lib/messages';
import {
  completeSecondStep,
  confirmSecondStepSetup,
  startSecondStepSetup,
  type SecondStepChallenge,
} from '@/lib/session';

const DEVICE_LABEL = 'Web browser';

/**
 * The second sign-in step of an administrator or Senior Pastor (SKILL.md section 6,
 * decision 0302), shown after the password.
 *
 * **The code field accepts paste and autofill** (`one-time-code`), so an authenticator
 * on the same device fills it with no typing. Typed from another device it is the one
 * stated exception to 3.3.8 (section 23).
 *
 * `onSignInAgain` returns to the password with a message, for a ticket that has expired
 * or run out of tries; `onDone` is called once a session has been adopted.
 */
export function SecondStep({
  start,
  onDone,
  onSignInAgain,
}: {
  start: SecondStepChallenge;
  onDone: () => void;
  onSignInAgain: (message: string) => void;
}) {
  const [screen, setScreen] = useState<'code' | 'recovery' | 'scan' | 'confirm' | 'codes'>(
    start.second_step === 'SETUP' ? 'scan' : 'code',
  );
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);

  /** A refusal of what was typed stays on the field; anything else ends the sign-in. */
  function refusal(cause: unknown): string | Failure {
    if (cause instanceof ApiRequestError && cause.code === 'UNAUTHENTICATED') {
      if (cause.details.reason === 'CODE_INCORRECT') {
        return cause.message;
      }
      onSignInAgain(cause.message);
      return '';
    }
    return describeFailure(cause);
  }

  if (screen === 'codes') {
    return <RecoveryCodes codes={recoveryCodes} onDone={onDone} />;
  }

  if (screen === 'scan' || screen === 'confirm') {
    return (
      <Setup
        challenge={start.challenge}
        confirming={screen === 'confirm'}
        onNext={() => setScreen('confirm')}
        onBack={() => setScreen('scan')}
        onConfirmed={(codes) => {
          setRecoveryCodes(codes);
          setScreen('codes');
        }}
        refusal={refusal}
        onSignInAgain={onSignInAgain}
      />
    );
  }

  const recovery = screen === 'recovery';

  return (
    <CodeForm
      key={screen}
      title={recovery ? 'Use a recovery code' : 'Enter your code'}
      intro={
        recovery
          ? 'Each recovery code works once. If your phone is lost, ask an administrator to reset your second step.'
          : 'Open your authenticator app and enter the 6-digit code for DFC Report.'
      }
      label={recovery ? 'Recovery code' : 'Code'}
      numeric={!recovery}
      submitLabel="Continue"
      onSubmit={async (value) => {
        await completeSecondStep(
          start.challenge,
          recovery ? { recovery_code: value } : { code: value },
          DEVICE_LABEL,
        );
        onDone();
      }}
      refusal={refusal}
      footer={
        <div className="flex flex-col items-center gap-2">
          <Button variant="quiet" type="button" onClick={() => setScreen(recovery ? 'code' : 'recovery')}>
            {recovery ? 'Use the app code instead' : 'Use a recovery code instead'}
          </Button>
          <Button variant="quiet" type="button" onClick={() => onSignInAgain('')}>
            Start again
          </Button>
        </div>
      }
    />
  );
}

function CodeForm({
  title,
  intro,
  label,
  numeric,
  submitLabel,
  onSubmit,
  refusal,
  footer,
}: {
  title: string;
  intro: string;
  label: string;
  numeric: boolean;
  submitLabel: string;
  onSubmit: (value: string) => Promise<void>;
  refusal: (cause: unknown) => string | Failure;
  footer?: React.ReactNode;
}) {
  const [value, setValue] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [submitting, setSubmitting] = useState(false);

  return (
    <AuthCard title={title} intro={intro} footer={footer}>
      <form
        className="flex flex-col gap-5"
        noValidate
        onSubmit={async (event) => {
          event.preventDefault();
          setFieldError(null);
          setFailure(null);
          if (value.trim() === '') {
            setFieldError(numeric ? 'Enter the code from your app.' : 'Enter a recovery code.');
            return;
          }
          setSubmitting(true);
          try {
            await onSubmit(value.trim());
          } catch (cause) {
            const outcome = refusal(cause);
            if (typeof outcome === 'string') {
              if (outcome !== '') {
                setFieldError(outcome);
              }
            } else {
              setFailure(outcome);
            }
            setSubmitting(false);
          }
        }}
      >
        <FailureNotice failure={failure} />
        <Field
          label={label}
          name={numeric ? 'code' : 'recovery_code'}
          autoComplete={numeric ? 'one-time-code' : 'off'}
          inputMode={numeric ? 'numeric' : 'text'}
          autoCapitalize="none"
          spellCheck={false}
          required
          value={value}
          error={fieldError}
          onChange={(event) => setValue(event.target.value)}
        />
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Checking…' : submitLabel}
        </Button>
      </form>
    </AuthCard>
  );
}

function Setup({
  challenge,
  confirming,
  onNext,
  onBack,
  onConfirmed,
  refusal,
  onSignInAgain,
}: {
  challenge: string;
  confirming: boolean;
  onNext: () => void;
  onBack: () => void;
  onConfirmed: (codes: string[]) => void;
  refusal: (cause: unknown) => string | Failure;
  onSignInAgain: (message: string) => void;
}) {
  const [setup, setSetup] = useState<{ key: string; qr: string } | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    startSecondStepSetup(challenge)
      .then(async ({ key, otpauth_uri: uri }) => {
        const svg = await QRCode.toString(uri, { type: 'svg', margin: 1 });
        if (!cancelled) {
          setSetup({ key, qr: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}` });
        }
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        if (cause instanceof ApiRequestError && cause.code === 'UNAUTHENTICATED') {
          onSignInAgain(cause.message);
        } else {
          setFailure(describeFailure(cause));
        }
      });
    return () => {
      cancelled = true;
    };
    // The secret is asked for once per sign-in; the API returns the same one again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [challenge]);

  if (confirming) {
    return (
      <CodeForm
        title="Set up your second step"
        intro="Step 2 of 2. Enter the 6-digit code your app now shows, to prove it works."
        label="Code"
        numeric
        submitLabel="Confirm"
        onSubmit={async (code) => {
          onConfirmed(await confirmSecondStepSetup(challenge, code, DEVICE_LABEL));
        }}
        refusal={refusal}
        footer={
          <Button variant="quiet" type="button" onClick={onBack}>
            Back to the QR code
          </Button>
        }
      />
    );
  }

  // The key in groups of four, as apps that take it typed expect.
  const grouped = setup?.key.match(/.{1,4}/g)?.join(' ') ?? '';

  return (
    <AuthCard
      title="Set up your second step"
      intro="Step 1 of 2. In your authenticator app, add an account and scan this code."
    >
      <div className="flex flex-col gap-5">
        <FailureNotice failure={failure} />
        {setup ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- a data URL, not a hosted image */}
            <img
              src={setup.qr}
              alt="QR code to add DFC Report to your authenticator app"
              width={192}
              height={192}
              className="mx-auto rounded bg-white p-2"
            />
            <div className="flex flex-col gap-1.5">
              <p className="field-label">Can’t scan? Enter this key</p>
              <p className="border-edge rounded border px-3 py-2 font-mono text-sm break-all">
                {grouped}
              </p>
              <div>
                <Button
                  variant="secondary"
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(setup.key);
                      setCopied(true);
                    } catch {
                      setCopied(false);
                    }
                  }}
                >
                  Copy key
                </Button>
                {copied ? (
                  <span aria-live="polite" className="text-muted ml-3 text-sm">
                    Copied.
                  </span>
                ) : null}
              </div>
            </div>
            <Button type="button" onClick={onNext}>
              Next
            </Button>
          </>
        ) : failure ? null : (
          <p className="text-muted text-sm">Loading&hellip;</p>
        )}
      </div>
    </AuthCard>
  );
}

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const text = `DFC Report recovery codes. Each works once.\n\n${codes.join('\n')}\n`;

  return (
    <AuthCard
      title="Save your recovery codes"
      intro="If you lose your phone, each code signs you in once. They are shown only now."
    >
      <div className="flex flex-col gap-5">
        <ul aria-label="Recovery codes" className="grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-sm">
          {codes.map((code) => (
            <li key={code}>{code}</li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(text);
                setCopied(true);
              } catch {
                setCopied(false);
              }
            }}
          >
            Copy all
          </Button>
          <a
            className="border-edge inline-flex min-h-11 items-center rounded border px-4 text-sm font-medium"
            href={`data:text/plain;charset=utf-8,${encodeURIComponent(text)}`}
            download="dfc-report-recovery-codes.txt"
          >
            Download
          </a>
          {copied ? (
            <span aria-live="polite" className="text-muted text-sm">
              Copied.
            </span>
          ) : null}
        </div>
        <label className="flex min-h-6 items-center gap-3 text-sm">
          <input
            type="checkbox"
            className="size-6"
            checked={saved}
            onChange={(event) => setSaved(event.target.checked)}
          />
          I have saved these codes somewhere safe
        </label>
        <Button type="button" disabled={!saved} onClick={onDone}>
          Continue to DFC Report
        </Button>
      </div>
    </AuthCard>
  );
}
