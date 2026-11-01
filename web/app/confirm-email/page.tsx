import { Suspense } from 'react';

import { AuthCard } from '@/components/auth-card';
import { ConfirmEmailForm } from '@/components/confirm-email-form';

/**
 * Where the link sent to a new email address lands (SKILL.md section 6, decision 0415).
 *
 * Opening it changes nothing: mail scanners follow links, so the change waits for the
 * button. The link is the credential, so this works signed in or not.
 */
export default function ConfirmEmailPage() {
  return (
    <AuthCard title="Confirm your new email" intro="This link can be used once.">
      <Suspense fallback={<p className="text-muted text-sm">Loading…</p>}>
        <ConfirmEmailForm />
      </Suspense>
    </AuthCard>
  );
}
