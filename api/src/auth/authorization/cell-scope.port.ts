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
   * section 7's closed-Cell exception. **Not the first dated *read*, which this sentence
   * called it for four days and which the paragraph on that method retracts at length:
   * it is a dated resolution serving a *recording* capability (decision 0186), and the
   * audit-log question that waits on the first dated read still waits.**
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
   * **On an ACTIVE Cell this answers exactly what `leaderForScope` answers, and one
   * method serves the GET and the POST deliberately** (decision 0186). Section 7's
   * exception is written for a Cell with no current leader to resolve through, so an
   * active Cell resolves through whoever holds it now and its former leader cannot file
   * their own last meeting — nor read its roster.
   *
   * **The capability decides that, not the HTTP method.** Section 7 names exactly three
   * capabilities that resolve as of the period being viewed — `cell.view_subtree`,
   * `reports.view_subtree`, `audit.view` — and every other capability resolves as a
   * write, whether the route it guards reads or writes. Section 7 ties the roster read's
   * *capability* to the write it serves, in terms and with a reason; resolving its
   * *scope* by the other rule would make one route ask two questions and answer them
   * differently.
   *
   * **Nothing here enforces that, and it cannot**: the guard branches on the target's
   * `kind` and never reads the capability, and neither resolution in this interface is
   * the viewing one. `test/unit/capability-scope-resolution.spec.ts` carries the rule
   * that can fail today — no route declares a viewing capability against a Cell-resolved
   * target — and goes red on the first Cell-targeted viewing route, which is when the
   * dated read resolution is owed. *Not on the first Stage 5 report, which an earlier
   * version of this sentence claimed: section 7 makes a report's target a scope selector
   * rather than a Cell, so an aggregate report would not reach this at all.*
   *
   * Nothing becomes unrecordable under the strict reading: on an active Cell handed
   * from A to B, B files the meeting and section 13 freezes its responsible leader to
   * A. What A is refused is a view of a past period, which is what a viewing capability
   * is for — and there is no such route yet, which is a gap in the surface that the first
   * Cell-targeted viewing route closes rather than a gap in this rule.
   *
   * **A dated resolution serving a viewing capability is a different method from this
   * one**, and this is not it. Section 7's "as of the period being viewed" is the wider
   * rule, and the first Cell-targeted viewing route is what needs it — which Stage 5 may
   * or may not produce, since Section 7 makes an aggregate report's target a scope
   * selector rather than a Cell.
   *
   * *Two earlier versions of this paragraph were wrong in opposite directions. The
   * first called the asymmetry "section 7's and deliberate", asserting a settlement the
   * specification did not make. The second recorded it as an open contradiction, which
   * it was for four days, and named this method as the system's first dated read — it
   * is a dated resolution serving a write, and the audit-log question that waits on the
   * first dated read still waits.*
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
