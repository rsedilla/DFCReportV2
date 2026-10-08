/**
 * The current pastoral tree held in memory (SKILL.md section 24, decision 0321).
 *
 * Built from every open `pastoral_assignments` row, a root's included, with nobody filtered,
 * and answering the three questions the database walks in `HierarchyService` answer:
 * `subtreeOf`, `ancestorsOf` and, through it, `isWithinSubtree`. Each walk returns what the
 * database walk returns, in the same order, and reports a cycle exactly when that walk would.
 *
 * Pure: it holds no connection, and whether it may be used is `HierarchyService`'s decision.
 */
export class CurrentTree {
  private readonly leaderOf = new Map<string, string | null>();
  private readonly childrenOf = new Map<string, string[]>();

  constructor(
    /** The version this copy was read with, in the same snapshot as its edges. */
    readonly version: string,
    edges: readonly { person_id: string; leader_id: string | null }[],
  ) {
    for (const edge of edges) {
      const person = edge.person_id.toLowerCase();
      const leader = edge.leader_id === null ? null : edge.leader_id.toLowerCase();
      this.leaderOf.set(person, leader);
      if (leader !== null) {
        const children = this.childrenOf.get(leader);
        if (children === undefined) {
          this.childrenOf.set(leader, [person]);
        } else {
          children.push(person);
        }
      }
    }
  }

  /**
   * The person and everyone beneath them, by depth, the person first. `cycle` is true where
   * the walk comes back to somebody already on its path, which in a tree whose people hold
   * one open row each is only possible when the person is on a cycle.
   *
   * `maxDepth` stops the walk that many levels below the person (decision 0324); a cycle
   * beyond it is not reached and so not reported.
   */
  subtree(personId: string, maxDepth = Infinity): { people: string[]; cycle: boolean } {
    const seed = personId.toLowerCase();
    const people = [seed];
    const seen = new Set([seed]);
    let frontier = [seed];
    for (let depth = 0; frontier.length > 0 && depth < maxDepth; depth += 1) {
      const next: string[] = [];
      for (const leader of frontier) {
        for (const child of this.childrenOf.get(leader) ?? []) {
          if (seen.has(child)) {
            return { people, cycle: true };
          }
          seen.add(child);
          people.push(child);
          next.push(child);
        }
      }
      frontier = next;
    }
    return { people, cycle: false };
  }

  /** The person's leaders, nearest first; `cycle` where the walk up comes back on itself. */
  ancestors(personId: string): { leaders: string[]; cycle: boolean } {
    const leaders: string[] = [];
    const seen = new Set<string>();
    let current = personId.toLowerCase();
    for (;;) {
      if (!this.leaderOf.has(current)) {
        return { leaders, cycle: false };
      }
      if (seen.has(current)) {
        return { leaders, cycle: true };
      }
      seen.add(current);
      const leader = this.leaderOf.get(current) ?? null;
      if (leader === null) {
        return { leaders, cycle: false };
      }
      leaders.push(leader);
      current = leader;
    }
  }
}
