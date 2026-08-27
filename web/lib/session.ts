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
 * user has done nothing wrong. So refreshing is funnelled through a single
 * in-flight promise (`inFlight` below) and there is no path that reads the
 * stored token and posts it without going through that funnel.
 *
 * The 2026-08-21 ruling makes *simultaneous* presentation harmless — one caller
 * wins the rotation and the other is refused, with no revocation. That is the
 * safety net rather than the design: it covers two devices racing, not one
 * client racing itself, and React strict mode double-invokes effects in
 * development, which is exactly how a client races itself.
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

/**
 * Held in memory only, and deliberately not exported. Everything that needs it
 * goes through `authenticatedRequest`, so there is no call site that can send it
 * without the refresh-and-retry behaviour below.
 */
let accessToken: string | null = null;

/** The single in-flight refresh. See the note at the top of the file. */
let inFlight: Promise<string> | null = null;

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
 * Exchange the stored refresh token for a new pair, at most once at a time.
 *
 * Every concurrent caller awaits the same promise and receives the same access
 * token. Two posts of one refresh token would be the reuse signal described at
 * the top of this file.
 */
function refreshSession(): Promise<string> {
  if (inFlight) {
    return inFlight;
  }

  const stored = readStoredRefreshToken();
  if (stored === null) {
    return Promise.reject(new Error('No stored session.'));
  }

  const attempt = apiRequest<SessionTokens>('/api/v1/auth/refresh', {
    method: 'POST',
    body: { refresh_token: stored },
  })
    .then(adopt)
    .catch((cause: unknown) => {
      // A refused refresh token cannot be retried and cannot be repaired: the
      // stored value is spent, revoked, or expired. Keeping it would mean
      // presenting it again on the next request, which is the one thing section
      // 6 makes expensive.
      forgetSession();
      throw cause;
    })
    .finally(() => {
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
 * `logout` is authenticated and state-changing, so it carries an
 * `Idempotency-Key` like every other authenticated write. The 2026-08-22 ruling
 * refused to exempt the session endpoints: section 7's carve-out is from the
 * *capability* guard, and borrowing it here would be applying a rule to
 * something it was not written about.
 *
 * The tokens are forgotten whatever the API answers. A failed sign-out that
 * leaves the user apparently signed in is the worse outcome of the two on a
 * shared phone, and the refresh token is discarded rather than reused.
 */
export async function signOut(): Promise<void> {
  const stored = readStoredRefreshToken();

  try {
    if (stored !== null) {
      await authenticatedRequest<void>('/api/v1/auth/logout', {
        method: 'POST',
        body: { refresh_token: stored },
        idempotencyKey: crypto.randomUUID(),
      });
    }
  } finally {
    forgetSession();
  }
}

/** End every session this account holds, on every device (section 6). */
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
