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
 *
 * **A Cell *meeting* is a different port**, `CELL_MEETING_SCOPE_PORT`, implemented in
 * `attendance`. Decision 0188 resolves a meeting through its own record's frozen
 * responsible leader where one exists, and `cell_meetings` is not this module's table
 * (section 2) — so the two questions, which shared an interface while both were
 * answered from `cell_leaderships`, are now answered where their tables are.
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
   * expressible here. This method is the undated case rather than a claim that dates
   * do not matter, and `CELL_MEETING_SCOPE_PORT` carries the dated one — added for
   * section 7's closed-Cell exception, and moved out of this interface by decision
   * 0188, which put its answer in a table `cells` does not own. **Neither is the first
   * dated *read*: a dated resolution serving a *recording* capability is not a read in
   * section 7's sense (decision 0186), and the audit-log question that waits on the
   * first dated read still waits.**
   *
   * *This paragraph said "nothing in this system reads a past period yet" and named
   * the reporting slice as the one that would need a dated variant. It was left
   * standing in the commit that added the variant directly beneath it, and cited as
   * that commit's licence while asserting the thing did not exist.*
   */
  leaderForScope(cellId: string): Promise<string | null>;
}
