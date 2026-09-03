/**
 * How a Cell **meeting** is placed in the pastoral tree, for the one purpose of
 * resolving a scope against it (SKILL.md section 7; decisions 0186, 0187, 0188).
 *
 * **Its own port, and not a method on `CELL_SCOPE_PORT`, because decision 0188 moved
 * the answer into a table `cells` does not own.** A meeting resolves through its
 * record's frozen `responsible_leader_id` where a record exists, and `cell_meetings`
 * belongs to `attendance` (section 2). `CellsReadService` may not read it, so this
 * interface is implemented one module over.
 *
 * The port rather than a direct call is section 2's ordinary answer to a cycle:
 * `AttendanceModule` imports `AuthorizationModule`, so `authorization -> attendance`
 * would close a loop. The interface is declared here, where the guard needs it;
 * `attendance` implements it; `AppModule` binds the two. That is the same inversion
 * `CELL_SCOPE_PORT` and `EMAIL_PORT` already use.
 *
 * **The implementation still asks `cells` for everything about the Cell** — its
 * lifecycle state, its current leader, and who led it on a date. `attendance` already
 * imports `CellsModule` and that direction is not a cycle, so only the *meeting* half
 * of the question moves; the Cell half stays where the tables are.
 *
 * **Absent, it denies**, on the terms decision 0181 settles: an inversion port is
 * injected optionally so a missing binding costs one operation rather than the whole
 * application, and the operation then refuses rather than skipping its check.
 * `module-graph.spec.ts` asserts the binding resolves, which is what makes optional
 * safe rather than merely cheap.
 */
export const CELL_MEETING_SCOPE_PORT = Symbol('CELL_MEETING_SCOPE_PORT');

export interface CellMeetingScopePort {
  /**
   * The Person a Cell meeting's scope resolves through, or null where nothing does.
   *
   * Three cases, and the third is the only one that differs from a plain Cell target:
   *
   * - **An ACTIVE Cell** resolves through its current leader (decision 0186). A Cell
   *   that has changed hands therefore refuses its former leader, who files nothing;
   *   the successor or an upline does, and the meeting still *belongs* to the former
   *   leader because section 13 freezes `responsible_leader_id` separately. Scope and
   *   ownership are different questions and section 7 says so in terms.
   * - **A CLOSED Cell whose month has shut** resolves through nobody. Section 7: "once
   *   the window shuts, that too resolves through nobody and only Admin can amend."
   * - **A CLOSED Cell whose month is still open** is section 7's exception, and is
   *   where decision 0188 applies: the meeting's own record carries the answer where
   *   one exists, and the scheduled date answers where none does.
   *
   * **Why the record rather than the date** (decision 0188). Section 7 fixed the
   * authorizing date as the scheduled one because "a closed Cell's meetings cannot be
   * rescheduled" — an inference about rescheduling a Cell that is *already* closed,
   * which says nothing about a meeting moved while the Cell was ACTIVE and closed
   * afterwards. For that meeting the two dates name different days and can name
   * different leaders, so authorizing at the scheduled date would let the leader of the
   * scheduled day correct a record belonging to the leader of the day it happened.
   * Section 7's own phrase for this target is that "the meeting carries the answer and
   * the Cell no longer does", and the frozen column is the meeting carrying it.
   *
   * **The date is still not chosen by the actor**, which is what keeps this an
   * exception rather than a hole. `responsible_leader_id` is frozen at the first
   * submission from the meeting's own instant, and a first submission cannot carry
   * `RESCHEDULED` (section 13) — so the instant it freezes is always the scheduled
   * date, derived from the Cell's own schedule, and a later reschedule moves
   * `actual_date` and never the frozen column.
   *
   * `on` is the meeting's scheduled date, a `YYYY-MM-DD` Manila date (section 20),
   * which is its identity (section 13) and arrives in the path.
   */
  leaderForMeetingScope(cellId: string, on: string): Promise<string | null>;
}
