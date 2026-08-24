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
 * **A refused row answers `CAPABILITY_DENIED` where the capability it would have
 * carried is what the request needed, and that is derived here rather than
 * borrowed.** An earlier version of this docblock cited `single-scope.ts` as
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
 * `SENIOR_PASTOR` row names nothing: it contributes none of the role's
 * capabilities, at any scope, so where the account has no other source for the one
 * being asked about, `CAPABILITY_DENIED` is the true answer and `SCOPE_DENIED`
 * would send an administrator to widen a scope that does not exist.
 *
 * **That qualifier is load-bearing, and both versions of this docblock that made
 * the claim about the *account* dropped it.** An account holding a second role, or
 * an explicit grant, keeps whatever those name and is refused on its own terms —
 * `accounts.e2e.spec.ts` builds exactly that, a `LEADER` carrying an unhonoured
 * row, asserting it keeps own-subtree authority. This file's first version said it
 * at row level and was right; the two that restated it about the account were not.
 *
 * **The other consequence of a refused row answers the other code, and this
 * paragraph did not say so for two review passes.** A refused row also withholds
 * the exemption section 5 invariant 4 decides by role — and an actor who holds the
 * capability by any other route reaches that check and is refused `SCOPE_DENIED`,
 * which is what section 22 says a domain-layer statement about an
 * actor's authority over a target answers. Any other route, deliberately: a second
 * role's defaults, or an explicit grant at *any* scope the capability permits, since
 * `people.manage_pastoral_assignment` is not one of the Whole-Church-only set. An
 * earlier version named a Whole Church grant as though it were the only way here,
 * which is the same enumeration mistake one route further out. Both codes name the
 * half that failed;
 * one unqualified sentence covered only the half being looked at, which is the
 * fault this file's own history is a record of. A test on this branch asserted the
 * `SCOPE_DENIED` case throughout.
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
