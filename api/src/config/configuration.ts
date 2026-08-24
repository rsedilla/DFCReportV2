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
  /** {@link seniorPastorPersonIds} */
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
 * **Absent is permitted and the process still starts**, because a fresh
 * installation has to boot and run the initial import (section 2) before either
 * Person exists to be named. Absent means the check fails closed: no
 * `SENIOR_PASTOR` account can be provisioned, and an existing role row confers
 * nothing.
 *
 * **Malformed does stop the process.** A typo strips both Senior Pastors of their
 * authority just as silently as a missing value, and unlike a missing value it
 * looks configured. Anything that is not one or two distinct, UUID-shaped
 * identifiers is refused here.
 *
 * Canonicalized on the way in, so a value spelled in uppercase — which
 * `UUID().uuidString` on iOS produces by default, and which a person copying an
 * identifier out of a query result may well produce too — names the same Person
 * the database does.
 */
function seniorPastorPersonIds(): string[] {
  const raw = (process.env.SENIOR_PASTOR_PERSON_IDS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id !== '');

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

export const APP_CONFIG = 'APP_CONFIG';
