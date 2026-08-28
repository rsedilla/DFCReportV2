import { Capability } from './capabilities';

/**
 * The capabilities that issue authority, which SKILL.md section 7 refuses to an
 * account holding `SENIOR_PASTOR` however they are granted.
 *
 * **Two, not the seven section 7 withholds from the role, and the seven are not
 * alike.** This pair is what makes the combination self-perpetuating: a holder can
 * grant themselves the remaining five and revoke everybody else's roles, so the
 * second party section 7 requires is present when the grant is issued and never
 * again, and no Admin can undo it afterwards. `records.backdate_effective_date`,
 * `people.merge` and `people.correct_sex` are withheld on a different ground that
 * section 7 states — each moves totals for periods already reported — and each use
 * is one audited operation whose authority an Admin can still revoke.
 * `settings.manage` and `cell.approve_leadership` section 7 withholds in its table
 * and argues nowhere.
 *
 * So the other five stay ordinary Admin-issued grants. A capability joins this set
 * only by amending section 7, which is where the argument for refusing it outright
 * rather than auditing it has to be made — the same rule `single-scope.ts` states
 * for its own list, and for the same reason: a set stated in code and nowhere else
 * goes stale silently, in the direction that stops protecting something.
 */
export const GRANT_MAKING: ReadonlySet<Capability> = new Set([
  Capability.RolesManage,
  Capability.AccountsManage,
]);

/** Whether a capability issues authority (SKILL.md section 7). */
export function isGrantMaking(capability: Capability): boolean {
  return GRANT_MAKING.has(capability);
}
