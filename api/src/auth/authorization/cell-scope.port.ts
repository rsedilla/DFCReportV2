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

  /**
   * The Person a **Cell meeting** resolves through, given the meeting's own date.
   *
   * **Section 7's closed-Cell exception, and it is the only dated resolution in the
   * system.** The general rule above is that a write is acted on now and resolves
   * through the Cell's current leader — and a closed Cell has none, so every write
   * against one resolves through nobody. Section 7 carves out exactly one case:
   * "recording or correcting a Cell meeting whose month's submission window is still
   * open, together with the meeting-scoped roster read that write requires: those
   * resolve through whoever led the Cell **on the meeting's date**."
   *
   * **Per record rather than per Cell**, which no other target is. Section 7: "the
   * meeting carries the answer and the Cell no longer does. A Cell handed from A to B
   * and then closed has meetings belonging to each, and resolving through the last
   * leader would show A the task (section 19) while denying A the write."
   *
   * **On an ACTIVE Cell this answers exactly what `leaderForScope` answers**, and that
   * is section 7 rather than an optimisation: the exception is for a Cell that has no
   * current leader to resolve through. An active Cell that has changed hands resolves
   * through whoever leads it *now*, so its former leader cannot file their own last
   * meeting and an upline or the successor does. That asymmetry is section 7's and is
   * deliberate — a leader who still has a Cell is still accountable for it through the
   * person who holds it, while a closed Cell leaves nobody in that position.
   *
   * **The date is not chosen by the actor**, which is what keeps this consistent with
   * the rule it is an exception to. Section 7: "A closed Cell's meetings cannot be
   * rescheduled (section 13), so the authorizing date is the scheduled one, derived
   * from the Cell's own schedule. Without that, an actor could declare an actual date
   * inside their own past tenure and recover authority through a request field." The
   * caller passes the meeting's scheduled date, which is its identity and arrives in
   * the path.
   *
   * **Bounded by the window, and null once it shuts.** Section 7: "once the window
   * shuts, that too resolves through nobody and only Admin can amend." Returning the
   * former leader past the close would leave the refusal to the domain layer, which
   * would answer `PERIOD_CLOSED` where section 7 asks for a scope denial — the same
   * outcome for an honest client and the wrong answer about which rule refused.
   *
   * `on` is a `YYYY-MM-DD` Manila date (section 20).
   */
  leaderForMeetingScope(cellId: string, on: string): Promise<string | null>;
}
