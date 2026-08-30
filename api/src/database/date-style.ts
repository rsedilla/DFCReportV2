import { sql } from 'kysely';

import type { Db } from './database.module';

/**
 * `DateStyle`, pinned by the application rather than inherited from the server.
 *
 * **The failure this prevents is silent.** `node-postgres` parses a `timestamptz` by
 * reading the text the server sends, and its parser expects the ISO output format.
 * Under `SQL`, `Postgres` or `German` it does not fail — it returns **`null`**. So
 * every `timestamptz` and `timestamp` the API reads comes back empty: `started_at`,
 * `ended_at`, `requested_at`, every effective-dated period and every audit entry,
 * with nothing raised anywhere.
 *
 * **A `date` fails differently, thirty lines above the pin in `database.module.ts`.**
 * The OID-1082 parser there returns the server's raw text rather than an instant, and
 * raw text is not null under a non-ISO style — it is `15.06.1985`, a well-formed
 * string of the wrong shape, satisfying `PersonsTable.birth_date`'s declared `string`
 * and flowing into a section 22 date-only field. That parser's unstated assumption,
 * that the text is `YYYY-MM-DD`, is what this pin guarantees.
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
 * **This is the same kind of setting as the isolation level, and a first version of
 * this file said otherwise.** It claimed isolation must be asserted rather than set
 * because a client cannot set another session's default. That is false —
 * `default_transaction_isolation` arrives in the startup packet by exactly the
 * mechanism used here, verified in one connection — and the section 25 rule 19 claim
 * built on that asymmetry was itself rule 19, applied to a distinction that does not
 * exist.
 *
 * What separates them is the failure rather than the mechanism: a wrong `DateStyle`
 * corrupts every date in silence, while a wrong isolation level removes a guarantee a
 * test asserts. Whether isolation should be pinned here too is recorded as open.
 *
 * The assertion below is not a check on the server: once the pin is in place the
 * server no longer reaches the application. It is a check that the pin took effect,
 * which is what makes the pin something other than a line nobody would notice being
 * deleted — and it has a case of its own, since `pg` lets a `DATABASE_URL` carrying
 * its own `?options=` supersede the pool's and discard the pin silently.
 */
export const DATE_STYLE = 'ISO, MDY';

/**
 * The libpq startup option carrying it, for the pool.
 *
 * `MDY` is the input half and nothing here depends on it — checked rather than
 * assumed: migrations carry no date literals, the tree import refuses a birthday that
 * is not ISO, and the one rendered instant goes through `to_char` with an explicit
 * format. Being a *bound parameter* is not what makes the rest safe, which an earlier
 * version of this sentence claimed: `pg` sends every parameter as text, and it is
 * being rendered ISO-8601 that makes the server's input order irrelevant.
 *
 * It is pinned anyway so that two deployments cannot disagree about something this
 * cheap to fix — but `ISO` is the half that matters.
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
 * The pin sets both halves, so a difference in either is a sign the option did not
 * arrive as intended — worth failing on, because the next thing that would silently
 * not apply is the half that matters.
 *
 * Not quite "did not arrive": a partial `-c DateStyle=ISO` would arrive and leave the
 * input half inherited. Nothing sends that, and the check is written for the sign
 * rather than for a specific cause.
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
