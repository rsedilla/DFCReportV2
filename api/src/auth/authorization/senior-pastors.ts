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
 * **A refused row answers `CAPABILITY_DENIED`, and that is derived here rather
 * than borrowed.** An earlier version of this docblock cited `single-scope.ts` as
 * the precedent — "a row that cannot mean what it appears to mean is honoured as
 * nothing rather than in part" — which is the one thing that file does not do.
 * `grantCoversNothing` is applied in the *scope* half of `authorize`, deliberately:
 * the 2026-08-24 ruling records dropping it at assembly as a live defect, because
 * the account then looked as though it did not hold the capability at all and a
 * `SCOPE_DENIED` became a `CAPABILITY_DENIED`. Citing it while doing the removed
 * thing is section 25 rule 19 committed inside a sentence claiming to apply it.
 *
 * The two differ on whether the capability is held at all, which is exactly what
 * section 22's two codes distinguish. A narrow grant of a Whole Church capability
 * names it, so the account holds it and only the scope is unusable. A refused
 * `SENIOR_PASTOR` row names nothing: the account holds none of the role's
 * capabilities, at any scope, so `CAPABILITY_DENIED` is the true answer and
 * `SCOPE_DENIED` would send an administrator to widen a scope that does not exist.
 *
 * On the failure mode section 7 accepts — configuration lost — that means a real
 * Senior Pastor is told they hold nothing while `account_roles` says otherwise.
 * What resolves it is the error logged at the refusal, which names both causes,
 * rather than a status code that could only be misleading in the other direction.
 */
export function isNamedSeniorPastor(personId: string, named: readonly string[]): boolean {
  // `sameId`, not `===`. Both sides normally arrive from a `uuid` column or from
  // the boundary pipe and are already canonical, but this comparison decides
  // authority and fails open when it answers wrongly — and section 7 records that
  // an identifier compared in TypeScript rather than in SQL is the one place case
  // survives. Configuration is not covered by the boundary pipe at all.
  return named.some((candidate) => sameId(candidate, personId));
}
