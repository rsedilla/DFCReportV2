'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { Button, buttonClasses } from '@/components/ui/button';
import { FailureNotice } from '@/components/ui/failure-notice';
import { confirmEmailChange } from '@/lib/email-change';
import { describeFailure, type Failure } from '@/lib/messages';
import { cn } from '@/lib/utils';

/**
 * Confirms a new email address from its link (decision 0415). One button, so that a mail
 * scanner opening the link changes nothing.
 */
export function ConfirmEmailForm() {
  const token = useSearchParams().get('token');
  const [failure, setFailure] = useState<Failure | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [email, setEmail] = useState<string | null>(null);

  if (email !== null) {
    return (
      <div>
        <h2 className="text-base font-medium">Your email is changed</h2>
        <p className="text-muted mt-2 text-sm leading-relaxed">
          Your account&rsquo;s email is now {email}. Reset links go there, and you can sign in
          with it. Your old address has been told.
        </p>
        <Link href="/sign-in" className={cn(buttonClasses(), 'mt-6 w-full')}>
          Go to sign in
        </Link>
      </div>
    );
  }

  // Not `field-invalid`, as on the password pages: a link without its token is a fact
  // about the link, not a refusal of anything typed.
  if (!token) {
    return (
      <FailureNotice
        failure={{
          message:
            'This link is missing its token, so it cannot be used. Links expire, and some mail clients shorten them. Ask for a new one from your Account page.',
          aboutInput: false,
        }}
      />
    );
  }

  async function onConfirm() {
    setFailure(null);
    setSubmitting(true);
    try {
      setEmail((await confirmEmailChange(token ?? '')).email);
    } catch (cause) {
      setFailure(describeFailure(cause));
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <FailureNotice failure={failure} />
      <p className="text-muted text-sm leading-relaxed">
        Your account&rsquo;s email changes to this address when you confirm. Reset links will go
        here, and your old address will be told.
      </p>
      <Button type="button" onClick={() => void onConfirm()} disabled={submitting}>
        {submitting ? 'Confirming…' : 'Confirm my new email'}
      </Button>
    </div>
  );
}
