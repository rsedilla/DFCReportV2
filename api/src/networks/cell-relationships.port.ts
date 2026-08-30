import type { Db } from '../database/database.module';
import type { Database } from '../database/schema';
import type { Transaction } from 'kysely';

/**
 * The Cell relationships a person holds, for the one purpose of deciding whether a
 * Network change may proceed (SKILL.md section 4).
 *
 * Section 4 refuses a Network change while the person leads a Cell, and refuses it
 * while they hold a Cell membership. Both are facts about tables `cells` owns, and
 * both are preconditions on the state the request arrives in — which no constraint
 * observes, so they are checked here.
 *
 * **A port rather than a direct call, and the reason is section 2.** `cells` owns
 * `cell_leaderships` and `cell_memberships`, so the answer can only come from that
 * module — and `cells` already imports `NetworksModule` to compare Networks, so a
 * dependency the other way would be a cycle. The interface is declared here, where
 * `networks` needs it; `cells` implements it; `CellRelationshipsBindingModule` binds
 * the two. That is the inversion `CELL_SCOPE_PORT` and `EMAIL_PORT` already use.
 *
 * *Not `AppModule`, which is where this sentence said and where the binding was first
 * put.* Nest resolves a provider's dependencies in the module that registers it, and
 * `NetworksService` is registered in `NetworksModule`, so a provider in `AppModule`'s
 * own list never reaches it. The sentence was inherited verbatim from
 * `cell-scope.port.ts`, where it is true because the guard is registered globally.
 *
 * **Absent, the Network change is refused**, on the precedent `CELL_SCOPE_PORT` sets
 * for the same situation: "a missing binding closes every Cell-scoped endpoint rather
 * than opening one". The fail-open reading would let a wiring fault silently disable a
 * rule section 4 states absolutely.
 *
 * **Optional is a choice rather than a necessity, and it is recorded as open.** An
 * earlier version of this said only `AppModule` could bind an implementation, so the
 * injection had to be optional. That is false, though the true statement is narrower
 * than the correction first made: a `@Global()` module publishes its exports to every
 * module *of a graph that includes it*, not to every context anywhere. A mandatory
 * injection works today because the one test graph that omits the binding
 * (`cycle-safety.spec.ts`) constructs no `NetworksService` — which is "no such graph
 * exists yet" rather than "the token is always there".
 *
 * Mandatory would move a wiring fault to startup, where `test/unit/module-graph.spec.ts`
 * already catches that class in seconds without a database; optional buys a live
 * deployment losing one operation rather than failing to boot. Both are defensible;
 * `CLAUDE.md` carries the question, and it should be settled from this paragraph rather
 * than from the first one.
 *
 * Every method takes the caller's executor. The checks run inside the transaction
 * that performs the change, so a pooled read would both answer from the state the
 * request arrived with and ask a bounded pool for a second connection (section 24) —
 * the same reason `HierarchyService.openDisciplesOf` beside it takes one.
 */
export const CELL_RELATIONSHIPS_PORT = Symbol('CELL_RELATIONSHIPS_PORT');

/** A Cell named in a refusal: the UUID, and the handle a person recognises. */
export interface NamedCell {
  id: string;
  /** `CELL-000000` (SKILL.md section 10). */
  cellId: string;
}

export interface CellRelationshipsPort {
  /**
   * Every Cell this person currently leads — every open leadership row, whatever
   * state its Cell is in.
   *
   * Section 11 makes a current Cell leadership an open row on an `ACTIVE` Cell, and
   * a `CLOSED` Cell holds no open leadership at all — so a closed Cell never blocks
   * a correction, which falls out of the schema rather than being filtered for. The
   * implementation asks only whether an open row exists, and blocks on one whatever
   * state its Cell is in, which is the safe answer in the restore state where the
   * schema's guarantee is the thing that has failed.
   *
   * A person may lead many (section 10), so this returns a list and the refusal
   * names all of them: an administrator told about one Cell, who resolves it and is
   * then refused for a second, learns the shape of the obligation one Cell at a time.
   */
  openLeadershipsOf(executor: Db | Transaction<Database>, personId: string): Promise<NamedCell[]>;

  /**
   * The Cell this person is currently a member of, or null.
   *
   * Section 10 gives a person at most one active membership, so this is not a list.
   * It is a separate question from leadership rather than a special case of it:
   * membership does not mirror pastoral assignment, so a member need not lead
   * anything and need not sit under the Cell's leader.
   */
  openMembershipOf(
    executor: Db | Transaction<Database>,
    personId: string,
  ): Promise<NamedCell | null>;
}
