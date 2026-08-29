/**
 * How a Cell is placed in the pastoral tree, for the one purpose of resolving a
 * scope against it (SKILL.md section 7).
 *
 * Section 7: "a **Cell**, a Cell meeting, a membership or a leadership resolves
 * through the Cell's leader **as of the period being viewed**, falling back to its
 * last leader where the Cell is closed."
 *
 * **A port rather than a direct call, and the reason is section 2.** `cells` owns
 * `cell_leaderships`, so the answer can only come from that module — and `cells`
 * imports `AuthorizationModule` to ask its own authorization questions, so a
 * dependency the other way would be a cycle. The interface is declared here, where
 * the guard needs it; `cells` implements it; `AppModule` binds the two. That is the
 * same inversion `EMAIL_PORT` already uses in this codebase.
 *
 * **Absent, it denies**, which is what `scopes.ts` already says of a target the
 * resolver has no rule for: "an endpoint cannot be authorized against a target the
 * system does not yet know how to place in the tree." A missing binding closes
 * every Cell-scoped endpoint rather than opening one.
 */
export const CELL_SCOPE_PORT = Symbol('CELL_SCOPE_PORT');

export interface CellScopePort {
  /**
   * The Person a Cell's scope resolves through, or null where the Cell does not
   * exist or has never had a leader.
   *
   * **The current leader, falling back to the last one where the Cell is closed.**
   * Section 7 gives the fallback a reason rather than treating it as tidiness: a
   * closed Cell keeps its history and its roster visible to the leader who led it
   * (sections 10 and 15), and resolving through a current leader it no longer has
   * would take that away at the moment the record becomes historical.
   *
   * Section 7's "as of the period being viewed" is the wider rule and is not
   * expressible here: a request for a past period resolves against the leader then,
   * and nothing in this system reads a past period yet. The reporting slice that
   * first does will need a dated variant, and this method is the undated case
   * rather than a claim that dates do not matter.
   */
  leaderForScope(cellId: string): Promise<string | null>;
}
