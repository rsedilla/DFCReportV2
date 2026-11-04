/**
 * A browser session ends after a spell without activity (SKILL.md section 6, decision
 * 0435): thirty minutes with no click, tap, key, scroll or pointer movement in any DREAMS
 * tab, after a warning at twenty-eight. The app installed on a phone or tablet's home screen
 * is left alone, since the device it is on is its holder's own and locks itself.
 *
 * **The last activity is shared through `localStorage`**, because every tab of a browser
 * profile is one session (decision 0125): somebody working in one tab is not idle in the
 * other, and a tab left open behind them must not sign them out. The server holds its own
 * deadline, at least three minutes after this one, so this is the sign-out somebody sees and
 * the server's is the backstop for a session left behind.
 */

/** No activity for this long signs a browser session out. */
export const IDLE_SIGN_OUT_MS = 30 * 60 * 1000;

/** And this long shows the warning first. */
export const IDLE_WARNING_MS = 28 * 60 * 1000;

/**
 * While somebody is active, an activity this long after the last renewal renews the session
 * again. The server's deadline is thirty-five minutes from a renewal, so while renewals
 * succeed it falls at least thirty-three minutes after the last activity: after the client's
 * warning at twenty-eight and its sign-out at thirty.
 */
export const KEEP_ALIVE_MS = 2 * 60 * 1000;

const ACTIVITY_KEY = 'dfc.last_activity';
const RENEWED_KEY = 'dfc.renewed_at';

/** Writes are held to one each few seconds: a pointer moving fires many events. */
const WRITE_EVERY_MS = 5 * 1000;

let memoryActivity: number | null = null;
let memoryRenewed: number | null = null;
let lastWrite = 0;

/**
 * Whether this page is running as the app installed on a phone or tablet's home screen,
 * rather than in a browser tab or as an app installed on a computer (owner, 2026-11-04).
 * iPhone and iPad report the home-screen app through `navigator.standalone`, and Android
 * through the `display-mode` media query, which the manifest's `standalone` sets; either counts
 * only on a device whose main pointer is a finger, since a Mac's Dock app may report
 * `navigator.standalone` too. A computer can install DREAMS, and a shared computer is the case
 * this sign-out exists for, so an app installed there signs out as a browser does.
 */
export function isInstalledApp(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  const iphone = (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  const standalone = iphone || window.matchMedia('(display-mode: standalone)').matches;
  return standalone && window.matchMedia('(pointer: coarse)').matches;
}

/** What the server is told a session begins in, at sign-in. */
export function sessionKind(): 'BROWSER' | 'INSTALLED' {
  return isInstalledApp() ? 'INSTALLED' : 'BROWSER';
}

function read(key: string, memory: number | null): number | null {
  try {
    const raw = window.localStorage.getItem(key);
    const value = raw === null ? NaN : Number(raw);
    return Number.isFinite(value) ? value : memory;
  } catch {
    return memory;
  }
}

function write(key: string, value: number): void {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // Storage refused: the in-memory copy below still serves this tab.
  }
}

/** The last activity in any tab, or null where none has been noted. */
export function lastActivity(): number | null {
  return read(ACTIVITY_KEY, memoryActivity);
}

/** Somebody did something. `force` writes at once, as a sign-in or *Stay signed in* does. */
export function noteActivity(now = Date.now(), force = false): void {
  memoryActivity = now;
  if (force || now - lastWrite >= WRITE_EVERY_MS) {
    lastWrite = now;
    write(ACTIVITY_KEY, now);
  }
}

/** When the session was last renewed for activity, in any tab. */
export function lastRenewed(): number | null {
  return read(RENEWED_KEY, memoryRenewed);
}

export function noteRenewed(now = Date.now()): void {
  memoryRenewed = now;
  write(RENEWED_KEY, now);
}

/** Forgotten with the session, so the next sign-in starts afresh. */
export function forgetActivity(): void {
  memoryActivity = null;
  memoryRenewed = null;
  try {
    window.localStorage.removeItem(ACTIVITY_KEY);
    window.localStorage.removeItem(RENEWED_KEY);
  } catch {
    // Nothing to forget.
  }
}
