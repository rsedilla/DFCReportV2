/**
 * Where this client keeps its tokens, and the rules that decide the shape.
 *
 * SKILL.md section 6: sessions are tokens rather than browser sessions, several
 * devices may hold one at once, and a refresh token **rotates** on every use.
 * Presenting a refresh token *after* it has been used is the theft signal, and
 * it revokes every session on the account, on every device.
 *
 * That last sentence is the whole design constraint. A client that accidentally
 * presents one token twice in sequence signs its user out everywhere, and the
 * user has done nothing wrong.
 *
 * The 2026-08-21 ruling makes *simultaneous* presentation harmless — one caller
 * wins the rotation and the other is refused, with no revocation. That is the
 * safety net rather than the design, and it covers only the simultaneous case:
 * a presentation that lands *after* another has committed is the reuse signal,
 * whatever the client intended.
 *
 * Three mechanisms follow, each closing a different window.
 *
 * - `inFlight` collapses concurrent refreshes **within one tab**, so several
 *   requests meeting a 401 together make one round trip.
 * - A **Web Lock serializes across tabs**, which `inFlight` cannot reach:
 *   `localStorage` is shared per origin while `inFlight` is per JavaScript
 *   context. Without it, two tabs each read the same token and the second POST
 *   arrives after the first has rotated — sequential at the server, and
 *   therefore account-wide revocation for having two tabs open. Section 6 makes
 *   every tab of one browser profile one session and requires this
 *   serialization by name; it is not an optimisation.
 * - **The halt** stops this client re-presenting a token **whose fate it does
 *   not know**. It is stored beside the token rather than held in memory, for
 *   the same reason the second point exists. See `HALT_STORAGE_KEY`; it is the
 *   subtlest of the three.
 *
 * Every read of the stored token that precedes a network call happens *inside*
 * the lock, which is what makes the arrangement sufficient rather than merely
 * well-intentioned.
 *
 * **The access token is held in memory and never persisted; the refresh token
 * is in `localStorage` and mirrored in memory.** A pure client has no server of
 * its own (section 2), so an `httpOnly` cookie is not available at any price.
 * Given that, persisting only the rotating credential is the better half of the
 * trade: it survives a reload, and if it is read by anything else, its next use
 * is detectable as reuse and ends every session. A persisted access token would
 * be usable for its whole lifetime with nothing raised.
 *
 * The in-memory mirror exists because `localStorage` can be *unavailable* —
 * private browsing and blocked site data both throw. Without it, a rotation
 * whose write silently failed left a freshly-issued refresh token live for
 * thirty days that this client could no longer name and therefore could never
 * revoke.
 */
import { ApiRequestError, apiRequest } from './api-client';

export interface SessionTokens {
  access_token: string;
  refresh_token: string;
  token_type: 'Bearer';
  expires_in: number;
}

const REFRESH_STORAGE_KEY = 'dfc.refresh_token';

/**
 * The halt, stored beside the token it guards.
 *
 * **It has to live where the credential lives.** A module variable is per
 * JavaScript context and `localStorage` is per origin, so a guard held in memory
 * is cleared by a page reload, a discarded tab, or a second tab opening — while
 * the token it was protecting is still there to be presented. That is the same
 * argument this file already makes about `inFlight` twenty lines above, and the
 * first version of the halt made exactly the mistake it warns about: reload the
 * page after a halt and the client presented the token, which the server reads
 * as reuse.
 */
const HALT_STORAGE_KEY = 'dfc.halted_token';

/** Names the cross-tab lock. Scoped to this origin by the Web Locks API. */
const SESSION_LOCK = 'dfc.session';

/**
 * How long a request made while holding the session lock may run.
 *
 * A Web Lock is held until its callback settles and is scoped to the **origin**,
 * so one tab waiting on a stalled socket blocks every refresh in every tab of
 * the application — for as long as the browser's own network timeout, which is
 * minutes. The 2026-08-23 `RESOURCE_BUSY` ruling reached the same conclusion
 * about the person lock on the server, and bounded it for the same reason: an
 * unbounded wait inside something that holds an exclusive resource presents to
 * everything else as a dead application.
 *
 * Ten seconds is far longer than either call needs and short enough that a
 * stalled one does not read as a freeze.
 */
const LOCK_HELD_REQUEST_TIMEOUT_MS = 10_000;

/** Held in memory only, and deliberately not exported. */
let accessToken: string | null = null;

/**
 * The refresh token whose write to `localStorage` was refused, if any.
 *
 * This is the in-memory mirror and the "storage is behind" signal at once, which
 * is why there is no second variable: the only value the mirror is ever needed
 * for is one the store does not hold.
 *
 * It names **one token** rather than latching a flag, and that is the fix rather
 * than a detail. A flag cannot tell "this value never reached the store" from
 * "this tab has given up on storage for ever", and a single `QuotaExceededError`
 * — which any other page on the origin can cause — used to mean the second. From
 * then on the tab read its own copy and ignored every rotation another tab
 * persisted, which is the stale-token replay `currentRefreshToken` exists to
 * prevent.
 *
 * Cleared by the next write that succeeds.
 */
let unpersisted: string | null = null;

/** The single in-flight refresh for *this tab*. */
let inFlight: Promise<string> | null = null;

/**
 * A refresh token this client presented without learning the outcome.
 *
 * `fetch` rejects identically for two situations that are not alike: the request
 * never reached the server, and the request reached the server, rotated the row,
 * and the *response* was lost. In the second, the stored token is already spent
 * — so presenting it again is the section 6 reuse signal, and the account is
 * revoked on every device.
 *
 * So a transport failure does not discard the credential at once (section 23 makes
 * an unreliable connection the expected case). Section 6 serves one re-presentation
 * of a rotated token whose replacement was never used, inside a window (decision
 * 0128), so `refreshWithinLock` presents it once more when the connection is back.
 * If that also has no conclusive answer the client stops here and never presents the
 * token again: a second re-presentation is the reuse signal, which ends every session
 * on the account. The person signs in afresh, which ends nothing on another device.
 */
let haltedInMemory: string | null = null;

/**
 * The fallback funnel, used where the Web Locks API is absent.
 *
 * It serializes within this tab only, which is exactly what this file did before
 * the lock existed. It is a narrower guarantee and is not silently equivalent:
 * where `navigator.locks` is missing, two tabs can still race, and section 6
 * requires serialization across them. Nothing this promise chain does closes
 * that; what closes it is section 6's retry window (decision 0128), under which a
 * cross-tab race carries the lost-response signature rather than the theft one.
 */
let fallbackChain: Promise<unknown> = Promise.resolve();

const subscribers = new Set<() => void>();

function announce(): void {
  for (const notify of subscribers) {
    notify();
  }
}

/** Subscribe to sign-in and sign-out, for `useSyncExternalStore`. */
export function subscribe(listener: () => void): () => void {
  subscribers.add(listener);
  return () => {
    subscribers.delete(listener);
  };
}

/**
 * Run `work` with exclusive use of this origin's session credential.
 *
 * **Not reentrant**, which is a property of Web Locks rather than a choice here:
 * requesting a held lock from inside its own callback waits for a release that
 * cannot happen. `refreshWithinLock` and `postLogout` exist for that reason —
 * they are the lock-free bodies, and they are the only things called from inside
 * a callback.
 *
 * No runtime guard enforces it, deliberately. The obvious one — a flag set while
 * a callback runs — cannot tell reentrancy from ordinary contention, because a
 * second tab or a second caller legitimately arriving while the first holds the
 * lock looks identical at the point of call. It would throw on the case that must
 * queue. Keeping both lock-free bodies private, and unexported, is what actually
 * holds this.
 */
async function withSessionLock<T>(work: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return navigator.locks.request(SESSION_LOCK, work) as Promise<T>;
  }

  const run = fallbackChain.then(work, work);
  // The chain must not reject, or every later caller inherits the rejection.
  fallbackChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function readStoredRefreshToken(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    return window.localStorage.getItem(REFRESH_STORAGE_KEY);
  } catch {
    // Private browsing and blocked site data both throw rather than returning
    // null. A client that cannot persist a refresh token still works for the
    // length of one page view, which is better than failing to render.
    return null;
  }
}

/**
 * What this client holds. **Storage wins wherever storage holds it.**
 *
 * The mirror is a fallback for a value the store refused, never a cache in front
 * of one it accepted: `localStorage` is how a rotation in another tab becomes
 * visible here, so preferring the mirror would make this tab present the token
 * it last saw rather than the current one — which is the sequential replay the
 * lock exists to prevent, reintroduced one line further in.
 *
 * The mirror is consulted only for a token `unpersisted` names, which is the
 * narrow case where storage genuinely cannot answer: this tab holds a token no
 * other tab can see, because the write that would have shown them was refused.
 */
function currentRefreshToken(): string | null {
  return unpersisted ?? readStoredRefreshToken();
}

function writeStoredRefreshToken(token: string | null): void {
  if (typeof window === 'undefined') {
    unpersisted = token;
    return;
  }
  try {
    if (token === null) {
      window.localStorage.removeItem(REFRESH_STORAGE_KEY);
    } else {
      window.localStorage.setItem(REFRESH_STORAGE_KEY, token);
    }
    unpersisted = null;
  } catch {
    // As above. The mirror still names the token, so it remains revocable for
    // this page view even though the session will not survive a reload — and
    // until a write succeeds, the mirror is what `currentRefreshToken` reads,
    // because the store does not hold this value.
    unpersisted = token;
  }
}

/** The halted token, read from where it was stored. See `HALT_STORAGE_KEY`. */
function readHaltedToken(): string | null {
  if (typeof window === 'undefined') {
    return haltedInMemory;
  }
  try {
    return window.localStorage.getItem(HALT_STORAGE_KEY) ?? haltedInMemory;
  } catch {
    return haltedInMemory;
  }
}

function writeHaltedToken(token: string | null): void {
  haltedInMemory = token;

  if (typeof window === 'undefined') {
    return;
  }
  try {
    if (token === null) {
      window.localStorage.removeItem(HALT_STORAGE_KEY);
    } else {
      window.localStorage.setItem(HALT_STORAGE_KEY, token);
    }
  } catch {
    // The in-memory copy above is then the whole of the guard, which is the
    // behaviour this replaced, and it does not survive a reload.
  }
}

/**
 * True where this client holds something it can attempt a session with.
 *
 * It is a statement about what is stored and never about what the holder may
 * do. Authorization is answered by the API on every request (section 1,
 * principle 4), and nothing here is consulted for it.
 */
export function hasStoredSession(): boolean {
  return accessToken !== null || currentRefreshToken() !== null;
}

/**
 * True where this token's last presentation had no known outcome and the client
 * has stopped rather than present it again.
 *
 * Keyed by the token, so a halt recorded against a value that has since been
 * replaced — by another tab, or by a sign-in — blocks nothing.
 */
export function isHalted(): boolean {
  const halted = readHaltedToken();
  return halted !== null && halted === currentRefreshToken();
}

function adopt(tokens: SessionTokens): string {
  accessToken = tokens.access_token;
  writeStoredRefreshToken(tokens.refresh_token);
  writeHaltedToken(null);
  writeSent(null);
  announce();
  return tokens.access_token;
}

/** Forget this device's tokens without calling the API. */
export function forgetSession(): void {
  accessToken = null;
  inFlight = null;
  writeHaltedToken(null);
  writeSent(null);
  writeStoredRefreshToken(null);
  announce();
}

/**
 * How many times the stored token has been sent without a known outcome, and when
 * the first of them began. Stored beside the token for the reason `HALT_STORAGE_KEY`
 * is: a count held in memory is lost with the page, while the token it counts is not.
 */
interface Sent {
  token: string;
  since: number;
  count: number;
}

const SENT_STORAGE_KEY = 'dfc.sent_token';

let sentInMemory: Sent | null = null;

function readSent(): Sent | null {
  if (typeof window === 'undefined') {
    return sentInMemory;
  }
  try {
    const raw = window.localStorage.getItem(SENT_STORAGE_KEY);
    if (raw === null) {
      return sentInMemory;
    }
    const parsed = JSON.parse(raw) as Partial<Sent>;
    return typeof parsed.token === 'string' &&
      typeof parsed.since === 'number' &&
      typeof parsed.count === 'number'
      ? { token: parsed.token, since: parsed.since, count: parsed.count }
      : sentInMemory;
  } catch {
    return sentInMemory;
  }
}

function writeSent(value: Sent | null): void {
  sentInMemory = value;

  if (typeof window === 'undefined') {
    return;
  }
  try {
    if (value === null) {
      window.localStorage.removeItem(SENT_STORAGE_KEY);
    } else {
      window.localStorage.setItem(SENT_STORAGE_KEY, JSON.stringify(value));
    }
  } catch {
    // Held in memory only, and it does not survive a reload.
  }
}

export async function signIn(
  email: string,
  password: string,
  deviceLabel: string | null,
): Promise<void> {
  const tokens = await apiRequest<SessionTokens>('/api/v1/auth/login', {
    method: 'POST',
    body: { email, password, device_label: deviceLabel ?? undefined },
  });

  adopt(tokens);
}

/** Raised locally, without a network call, where the halt blocks one. */
export class SessionHaltedError extends Error {
  constructor() {
    super('Your connection dropped while keeping you signed in. Sign in again to carry on.');
    this.name = 'SessionHaltedError';
  }
}

/**
 * One rotation. **The caller must already hold the session lock.**
 *
 * The stored token is read here rather than by the caller, so that what is
 * presented is whatever is current at the moment the lock was acquired — a token
 * read before the lock may have been rotated by another tab while this one
 * waited.
 */
async function refreshWithinLock(): Promise<string> {
  const stored = currentRefreshToken();
  if (stored === null) {
    throw new Error('No stored session.');
  }
  if (readHaltedToken() === stored) {
    throw new SessionHaltedError();
  }

  // **A page that ended mid-attempt has already sent this token.** A reload, a
  // closed tab or a browser discarding the page leaves no memory of it, so every
  // presentation is recorded before it is sent. Found in one it goes straight to the
  // one retry section 6 serves, and past that, or too late for it, it stops.
  const sent = readSent();
  if (sent !== null && sent.token === stored) {
    if (sent.count >= 2 || Date.now() >= sent.since + RETRY_START_LIMIT_MS) {
      return halt(stored, new SessionHaltedError());
    }
    // A page reopened offline waits for the connection rather than spending its one
    // retry on a certain failure; online it retries at once.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      await waitForSignal(sent.since + RETRY_START_LIMIT_MS);
    }
    return retry(stored, sent.since);
  }

  const firstAttemptAt = Date.now();
  writeSent({ token: stored, since: firstAttemptAt, count: 1 });

  try {
    return adopt(await presentRefreshToken(stored));
  } catch (cause) {
    if (cause instanceof ApiRequestError) {
      // The server answered, so the outcome is known either way.
      //
      // 401 is a refusal of the credential: spent, revoked or expired. It cannot
      // be retried and cannot be repaired, and keeping it would mean presenting
      // it again, which is the one thing section 6 makes expensive.
      //
      // `VALIDATION_FAILED` means the stored value is not even a well-formed
      // token, which is a corrupted store rather than a session. Discarding it
      // matters because `hasStoredSession()` would otherwise keep reporting a
      // session that can never be renewed, and nothing would redirect to sign-in.
      //
      // Anything else — a rate limit, a 5xx — refused this attempt without
      // spending the token, so it is kept.
      if (cause.status === 401 || cause.code === 'VALIDATION_FAILED') {
        forgetSession();
      } else {
        // Answered and not spent, so nothing about this presentation is owed.
        writeSent(null);
      }
      throw cause;
    }

    // No answer: a transport failure, or the ten-second bound above. The token may
    // or may not have been spent. Section 6 serves **one** re-presentation of a
    // rotated token whose replacement was never used, inside a window measured from
    // the rotation (decision 0128), so it is presented exactly once more, once the
    // connection is back, and never again after that: if the retry was processed
    // and its answer lost too, the replacement it rotated is used, and a further
    // presentation is the reuse signal that ends every session on the account.
    await waitForSignal(firstAttemptAt + RETRY_START_LIMIT_MS);
    return retry(stored, firstAttemptAt);
  }
}

/** The one re-presentation section 6 serves, recorded before it is sent. */
async function retry(stored: string, firstAttemptAt: number): Promise<string> {
  // Checked here rather than only before the wait: a timer or an `online` event fires
  // late when a phone suspends the page, and a retry past the window is reuse.
  if (Date.now() >= firstAttemptAt + RETRY_START_LIMIT_MS) {
    return halt(stored, new SessionHaltedError());
  }
  // Read again, because a browser without Web Locks lets another tab reach this
  // point during the pause. Not atomic across tabs, which is what the lock is for.
  const sent = readSent();
  if (sent !== null && sent.token === stored && sent.count >= 2) {
    return halt(stored, new SessionHaltedError());
  }
  writeSent({ token: stored, since: firstAttemptAt, count: 2 });

  try {
    return adopt(await presentRefreshToken(stored));
  } catch (cause) {
    if (
      cause instanceof ApiRequestError &&
      (cause.status === 401 || cause.code === 'VALIDATION_FAILED')
    ) {
      forgetSession();
      throw cause;
    }

    // Anything else leaves the token's fate unknown, and it is not presented again:
    // the person signs in afresh, which ends nothing on another device.
    return halt(stored, cause);
  }
}

function halt(stored: string, cause: unknown): never {
  writeHaltedToken(stored);
  announce();
  throw cause;
}

function presentRefreshToken(token: string): Promise<SessionTokens> {
  return apiRequest<SessionTokens>('/api/v1/auth/refresh', {
    method: 'POST',
    body: { refresh_token: token },
    signal: AbortSignal.timeout(LOCK_HELD_REQUEST_TIMEOUT_MS),
  });
}

/**
 * The latest the one retry may start, measured from the first attempt.
 *
 * Section 6's window is sixty seconds from the **rotation** (decision 0128), and the
 * rotation cannot precede the first attempt, so a retry starting by forty seconds
 * leaves a margin for it to reach the server inside the window.
 */
const RETRY_START_LIMIT_MS = 40_000;

/** A short pause before the retry when the device reports it is online. */
const RETRY_PAUSE_MS = 3_000;

/**
 * Wait until the device reports a connection again, or until `deadline`, whichever
 * is first. Online already, it waits `RETRY_PAUSE_MS`, bounded by the deadline too.
 */
function waitForSignal(deadline: number): Promise<void> {
  const remaining = Math.max(0, deadline - Date.now());
  const online = typeof navigator === 'undefined' || navigator.onLine !== false;

  return new Promise((resolve) => {
    const timer = setTimeout(done, online ? Math.min(RETRY_PAUSE_MS, remaining) : remaining);
    if (!online && typeof window !== 'undefined') {
      window.addEventListener('online', done);
    }

    function done(): void {
      clearTimeout(timer);
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', done);
      }
      resolve();
    }
  });
}

/**
 * Exchange the stored refresh token for a new pair, at most once at a time
 * within this tab and at most once at a time across tabs.
 */
function refreshSession(): Promise<string> {
  if (inFlight) {
    return inFlight;
  }

  const attempt = withSessionLock(refreshWithinLock).finally(() => {
    inFlight = null;
  });

  inFlight = attempt;
  return attempt;
}

/**
 * Call the API as the signed-in account, renewing the access token once if the
 * one held has expired.
 *
 * The retry is deliberately not a loop. A second 401 after a fresh access token
 * is the API declining the request rather than declining the token, and
 * retrying it would spend refresh tokens against a decision that will not
 * change.
 */
export async function authenticatedRequest<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    body?: unknown;
    idempotencyKey?: string;
    signal?: AbortSignal;
  } = {},
): Promise<T> {
  const token = accessToken ?? (await refreshSession());

  try {
    return await apiRequest<T>(path, { ...options, accessToken: token });
  } catch (cause) {
    if (!(cause instanceof ApiRequestError) || cause.status !== 401) {
      throw cause;
    }

    const renewed = await refreshSession();
    return apiRequest<T>(path, { ...options, accessToken: renewed });
  }
}

/**
 * End this device's session, and no other (section 6).
 *
 * **The refresh token is read inside the lock, after the access token is
 * settled.** `POST /auth/logout` revokes the row it is handed only while that
 * row is still live — `revokeRefreshToken` carries `revoked_at is null`
 * deliberately, so that a sign-out cannot touch a token that was already
 * rotated. So a token read before a refresh revokes *nothing*: the replacement
 * stays valid for its full life while the person is shown a signed-out screen.
 * That was a real defect here, and it is why the ordering below is not
 * incidental.
 *
 * `logout` is authenticated and state-changing, so it carries an
 * `Idempotency-Key` like every other authenticated write. The 2026-08-22 ruling
 * refused to exempt the session endpoints: section 7's carve-out is from the
 * *capability* guard, and borrowing it here would be applying a rule to
 * something it was not written about.
 *
 * The tokens are forgotten whatever the API answers. A failed sign-out that
 * leaves the user apparently signed in is the worse outcome of the two on a
 * shared phone.
 */
export async function signOut(): Promise<void> {
  try {
    await withSessionLock(async () => {
      if (currentRefreshToken() === null) {
        return;
      }

      // Settled inside the lock, so nothing rotates underneath what is read
      // next. `currentRefreshToken()` falls back to the in-memory mirror for a
      // token storage refused, so the token a rotation just issued is nameable
      // even then — without which a sign-out could mint a live thirty-day token
      // and abandon it.
      const token = accessToken ?? (await refreshWithinLock());
      const stored = currentRefreshToken();
      if (stored === null) {
        return;
      }

      try {
        await postLogout(stored, token);
      } catch (cause) {
        if (!(cause instanceof ApiRequestError) || cause.status !== 401) {
          throw cause;
        }

        // The access token expired between being settled and being used. Rotate
        // once, then present whatever the rotation just issued.
        const renewed = await refreshWithinLock();
        const current = currentRefreshToken();
        if (current !== null) {
          await postLogout(current, renewed);
        }
      }
    });
  } finally {
    forgetSession();
  }
}

function postLogout(token: string, accessTokenForCall: string): Promise<void> {
  return apiRequest<void>('/api/v1/auth/logout', {
    method: 'POST',
    body: { refresh_token: token },
    accessToken: accessTokenForCall,
    idempotencyKey: crypto.randomUUID(),
    signal: AbortSignal.timeout(LOCK_HELD_REQUEST_TIMEOUT_MS),
  });
}

/**
 * End every session this account holds, on every device (section 6).
 *
 * This one presents no refresh token of its own: the server resolves the account
 * from the access token and revokes all of them, so there is no stale-token
 * hazard of the kind `signOut` has. It still needs *an* access token, which on a
 * page that has not yet obtained one means a rotation — so it clears a halt and the
 * record of what was sent first, rather than being a control that cannot do what it
 * says.
 *
 * The risk that clearing accepts is account-wide revocation, which is what this
 * function does on purpose.
 */
export async function signOutEverywhere(): Promise<void> {
  try {
    writeHaltedToken(null);
    writeSent(null);
    await authenticatedRequest<void>('/api/v1/auth/logout-all', {
      method: 'POST',
      idempotencyKey: crypto.randomUUID(),
    });
  } finally {
    forgetSession();
  }
}
