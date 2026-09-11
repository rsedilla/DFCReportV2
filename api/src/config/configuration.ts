/**
 * Configuration comes from the environment and nowhere else (CLAUDE.md, Secrets).
 * The application refuses to start on a missing or implausible value rather than
 * falling back to a default that would be wrong in production.
 */

import { canonicalId, isUuid } from '../common/identifiers';

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  databaseUrl: string;
  jwtSecret: string;
  corsAllowedOrigins: string[];
  /**
   * The Person identifiers of the two Senior Pastors (SKILL.md section 7). Empty
   * where none is configured, which fails the check closed. Parsed and validated
   * by the loader below.
   */
  seniorPastorPersonIds: string[];
  /**
   * Which `EmailPort` implementation is bound (SKILL.md section 6, ruling of
   * 2026-09-11). `log` delivers nothing and is the default; `outbox` writes each
   * message, token included, to `emailOutboxDir`.
   */
  emailTransport: EmailTransport;
  /** Required by, and only meaningful to, the `outbox` transport. */
  emailOutboxDir: string | null;
}

/** SKILL.md section 6. A real provider joins this list rather than replacing it. */
export const EMAIL_TRANSPORTS = ['log', 'outbox'] as const;

export type EmailTransport = (typeof EMAIL_TRANSPORTS)[number];

const MINIMUM_SECRET_LENGTH = 32;

/** SKILL.md section 7 caps the role at two, and the slot index enforces it. */
const SENIOR_PASTOR_SEATS = 2;

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(`${name} is required. Copy .env.example to .env and fill it in.`);
  }
  return value;
}

/**
 * The Person identifiers of the two Senior Pastors SKILL.md section 4 names.
 *
 * **This is where the domain half of the `SENIOR_PASTOR` rule reads from, and it
 * is configuration rather than a record on purpose** (section 7). What decides it
 * is whether editing the source would be an escalation for whoever can edit it: a
 * flag on the Person is editable by a Leader under `people.edit_basic`, a
 * `settings` row is editable by Admin — who deliberately holds neither seat —
 * and the environment is editable by whoever deploys the API, who already holds
 * `JWT_SECRET` and can mint a session for any account that exists.
 *
 * **Absent — unset, or blank — is permitted and the process still starts**,
 * because a fresh installation has to boot and run the initial import (section 2)
 * before either Person exists to be named. Absent means the check fails closed: no
 * `SENIOR_PASTOR` account can be provisioned, and an existing role row confers
 * nothing.
 *
 * **Anything else that does not name one or two distinct, well-formed identifiers
 * stops the process** — too many, one named twice, a value that is not an
 * identifier, or a value that is present and names nobody at all. A bare separator
 * is the last of those, and is what a deployment template renders for an empty
 * list; it *looks* configured, which is the distinction the whole rule turns on. A
 * blank value and a missing one both read as "not set yet"; every other mistake
 * strips both Senior Pastors of their authority just as silently and leaves
 * nothing for a reviewer to notice.
 *
 * **Read once, when the process starts.** Naming the two after the import, and a
 * succession later, each take effect on the next restart (section 7).
 *
 * Canonicalized on the way in, so a value spelled in uppercase — which
 * `UUID().uuidString` on iOS produces by default, and which a person copying an
 * identifier out of a query result may well produce too — names the same Person
 * the database does.
 */
function seniorPastorPersonIds(): string[] {
  const configured = process.env.SENIOR_PASTOR_PERSON_IDS ?? '';
  const raw = configured
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id !== '');

  if (raw.length === 0) {
    if (configured.trim() !== '') {
      throw new Error(
        'SENIOR_PASTOR_PERSON_IDS is set and names nobody. Leave it empty to mean "not yet".',
      );
    }
    return [];
  }

  if (raw.length > SENIOR_PASTOR_SEATS) {
    throw new Error(
      `SENIOR_PASTOR_PERSON_IDS names ${raw.length} people and SKILL.md section 7 caps the role at ${SENIOR_PASTOR_SEATS}`,
    );
  }

  const ids = raw.map((id) => {
    if (!isUuid(id)) {
      throw new Error(
        `SENIOR_PASTOR_PERSON_IDS must be a comma-separated list of Person ids (got "${id}")`,
      );
    }
    return canonicalId(id);
  });

  if (new Set(ids).size !== ids.length) {
    throw new Error('SENIOR_PASTOR_PERSON_IDS names the same Person twice');
  }

  return ids;
}

export function loadConfig(): AppConfig {
  // **Required rather than defaulted** (ruling of 2026-09-11). A blank or unrecognised
  // value was always refused; an absent one resolved to `development`, which made the
  // resolved field a second way of asking a question the raw variable answers differently.
  // That difference is invisible where it is read, and it produced the wrong guard twice
  // in decision 0236. Required, the two cannot differ.
  const nodeEnv = required('NODE_ENV') as AppConfig['nodeEnv'];
  if (!['development', 'test', 'production'].includes(nodeEnv)) {
    throw new Error(`NODE_ENV must be development, test or production (got "${nodeEnv}")`);
  }

  const port = Number.parseInt(process.env.PORT ?? '3001', 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`PORT must be a valid port number (got "${process.env.PORT ?? ''}")`);
  }

  const jwtSecret = required('JWT_SECRET');
  if (jwtSecret.length < MINIMUM_SECRET_LENGTH) {
    throw new Error(`JWT_SECRET must be at least ${MINIMUM_SECRET_LENGTH} characters`);
  }

  const { emailTransport, emailOutboxDir } = emailDelivery(nodeEnv);

  return {
    nodeEnv,
    port,
    databaseUrl: required('DATABASE_URL'),
    jwtSecret,
    corsAllowedOrigins: (process.env.CORS_ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin !== ''),
    seniorPastorPersonIds: seniorPastorPersonIds(),
    emailTransport,
    emailOutboxDir,
  };
}

/**
 * Which transport is bound, and the refusal that makes the outbox safe to ship.
 *
 * **The refusal is the load-bearing half of the 2026-09-11 ruling**, not the adapter,
 * and it is stated positively: `outbox` binds in `development` and nowhere else.
 *
 * **It takes the resolved `nodeEnv`, which is safe only because that value is now
 * required** (ruling of 2026-09-11). While an absent `NODE_ENV` resolved to
 * `development`, this had to read the raw variable: `npm run start:prod` sets nothing and
 * `main.ts` loads `dotenv` in every environment, so a production host that never exported
 * it, carrying `EMAIL_TRANSPORT=outbox` in its `.env`, would have written activation
 * **and password-reset** tokens to disk. *That is history: since the ruling of 2026-09-11
 * the adapter withholds a reset token, so the same hole today would write activation
 * tokens only. The sentence is kept in the past tense rather than softened, because the
 * guard it argues for is what stops either.*
 *
 * *Two versions of this guard were wrong for that reason. The first refused `production`
 * by name; `architecture-guardian` reproduced the absent-variable hole. The second stated
 * the rule positively against the resolved value, which reads correctly and left the
 * identical hole, because the default was the very value being required. Requiring the
 * variable is what removed the difference rather than this guard working around it.*
 *
 * **Absent means `log`**, so no existing deployment changes behaviour by taking this
 * change, and a deployment that has never heard of either variable is unaffected.
 *
 * The directory is required with `outbox` rather than defaulted, because a default
 * would put credentials somewhere nobody chose.
 */
function emailDelivery(nodeEnv: AppConfig['nodeEnv']): {
  emailTransport: EmailTransport;
  emailOutboxDir: string | null;
} {
  const configured = (process.env.EMAIL_TRANSPORT ?? '').trim();

  if (configured === '') {
    return { emailTransport: 'log', emailOutboxDir: null };
  }

  if (!(EMAIL_TRANSPORTS as readonly string[]).includes(configured)) {
    throw new Error(
      `EMAIL_TRANSPORT must be one of ${EMAIL_TRANSPORTS.join(', ')} (got "${configured}")`,
    );
  }

  const emailTransport = configured as EmailTransport;

  if (emailTransport !== 'outbox') {
    return { emailTransport, emailOutboxDir: null };
  }

  if (nodeEnv !== 'development') {
    throw new Error(
      'EMAIL_TRANSPORT=outbox writes activation and password-reset tokens to disk, so it ' +
        'binds only where NODE_ENV is explicitly "development" (SKILL.md section 6). ' +
        `NODE_ENV is "${nodeEnv}". Configure a real provider instead.`,
    );
  }

  const dir = (process.env.EMAIL_OUTBOX_DIR ?? '').trim();
  if (dir === '') {
    throw new Error('EMAIL_OUTBOX_DIR is required when EMAIL_TRANSPORT=outbox');
  }

  return { emailTransport, emailOutboxDir: dir };
}

/**
 * What to say at startup when nobody is named, and null when somebody is.
 *
 * SKILL.md section 7 says the process says so at startup, and a sentence in a
 * specification with nothing that can fail on it is what this repository keeps
 * refusing to ship — so the message is a value that a test can hold rather than a
 * `logger.warn` buried in `bootstrap()`, which nothing reaches.
 *
 * It is a warning and not an error because absent is legitimate: a fresh
 * installation boots with it unset and runs the initial import (section 2). What
 * makes it worth saying is the other case, a deployment that has *lost* the value,
 * where both Senior Pastors are stripped of their authority and nothing else
 * reports anything.
 */
export function seniorPastorsUnnamedWarning(config: AppConfig): string | null {
  if (config.seniorPastorPersonIds.length > 0) {
    return null;
  }

  return (
    'SENIOR_PASTOR_PERSON_IDS is unset. No SENIOR_PASTOR account can be provisioned, and any ' +
    'existing SENIOR_PASTOR role grants nothing. That is correct before the initial import ' +
    'and wrong afterwards.'
  );
}

export const APP_CONFIG = 'APP_CONFIG';
