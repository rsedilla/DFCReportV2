import { sql } from 'kysely';

import type { Db } from './database.module';

/**
 * `DateStyle`, pinned by the application rather than inherited from the server.
 *
 * **The failure this prevents is silent and total.** `node-postgres` parses a
 * `timestamptz` by reading the text the server sends, and its parser expects the ISO
 * output format. Under `SQL`, `Postgres` or `German` it does not fail — it returns
 * **`null`**. So every timestamp the API reads comes back empty: `started_at`,
 * `ended_at`, `requested_at`, every effective-dated period and every audit entry,
 * with nothing raised anywhere.
 *
 * Section 5's as-of queries, section 4's backdate floor and section 20's period
 * boundaries are all built on those columns. A deployment could satisfy every test in
 * this repository and still answer "who led this person in March" with nothing.
 *
 * **It is deployment-controlled, and demonstrably not fixed.** Nothing in this
 * repository set it before this file, and this project's own development server runs
 * `ISO, DMY` rather than PostgreSQL's default `ISO, MDY` — so the value varies across
 * machines already, and the variation happens to have been harmless only because both
 * are ISO.
 *
 * **Pinned rather than asserted alone, which is where this parts company with the
 * isolation level.** Section 24 records READ COMMITTED as a dependency and checks it by
 * reading `SHOW transaction_isolation` from the server, because a client cannot set
 * another session's default and the application genuinely depends on how the server is
 * configured. `DateStyle` is not like that: libpq takes it in the startup packet, so
 * the application can simply stop depending on the server. Reusing the isolation
 * level's shape here would be section 25 rule 19 — the same shape without the reason
 * that gave it that shape.
 *
 * The assertion below is therefore not a check on the server. It is a check that the
 * pin took effect, which is what makes the pin something other than a line nobody
 * would notice being deleted.
 */
export const DATE_STYLE = 'ISO, MDY';

/**
 * The libpq startup option carrying it, for the pool.
 *
 * `MDY` is the input half and nothing here depends on it: section 22 sends date-only
 * fields as `YYYY-MM-DD`, which is unambiguous under every input order, and every
 * other value is a bound parameter rather than a literal the server has to parse. It
 * is pinned anyway so that two deployments cannot disagree about something this cheap
 * to fix — but `ISO` is the half that matters, and it is the half the check enforces
 * a reason for.
 */
export const DATE_STYLE_OPTION = '-c DateStyle=ISO,MDY';

/** Thrown at startup, so a misconfigured deployment does not serve nulls quietly. */
export class DateStyleError extends Error {
  constructor(reported: string) {
    super(
      `The database session reports DateStyle '${reported}', not '${DATE_STYLE}'. ` +
        'The pool pins it in the connection options, so this means the pin did not ' +
        'take effect. Refusing to start: under a non-ISO DateStyle the driver parses ' +
        'every timestamp as null rather than failing, so the application would answer ' +
        'with empty dates and raise nothing.',
    );
    this.name = 'DateStyleError';
  }
}

/**
 * Refuse the reported value unless it is exactly what the pool pins.
 *
 * Exact rather than "starts with ISO", although only the ISO half breaks the parser.
 * The pin sets both halves, so anything else means the startup option did not arrive
 * — and that is worth failing on whichever half differs, because the next thing it
 * would silently not apply is the half that matters.
 */
export function checkDateStyle(reported: string): void {
  if (reported !== DATE_STYLE) {
    throw new DateStyleError(reported);
  }
}

/** Read it back from the session and check it. */
export async function assertDateStyle(db: Db): Promise<void> {
  const shown = await sql<{ DateStyle: string }>`SHOW DateStyle`.execute(db);

  checkDateStyle(shown.rows[0].DateStyle);
}
