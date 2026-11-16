'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { AuthCard } from '@/components/auth-card';
import { PrivacyNoticeTick } from '@/components/privacy-notice-tick';
import { Button } from '@/components/ui/button';
import { FailureNotice } from '@/components/ui/failure-notice';
import { describeFailure } from '@/lib/messages';
import { acknowledgePrivacyNotice } from '@/lib/privacy-notice';
import { signOut } from '@/lib/session';

/**
 * *Before you continue* (decision 0496, point 2): shown in place of every screen, as soon as
 * `/auth/me` answers, to an account that has not ticked the Privacy Notice in force, and never
 * again for that notice. The notice it ticks is the one `/auth/me` names.
 *
 * It asks; it does not guard. The API answers this account as before whether or not it has
 * ticked (SKILL.md section 24), so this is the website's question rather than a lock.
 */
export function PrivacyNoticeGate({ version }: { version: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [readNotice, setReadNotice] = useState(false);
  // One key for this screen's tick: a retry replays, it does not tick twice (decision 0127).
  const [key] = useState(() => crypto.randomUUID());

  const tick = useMutation({
    mutationFn: () => acknowledgePrivacyNotice(version, key),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['me'] }),
  });

  return (
    <AuthCard
      title="Before you continue"
      intro="DREAMS holds the personal information of the members of Doulos For Christ World Harvest Ministry, children among them, under the Data Privacy Act of 2012 (RA 10173). Please read our Privacy Notice. You are asked this once."
      footer={
        <button
          type="button"
          className="text-accent focus-visible:outline-accent inline-flex min-h-11 items-center rounded-md underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
          onClick={() => void signOut().finally(() => router.replace('/sign-in'))}
        >
          Sign out
        </button>
      }
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          tick.mutate();
        }}
      >
        <FailureNotice failure={tick.isError ? describeFailure(tick.error) : null} />
        <PrivacyNoticeTick checked={readNotice} onChange={setReadNotice} disabled={tick.isPending} />
        <Button type="submit" disabled={!readNotice || tick.isPending || tick.isSuccess}>
          {tick.isPending ? 'Saving…' : 'Continue'}
        </Button>
      </form>
    </AuthCard>
  );
}
