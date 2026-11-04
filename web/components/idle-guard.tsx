'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import {
  IDLE_SIGN_OUT_MS,
  IDLE_WARNING_MS,
  KEEP_ALIVE_MS,
  isInstalledApp,
  lastActivity,
  lastRenewed,
  noteActivity,
  noteRenewed,
} from '@/lib/idle';
import { renewSession, signOut } from '@/lib/session';

/** What counts as somebody being there: any of these, in any DREAMS tab. */
const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll'];

/** Where an idle sign-out lands, so the sign-in page can say why. */
export const IDLE_SIGNED_OUT_PATH = '/sign-in?reason=idle';

/** Whether the page runs as the installed app does not change while it is open. */
function never(): () => void {
  return () => {};
}

function countdown(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/**
 * Signs a browser session out after thirty minutes without activity, with a warning at
 * twenty-eight (SKILL.md section 6, decision 0435). Renders nothing in the app installed on
 * a phone or tablet's home screen, whose session keeps the thirty days.
 *
 * **It renews the session while somebody is active**, on any activity two minutes or more
 * after the last renewal, because the server's deadline only moves on a renewal and somebody
 * reading a page asks it for nothing. A tab that is idle renews nothing, so a background
 * refresh of a list is not activity and keeps no session alive.
 *
 * While the warning is open, any key or pointer movement counts as activity and closes it,
 * as *Stay signed in* does: somebody is there.
 */
export function IdleGuard() {
  const router = useRouter();
  // Prerendered as the installed app, so nothing is drawn before the browser is known.
  const installed = useSyncExternalStore(never, isInstalledApp, () => true);
  const [remaining, setRemaining] = useState<number | null>(null);
  const describedBy = useId();
  // Set once the session is being signed out, so closing the box then is not taken for
  // *Stay signed in*: the box closes itself at the sign-out too.
  const ending = useRef(false);

  useEffect(() => {
    if (installed) {
      return;
    }

    // A session signed in before this existed carries no activity yet, and no renewal: both
    // start now, so its first keystroke is not taken for an overdue renewal. Such a session
    // has no server deadline, so nothing is overstated; a tab whose storage is refused also
    // starts here, the one case where the last real renewal may be older than this says.
    if (lastActivity() === null) {
      noteActivity(Date.now(), true);
    }
    if (lastRenewed() === null) {
      noteRenewed();
    }

    const renewIfDue = (now: number) => {
      const renewed = lastRenewed();
      if (renewed === null || now - renewed >= KEEP_ALIVE_MS) {
        // Noted before it is sent, so a renewal that fails is not sent again on every
        // pointer movement; it is tried again two minutes later.
        noteRenewed(now);
        void renewSession().catch(() => {
          // A refused renewal ends the session through the session module itself.
        });
      }
    };

    const end = () => {
      ending.current = true;
      setRemaining(null);
      void signOut().finally(() => router.replace(IDLE_SIGNED_OUT_PATH));
    };

    const onActivity = () => {
      if (ending.current) {
        return;
      }
      const now = Date.now();
      const last = lastActivity();
      // Somebody arriving at a session already idle thirty minutes, a laptop woken before
      // the next check, ends it rather than taking it over.
      if (last !== null && now - last >= IDLE_SIGN_OUT_MS) {
        end();
        return;
      }
      noteActivity(now);
      renewIfDue(now);
    };

    const check = () => {
      const last = lastActivity();
      if (ending.current || last === null) {
        return;
      }
      const idle = Date.now() - last;
      if (idle >= IDLE_SIGN_OUT_MS) {
        end();
      } else if (idle >= IDLE_WARNING_MS) {
        setRemaining(IDLE_SIGN_OUT_MS - idle);
      } else {
        setRemaining(null);
      }
    };

    for (const name of ACTIVITY_EVENTS) {
      window.addEventListener(name, onActivity, { passive: true, capture: true });
    }
    // A laptop woken from sleep, or a tab brought back, is checked at once.
    document.addEventListener('visibilitychange', check);
    const timer = window.setInterval(check, 1000);
    check();

    return () => {
      for (const name of ACTIVITY_EVENTS) {
        window.removeEventListener(name, onActivity, { capture: true });
      }
      document.removeEventListener('visibilitychange', check);
      window.clearInterval(timer);
    };
  }, [installed, router]);

  if (installed) {
    return null;
  }

  const stay = () => {
    if (ending.current) {
      return;
    }
    noteActivity(Date.now(), true);
    setRemaining(null);
    noteRenewed();
    void renewSession().catch(() => {});
  };

  // Kept mounted and opened or closed, so closing it returns focus where it was.
  return (
    <Dialog
      open={remaining !== null}
      onClose={stay}
      title="Are you still there?"
      describedBy={describedBy}
    >
      <div className="flex flex-col gap-5">
        <div id={describedBy} className="flex flex-col gap-1">
          <p className="text-sm leading-relaxed" role="timer" aria-live="off">
            You&rsquo;ll be signed out in <strong>{countdown(remaining ?? 0)}</strong> to keep
            members&rsquo; details safe.
          </p>
          <p className="text-muted text-sm leading-relaxed">
            Attendance marks you haven&rsquo;t saved will be cleared.
          </p>
        </div>
        {/* A column below `lg`, so each button is full width in the sheet. */}
        <div className="flex flex-col gap-3 lg:flex-row lg:justify-end">
          <Button
            variant="secondary"
            onClick={() => {
              void signOut().finally(() => router.replace('/sign-in'));
            }}
          >
            Sign out now
          </Button>
          {/* The first focus, so Enter keeps the session rather than ending it. */}
          <Button onClick={stay} data-autofocus>
            Stay signed in
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
