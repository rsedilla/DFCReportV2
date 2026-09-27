'use client';

import { useRouter } from 'next/navigation';
import { useSyncExternalStore } from 'react';

import { Button } from '@/components/ui/button';
import { forgetSession, isHalted, subscribe } from '@/lib/session';

/**
 * Says so on every screen when the session cannot be renewed, and offers the one way on.
 *
 * `lib/session.ts` has already made the one re-presentation of the token section 6
 * serves (decision 0128) and stopped, so each screen's own failure notice explains
 * nothing it can act on. Signing in again forgets this device's token without
 * presenting it, which ends nothing on another device.
 *
 * The live region stays in the document and only its contents change, as
 * `FailureNotice` does, so the message is announced when it appears.
 */
export function SessionHaltBanner() {
  const router = useRouter();
  const halted = useSyncExternalStore(subscribe, isHalted, () => false);

  return (
    <div role="alert" aria-live="assertive">
      {halted ? (
        <div className="border-line bg-raised flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3">
          <p className="text-sm leading-relaxed">
            Your connection dropped while keeping you signed in. Sign in again to carry on.
          </p>
          <Button
            onClick={() => {
              forgetSession();
              router.replace('/sign-in');
            }}
          >
            Sign in again
          </Button>
        </div>
      ) : null}
    </div>
  );
}
