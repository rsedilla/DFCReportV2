/**
 * Where this client keeps its tokens, and the one rule that decides the shape.
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
 * **So the stored token is read only while holding a lock, never before.** Two
 * layers, because they close different windows:
 *
 * - `inFlight` collapses concurrent refreshes **within one tab**, so several
 *   requests meeting a 401 together make one round trip.
 * - A **Web Lock serializes across tabs**, which `inFlight` cannot reach:
 *   `localStorage` is shared per origin while `inFlight` is per JavaScript
 *   context. Without it, two tabs each read the same token and the second POST
 *   arrives after the first has rotated — sequential at the server, and
 *   therefore account-wide revocation for having two tabs open.
 *
 * Every read of the stored token that precedes a network call happens *inside*
 * that lock, which is what makes the pair sufficient rather than merely
 * well-intentioned. An earlier version of this file claimed a funnel and then
 * read the token in `signOut` before the funnel ran, which sent a token that had
 * already been rotated — revoking nothing, while the person was shown a
 * signed-out screen.
 *
 * **The access token is held in memory and never persisted; the refresh token
 * is in `localStorage`.** A pure client has no server of its own (section 2), so
 * an `httpOnly` cookie is not available at any price — there is nothing to set
 * it. Given that, persisting only the rotating credential is the better half of
 * the trade: it survives a reload, and if it is read by anything else, its next
 * use is detectable as reuse and ends every session. A persisted access token
 * would be usable for its whole lifetime with nothing raised.
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
 * Held in memory only, and deliberately not exported. Everything that needs it
 * goes through `authenticatedRequest`, so there is no call site that can send it
 * without the refresh-and-retry behaviour below.
 */
let accessToken: string | null = null;

/** The single in-flight refresh for *this tab*. See the note at the top. */
let inFlight: Promise<string> | null = null;

/**
 * The fallback funnel, used where the Web Locks API is absent.
 *
 * It serializes within this tab only, which is exactly what this file did before
 * the lock existed. It is a narrower guarantee and is not silently equivalent:
 * where `navigator.locks` is missing, two tabs can still race, and that is the
 * open question recorded in `CLAUDE.md` rather than something this promise
 * chain closes.
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
 * Web Locks are not reentrant, so nothing called from inside `work` may call
 * this again. `refreshWithinLock` exists for that reason: it is the body of a
 * refresh with no lock of its own.
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

function writeStoredRefreshToken(token: string | null): void {
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
    // As above. The session then lasts until the tab is closed.
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
  return accessToken !== null || readStoredRefreshToken() !== null;
}

function adopt(tokens: SessionTokens): string {
  accessToken = tokens.access_token;
  writeStoredRefreshToken(tokens.refresh_token);
  announce();
  return tokens.access_token;
}

/** Forget this device's tokens without calling the API. */
export function forgetSession(): void {
  accessToken = null;
  inFlight = null;
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

/**
 * One rotation. **The caller must already hold the session lock.**
 *
 * The stored token is read here rather than by the caller, so that what is
 * presented is whatever is current at the moment the lock was acquired — which
 * is the point of taking it. A token read before the lock may have been rotated
 * by another tab while this one waited.
 */
async function refreshWithinLock(): Promise<string> {
  const stored = readStoredRefreshToken();
  if (stored === null) {
    throw new Error('No stored session.');
  }

  try {
    const tokens = await apiRequest<SessionTokens>('/api/v1/auth/refresh', {
      method: 'POST',
      body: { refresh_token: stored },
    });
    return adopt(tokens);
  } catch (cause) {
    // **Only a refusal discards the credential.** A refused refresh token cannot
    // be retried and cannot be repaired: the stored value is spent, revoked or
    // expired, and keeping it would mean presenting it again, which is the one
    // thing section 6 makes expensive.
    //
    // A transport failure is a different fact and is not treated as one. Section
    // 23 makes an unreliable connection the expected case for this application,
    // and discarding a live credential because a train went into a tunnel signs
    // a leader out of a session the server never ended.
    if (cause instanceof ApiRequestError && cause.status === 401) {
      forgetSession();
    }
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
      // Inside the lock, so nothing rotates underneath what is read next.
      const token = accessToken ?? (await refreshWithinLock());
      const stored = readStoredRefreshToken();
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
        // once, then present whatever the rotation just stored.
        const renewed = await refreshWithinLock();
        const current = readStoredRefreshToken();
        if (current !== null) {
          await postLogout(current, renewed);
        }
      }
    });
  } finally {
    forgetSession();
  }
}

function postLogout(refreshToken: string, token: string): Promise<void> {
  return apiRequest<void>('/api/v1/auth/logout', {
    method: 'POST',
    body: { refresh_token: refreshToken },
    accessToken: token,
    idempotencyKey: crypto.randomUUID(),
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
