import { Suspense } from 'react';

import { AuthCard } from '@/components/auth-card';
import { SetPasswordForm } from '@/components/set-password-form';

/**
 * The second half of the forgotten-password flow (SKILL.md section 6).
 *
 * Setting a password here ends every session on the account, which is the
 * server's business and not this client's — it is stated in the confirmation
 * because a leader signed in on a second phone should not be surprised by it.
 */
export default function ResetPasswordPage() {
  return (
    <AuthCard title="Choose a new password" intro="This link can be used once.">
      <Suspense fallback={<p className="text-muted text-sm">Loading…</p>}>
        <SetPasswordForm
          path="/api/v1/auth/reset-password"
          submitLabel="Save new password"
          successTitle="Your password has been changed"
          successBody="Any other device signed in to this account has been signed out. Sign in again with your new password."
        />
      </Suspense>
    </AuthCard>
  );
}
