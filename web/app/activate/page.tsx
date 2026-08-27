import { Suspense } from 'react';

import { AuthCard } from '@/components/auth-card';
import { SetPasswordForm } from '@/components/set-password-form';

/**
 * Activation: the holder sets their own password for the first time.
 *
 * SKILL.md section 6 has an account provisioned by an administrator and
 * activated by the person who holds it, so the administrator never knows the
 * password. This route is on section 7's closed list of endpoints reachable
 * without authentication, which is what the token in the link is for.
 *
 * `useSearchParams` suspends, so the boundary is here rather than around the
 * whole tree — a missing one is a build error in Next rather than a runtime
 * surprise, but the placement decides how much of the page waits.
 */
export default function ActivatePage() {
  return (
    <AuthCard
      title="Activate your account"
      intro="Choose a password. Nobody else, including an administrator, will know it."
    >
      <Suspense fallback={<p className="text-muted text-sm">Loading…</p>}>
        <SetPasswordForm
          path="/api/v1/auth/activate"
          submitLabel="Activate account"
          successTitle="Your account is active"
          successBody="Sign in with your email address and the password you just set."
        />
      </Suspense>
    </AuthCard>
  );
}
