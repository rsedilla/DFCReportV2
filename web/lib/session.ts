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
 * - `unknownOutcome` stops this client re-presenting a token **whose fate it
 *   does not know**. See below; it is the subtlest of the three.
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
 * The refresh token this client currently holds, mirroring storage.
 *
 * Read in preference to storage, so that a rotation whose write failed is still
 * a token this client can name and revoke.
 */
let refreshToken: string | null = null;

/**
 * False once a write to `localStorage` has been refused.
 *
 * It is what tells `currentRefreshToken` whether the store is authoritative. A
 * store that works is shared with every other tab and must win; a store that
 * throws tells this tab nothing, and the mirror is all there is.
 */
let storageUsable = true;

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
 * So a transport failure does not discard the credential (section 23 makes an
 * unreliable connection the expected case, and discarding a live token because a
 * train went into a tunnel signs a leader out of a session the server never
 * ended) and it does not re-present it either. The client stops, and says so.
 * Only a deliberate act by the person — `resumeSession`, wired to a *Try again*
 * control — presents it a second time, which makes the risk theirs to take
 * knowingly rather than one this client runs on their behalf three times a page
 * load.
 *
 * **What ought to happen instead is not settled.** Section 6 defines rotation,
 * the reuse signal, and the simultaneous exemption, and says nothing about a
 * presentation whose outcome is unknown. The two available answers — discard a
 * possibly-live credential, or keep it and risk a sequential replay — have
 * opposite costs, one bounded at one device and one at the whole account. This
 * is the conservative interim stance recorded in `CLAUDE.md` under *Open —
 * awaiting a ruling*, not an answer to that question.
 */
let unknownOutcome: string | null = null;

/**
 * The fallback funnel, used where the Web Locks API is absent.
 *
 * It serializes within this tab only, which is exactly what this file did before
 * the lock existed. It is a narrower guarantee and is not silently equivalent:
 * where `navigator.locks` is missing, two tabs can still race, and section 6
 * requires serialization across them. Nothing this promise chain does closes
 * that; what closes it is the server-side grace window proposed under *Open —
 * awaiting a ruling* in `CLAUDE.md`, after which a cross-tab race carries the
 * lost-response signature rather than the theft one.
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
 * What this client holds. **Storage wins wherever storage works.**
 *
 * The mirror is a fallback for a store that refuses, never a cache in front of
 * one that works: `localStorage` is how a rotation in another tab becomes
 * visible here, so preferring the mirror would make this tab present the token
 * it last saw rather than the current one — which is the sequential replay the
 * lock exists to prevent, reintroduced one line further in.
 */
function currentRefreshToken(): string | null {
  return storageUsable ? readStoredRefreshToken() : refreshToken;
}

function writeStoredRefreshToken(token: string | null): void {
  refreshToken = token;

  if (typeof window === 'undefined') {
    return;
  }
  try {
    if (token === null) {
      window.localStorage.removeItem(REFRESH_STORAGE_KEY);
    } else {
      window.localStorage.setItem(REFRESH_STORAGE_KEY, token);
    }
  } catch {
    // As above. The mirror still names the token, so it remains revocable for
    // this page view even though the session will not survive a reload — and
    // from here the mirror is what `currentRefreshToken` reads, because this
    // store is telling us nothing.
    storageUsable = false;
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
 * True where a presentation's outcome is unknown and this client has stopped
 * rather than re-present the token. Wired to a *Try again* control.
 */
export function isHalted(): boolean {
  return unknownOutcome !== null && unknownOutcome === currentRefreshToken();
}

/** Permit one further presentation of a token whose outcome is unknown. */
export function resumeSession(): void {
  unknownOutcome = null;
  announce();
}

function adopt(tokens: SessionTokens): string {
  accessToken = tokens.access_token;
  writeStoredRefreshToken(tokens.refresh_token);
  unknownOutcome = null;
  announce();
  return tokens.access_token;
}

/** Forget this device's tokens without calling the API. */
export function forgetSession(): void {
  accessToken = null;
  inFlight = null;
  unknownOutcome = null;
  writeStoredRefreshToken(null);
  announce();
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

/** Raised locally, without a network call, where `unknownOutcome` blocks one. */
export class SessionHaltedError extends Error {
  constructor() {
    super('The last attempt did not complete, so this session is not being retried on its own.');
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
  if (unknownOutcome === stored) {
    throw new SessionHaltedError();
  }

  try {
    const tokens = await apiRequest<SessionTokens>('/api/v1/auth/refresh', {
      method: 'POST',
      body: { refresh_token: stored },
      signal: AbortSignal.timeout(LOCK_HELD_REQUEST_TIMEOUT_MS),
    });
    return adopt(tokens);
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
      }
      throw cause;
    }

    // No answer: a transport failure, or the ten-second bound above. The token
    // may or may not have been spent, so it is neither discarded nor presented
    // again without a deliberate act. See `unknownOutcome`.
    unknownOutcome = stored;
    announce();
    throw cause;
  }
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
      // next. `currentRefreshToken()` prefers the in-memory mirror, so the token
      // a rotation just issued is nameable even where the write to storage was
      // refused — without which a sign-out could mint a live thirty-day token
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
 * This one needs no stored refresh token: the server resolves the account from
 * the access token and revokes all of them, so there is no stale-token hazard
 * of the kind `signOut` has.
 */
export async function signOutEverywhere(): Promise<void> {
  try {
    await authenticatedRequest<void>('/api/v1/auth/logout-all', {
      method: 'POST',
      idempotencyKey: crypto.randomUUID(),
    });
  } finally {
    forgetSession();
  }
}
