import { sameId } from '../../common/identifiers';

/**
 * Which two Persons may hold `SENIOR_PASTOR` (SKILL.md section 7).
 *
 * The role's enforcement is in two halves because the two are enforceable in
 * different ways. The **count** is a database constraint — two slots and a partial
 * unique index over them — chosen over a counting trigger because `pg_restore
 * --disable-triggers` skips a check that runs and does not skip an index.
 * **Which two Persons** cannot be a database constraint at all: section 7 refuses
 * to give the database a durable representation of who Bishop Oriel Ballano and
 * Pastora Geraldine Ballano are, since a flag on the Person or a reserved
 * identifier would put the church's two most consequential accounts behind a row
 * somebody could edit. So it is decided here, against configuration
 * (`AppConfig.seniorPastorPersonIds`).
 *
 * **Asked in two places, and the second is the one a restore cannot skip.**
 * Provisioning asks before granting the role, so an ordinary request gets an
 * answer. `AuthorizationService` asks again while assembling an account's
 * effective authority, so a row that reached `account_roles` by any other route —
 * a restore, a hand-run statement, a migration — yields no role default and no
 * exemption from the rules section 5 decides by role. The reasoning is the slot
 * ruling's own, re-derived rather than copied (section 25, rule 19): a check made
 * only where a row is written is skipped by exactly the paths that skip a trigger.
 *
 * `single-scope.ts` is the nearest existing shape — a row that cannot mean what it
 * appears to mean is honoured as nothing rather than in part — and it applies for
 * the same underlying reason, that both express a fact about a row which the
 * database cannot.
 */
export function isNamedSeniorPastor(personId: string, named: readonly string[]): boolean {
  // `sameId`, not `===`. Both sides normally arrive from a `uuid` column or from
  // the boundary pipe and are already canonical, but this comparison decides
  // authority and fails open when it answers wrongly — and section 7 records that
  // an identifier compared in TypeScript rather than in SQL is the one place case
  // survives. Configuration is not covered by the boundary pipe at all.
  return named.some((candidate) => sameId(candidate, personId));
}
