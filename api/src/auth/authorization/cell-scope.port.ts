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
   * expressible here. This method is the undated case rather than a claim that dates
   * do not matter, and `leaderForMeetingScope` below is the dated one — added for
   * section 7's closed-Cell exception, which is the first dated read this system has.
   *
   * *This paragraph said "nothing in this system reads a past period yet" and named
   * the reporting slice as the one that would need a dated variant. It was left
   * standing in the commit that added the variant directly beneath it, and cited as
   * that commit's licence while asserting the thing did not exist.*
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
   * **On an ACTIVE Cell this answers exactly what `leaderForScope` answers — and
   * whether that is right for a *read* is open, recorded in `CLAUDE.md`.** Section 7's
   * exception is written for a Cell with no current leader to resolve through, so an
   * active Cell resolves through whoever holds it now and its former leader cannot
   * file their own last meeting.
   *
   * That is section 7's answer for a **write**. Section 13 states a split the same
   * paragraph does not: a Cell meeting resolves "through the Cell's leader as of the
   * period being viewed for a read, and through the current leader for a write". This
   * one method serves a GET and a POST, so it gives both the write answer — and on an
   * active Cell that changed hands, the leader of the day is refused the *read* that
   * section 13 appears to grant them.
   *
   * Section 7 bundles "the meeting-scoped roster read that write requires" with the
   * write; section 13 splits them. For a closed Cell the two coincide. For an active
   * one they disagree, and nothing says which wins.
   *
   * *An earlier version of this paragraph called the asymmetry "section 7's and
   * deliberate", which asserted a settlement the specification does not make.*
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
