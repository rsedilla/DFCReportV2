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
}

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
 * **Anything else that names nobody stops the process**, including a value that is
 * present and yields no identifier. A bare separator is what a deployment template
 * renders for an empty list, and it *looks* configured — which is the distinction
 * the whole rule turns on. A blank value and a missing one both read as "not set
 * yet"; a typo strips both Senior Pastors of their authority just as silently and
 * leaves nothing for a reviewer to notice.
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
  const nodeEnv = (process.env.NODE_ENV ?? 'development') as AppConfig['nodeEnv'];
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
  };
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
