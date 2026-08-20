/**
 * The only way this application talks to the church's data.
 *
 * Everything goes through `/api/v1`, exactly as the Android and iOS clients will:
 * core business rules live in the backend domain layer so that all three surfaces
 * behave identically, and so that a rule fixed once is fixed everywhere
 * (SKILL.md section 2).
 *
 * Nothing here decides what a user may do. The API is the sole authority for
 * authorization, and UI filtering is never sufficient on its own (section 1,
 * principle 4). What the client renders is a convenience; what it is allowed to
 * do is answered on every request, by the server.
 */

/** The one error envelope (SKILL.md section 22, Errors). */
export interface ApiErrorBody {
  error: {
    /** Stable and machine-readable. Branch on this, never on `message`. */
    code: string;
    /** Human-readable and safe to display. */
    message: string;
    details: Record<string, unknown>;
  };
}

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(status: number, body: ApiErrorBody) {
    super(body.error.message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = body.error.code;
    this.details = body.error.details;
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  accessToken?: string;
  /**
   * A client-generated UUID, required on every state-changing request from the
   * first write endpoint onwards (SKILL.md sections 22 and 23). A leader on an
   * unreliable connection will retry, and a retry must never create a second
   * record.
   */
  idempotencyKey?: string;
  signal?: AbortSignal;
}

function baseUrl(): string {
  const url = process.env.NEXT_PUBLIC_API_URL;
  if (!url) {
    throw new Error('NEXT_PUBLIC_API_URL is not set. Copy web/.env.example to web/.env.local.');
  }
  return url.replace(/\/$/, '');
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json' };

  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (options.accessToken) {
    headers.Authorization = `Bearer ${options.accessToken}`;
  }
  if (options.idempotencyKey) {
    headers['Idempotency-Key'] = options.idempotencyKey;
  }

  const response = await fetch(`${baseUrl()}${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const payload: unknown = await response.json();

  if (!response.ok) {
    throw new ApiRequestError(response.status, payload as ApiErrorBody);
  }

  return payload as T;
}
