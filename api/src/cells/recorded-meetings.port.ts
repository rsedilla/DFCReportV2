/**
 * How many of a Cell's meetings were recorded in a month — the **numerator** of
 * Section 12's coverage line (`4 of 5 meetings recorded`).
 *
 * **A port rather than a direct call, and the reason is Section 2's direction rule.**
 * The denominator is `cells`' own: Section 2 assigns "the Cell coverage denominator" to
 * this module by name, "whose every input (`cell_schedules`, `cells`,
 * `cell_leaderships`) it owns". The numerator is a count of `cell_meetings` rows, and
 * `attendance` owns that table — while `attendance` already imports `CellsModule`, so a
 * dependency the other way is a cycle. Section 2 reserves an inversion port for exactly
 * that case: the consuming module declares the interface, the owning module implements
 * it, and a binding module joins the two.
 *
 * **Why `GET /api/v1/cells` is the consumer rather than a route in `attendance`.** The
 * question was live, because `CellMeetingsController` sits in `attendance` under this
 * same URL prefix and its docblock gives the rule: a controller's URL says where the
 * resource sits in the API, and putting those meeting routes on `CellsController` "would
 * put section 13's rules in the module that owns none of their tables". Read the other
 * way, that argument places the index here. Which Cells the index lists, whose leader
 * each has, its category, its schedule and its coverage denominator are all decided by
 * tables `cells` owns; one figure per row is not. Hosting the route in `attendance` to
 * avoid this port would put Sections 10 and 19's listing rules in the module that owns
 * none of *their* tables — the same failure the sentence names, in the other direction.
 *
 * *Section 2 warns in the same breath that "a port declared where a plain import would do
 * adds an indirection, a binding module and a fail-closed branch for nothing", and that is
 * the cost being paid here knowingly. It buys the listing staying in the module whose
 * tables decide it. The alternative was not free either; it was cheap in a different
 * currency.*
 *
 * **Batched by design, and the batching is the point rather than an optimisation.** A
 * page of the index is up to 200 Cells (Section 22), and a per-Cell call would be 200
 * round trips for 200 integers. The signature therefore takes the page's Cells and
 * answers for all of them at once, so the shape cannot decay into a loop.
 *
 * **Absent, the index is refused**, on the precedent `CELL_SCOPE_PORT` and
 * `CELL_RELATIONSHIPS_PORT` both set: a wiring fault costs one operation rather than the
 * whole application, and the operation refuses rather than skipping what the port was
 * answering. Skipping here would publish a coverage line whose numerator is silently
 * zero — every Cell in the church reading `0 of 5 meetings recorded`, which is the
 * accusation Section 13 exists to prevent, manufactured by a missing provider.
 */
export const RECORDED_MEETINGS_PORT = Symbol('RECORDED_MEETINGS_PORT');

export interface RecordedMeetingsPort {
  /**
   * For each Cell named, how many of its meetings in this reporting month carry a
   * record (SKILL.md section 12).
   *
   * **Every status counts, and that is Section 13 rather than a simplification.** A
   * `NOT_HELD` meeting is recorded: the leader filed it, and Section 13 makes reporting
   * honestly that a Cell could not meet the whole point of that status existing. What is
   * *not* recorded is a meeting with no row at all — Section 13's "outstanding task,
   * shown to the responsible leader as a meeting awaiting a record", which is an absence
   * of data rather than a fact. So this counts rows, and `GET /api/v1/cells/{id}/meetings`
   * derives the identical figure by counting the entries of its own join whose `meeting`
   * is not null. Two readings of one definition, in one module, and they must stay equal.
   *
   * **A Cell with no meetings recorded is absent from the map rather than absent from
   * the figure.** The caller reads a missing key as zero, because a Cell that recorded
   * nothing is exactly the case Section 12's coverage line exists to make visible — and
   * a shape that omitted it would tempt a caller into omitting the row.
   *
   * The month is a `YYYY-MM-01` Manila reporting month, already normalised by the
   * caller. Implementations do not re-derive it: Section 13 fixes `reporting_month` on
   * the row at creation, so this is an equality rather than a range.
   */
  recordedCountsIn(
    cellIds: readonly string[],
    reportingMonth: string,
  ): Promise<Map<string, number>>;
}
