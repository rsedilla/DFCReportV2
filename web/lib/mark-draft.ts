'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Attendance marks a leader has made and not saved (decision 0345).
 *
 * **Two things, because each covers what the other cannot.** Leaving by an in-app link, or
 * closing or reloading the tab, asks first. But a phone kills a background tab without asking
 * anybody, and the browser's own back button gives a page no way to ask, so the marks are also
 * kept on this device and offered back, with a note and a Discard, the next time the same
 * screen opens for the same person. Saving deletes the draft.
 *
 * **Only marks are kept**, never a note, a reason or who ran a meeting, and each draft is keyed
 * on the screen and on the person signed in, so a draft is never offered to somebody else on a
 * shared phone. The session ending on this device deletes every draft (`clearMarkDrafts`), and
 * one older than three weeks is dropped unread: by then the week it was for has closed
 * (decision 0335).
 */

const PREFIX = 'dfc.marks:';
const KEEP_MS = 21 * 24 * 60 * 60 * 1000;

export const LEAVE_WARNING =
  'You have marks you have not saved. Leave this page? They stay on this device until you save or discard them.';

interface Stored<T> {
  saved_at: number;
  value: T;
}

function read<T>(key: string): Stored<T> | null {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (raw === null) {
      return null;
    }
    const stored = JSON.parse(raw) as Stored<T>;
    if (typeof stored.saved_at !== 'number' || Date.now() - stored.saved_at > KEEP_MS) {
      window.localStorage.removeItem(PREFIX + key);
      return null;
    }
    return stored;
  } catch {
    return null;
  }
}

function write<T>(key: string, value: T | null): void {
  try {
    if (value === null) {
      window.localStorage.removeItem(PREFIX + key);
    } else {
      const stored: Stored<T> = { saved_at: Date.now(), value };
      window.localStorage.setItem(PREFIX + key, JSON.stringify(stored));
    }
  } catch {
    // Storage refused (a private window, a full disk): the screen still works, and the
    // question before leaving still protects the marks.
  }
}

/** Every draft on this device, deleted when the session on it ends. */
export function clearMarkDrafts(): void {
  try {
    for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
      const key = window.localStorage.key(index);
      if (key !== null && key.startsWith(PREFIX)) {
        window.localStorage.removeItem(key);
      }
    }
  } catch {
    // Nothing stored, or nothing reachable.
  }
}

/**
 * Keeps `draft` on the device while it is not null, and asks before the page is left.
 *
 * `key` is null until the screen knows which draft is its own (the person signed in, and
 * what the screen records). When it first becomes known, a stored draft is handed to
 * `restore`, which applies what still fits and answers whether anything did; a draft that
 * no longer fits is deleted. Returns when a restored draft was made, for the note, and a
 * `discard` that deletes it.
 */
export function useMarkDraft<T>({
  key,
  draft,
  restore,
}: {
  key: string | null;
  draft: T | null;
  restore: (stored: T) => boolean;
}): { restoredAt: Date | null; discard: () => void } {
  const [restoredAt, setRestoredAt] = useState<Date | null>(null);
  // The key whose stored draft has been looked at. Until then nothing is written, so the
  // empty first render cannot delete the draft it is about to restore.
  const [checked, setChecked] = useState<string | null>(null);

  // Looked at while rendering rather than in an effect, so the restored marks and the note
  // arrive in the same commit as the screen they belong to.
  if (key !== null && checked !== key && typeof window !== 'undefined') {
    setChecked(key);
    const stored = read<T>(key);
    if (stored !== null) {
      if (restore(stored.value)) {
        setRestoredAt(new Date(stored.saved_at));
      } else {
        write(key, null);
      }
    }
  } else if (draft === null && restoredAt !== null) {
    // Saved, discarded, or every restored mark taken back: there is no draft to speak of.
    setRestoredAt(null);
  }

  useEffect(() => {
    if (key !== null && checked === key) {
      write(key, draft);
    }
  }, [key, checked, draft]);
  const dirty = draft !== null;

  // Closing or reloading the tab. The browser shows its own words; a page cannot set them.
  useEffect(() => {
    if (!dirty) {
      return;
    }
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Older browsers ask only when this is set.
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  // An in-app link. Caught on the way down, before the router's own handler sees the click.
  useEffect(() => {
    if (!dirty) {
      return;
    }
    const ask = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      const anchor = (event.target as Element | null)?.closest?.('a[href]');
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target === '_blank' || anchor.download) {
        return;
      }
      const to = new URL(anchor.href, window.location.href);
      if (to.pathname === window.location.pathname && to.search === window.location.search) {
        return;
      }
      if (!window.confirm(LEAVE_WARNING)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    document.addEventListener('click', ask, true);
    return () => document.removeEventListener('click', ask, true);
  }, [dirty]);

  const discard = useCallback(() => {
    if (key !== null) {
      write(key, null);
    }
    setRestoredAt(null);
  }, [key]);

  return { restoredAt, discard };
}

/** "Restored marks you had not saved, from 14 Oct, 7:42 pm. ..." */
export function restoredNote(at: Date): string {
  const when = at.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  return `Restored marks you had not saved, from ${when}. They are not recorded until you save.`;
}
