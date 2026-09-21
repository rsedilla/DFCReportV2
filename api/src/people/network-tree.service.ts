import { Inject, Injectable } from '@nestjs/common';

import { AuthorizationService, type Actor } from '../auth/authorization/authorization.service';
import { Capability } from '../auth/authorization/capabilities';
import { CapabilityDeniedError, ScopeDeniedError } from '../common/errors/api-error';
import { decodeRosterCursor, encodeRosterCursor, type RosterCursor } from '../common/roster-cursor';
import { DATABASE, type Db } from '../database/database.module';
import { HierarchyService } from '../hierarchy/hierarchy.service';

import { PeopleReadService } from './people.read.service';

/** Section 22: `limit` defaults to 50. The DTO bounds it at 200. */
const DEFAULT_PAGE = 50;

/** One node of the Network screen: who it is, and the headcounts of its branch now. */
export interface BranchNode {
  id: string;
  member_id: string;
  full_name: string;
  /** Whether this person currently leads anybody, so a client knows what opens. */
  leads_anyone: boolean;
  /** Their direct disciples now. */
  direct_reports: number;
  /** Everyone beneath them now, themselves excluded. */
  beneath: number;
}

/**
 * The Network screen's branch view (SKILL.md section 17, decision 0252).
 *
 * **One walk of the focus person's branch, folded bottom-up.** Every headcount the
 * screen shows — the focus person's and each row's — is a count over a part of that one
 * branch, so the edges are read once rather than once per row.
 *
 * **Rows are ordered by name** (decision 0252), section 8's directory order and the key
 * the rosters already page by. Names live in `persons`, which this module owns, so the
 * page is taken here over the direct disciples `hierarchy` hands back; a leader's direct
 * disciples are the one set this sorts, never the branch.
 *
 * Current state throughout, with no period: the figures that do carry a month are read
 * under their own capabilities on other routes (decision 0252).
 */
@Injectable()
export class NetworkTreeService {
  constructor(
    @Inject(DATABASE) private readonly db: Db,
    private readonly hierarchy: HierarchyService,
    private readonly read: PeopleReadService,
    private readonly authorization: AuthorizationService,
  ) {}

  /**
   * Where the screen starts for a reader outside the pastoral tree (decision 0268): the
   * Network roots their `people.view_subtree` reaches, by name. Empty for anybody holding
   * an assignment, a root included, who starts on their own branch as before.
   *
   * **Each root is asked of the same guard `GET /leaders/{id}/children` declares**, so the
   * list offers no root whose branch the reader would then be refused.
   */
  async rootsReachedBy(actor: Actor): Promise<BranchNode[]> {
    if ((await this.hierarchy.openAssignmentOf(this.db, actor.personId)) !== null) {
      return [];
    }

    const nodes: BranchNode[] = [];

    for (const rootId of await this.hierarchy.rootsAsOf(this.db, new Date())) {
      try {
        await this.authorization.authorize(actor, Capability.PeopleViewSubtree, {
          kind: 'person',
          personId: rootId,
        });
      } catch (error) {
        if (error instanceof ScopeDeniedError || error instanceof CapabilityDeniedError) {
          continue;
        }

        throw error;
      }

      const { person } = await this.branchOf(rootId, { limit: 1 });

      if (person !== null) {
        nodes.push(person);
      }
    }

    return nodes.sort((left, right) => left.full_name.localeCompare(right.full_name));
  }

  /** The focus person and one page of their direct disciples, by name. */
  async branchOf(
    personId: string,
    page: { limit?: number; cursor?: string },
  ): Promise<{ person: BranchNode | null; data: BranchNode[]; next_cursor: string | null }> {
    const edges = await this.hierarchy.subtreeEdgesOf(personId);
    const childrenOf = new Map<string, string[]>();

    for (const edge of edges) {
      const siblings = childrenOf.get(edge.leaderId);

      if (siblings === undefined) {
        childrenOf.set(edge.leaderId, [edge.personId]);
      } else {
        siblings.push(edge.personId);
      }
    }

    const beneath = countBeneath(personId, childrenOf);
    const direct = childrenOf.get(personId) ?? [];
    const identities = await this.read.forDecisionsWithin(this.db, [personId, ...direct]);

    const nodeOf = (id: string): BranchNode | null => {
      const identity = identities.get(id);

      // Both ends of an edge are foreign keys into `persons`, so a missing identity is a
      // defect in the data. Dropped rather than answered, as the pastoral path does with
      // a hole: a branch missing one row still navigates.
      return identity === undefined
        ? null
        : {
            id,
            member_id: identity.memberId,
            full_name: identity.fullName,
            leads_anyone: (childrenOf.get(id)?.length ?? 0) > 0,
            direct_reports: childrenOf.get(id)?.length ?? 0,
            beneath: beneath.get(id) ?? 0,
          };
    };

    const rows = direct
      .flatMap((id) => {
        const identity = identities.get(id);

        return identity === undefined ? [] : [{ id, key: keyOf(identity) }];
      })
      .sort((left, right) => compareKeys(left.key, right.key));

    const after = decodeRosterCursor(page.cursor);
    const limit = page.limit ?? DEFAULT_PAGE;

    // `-1` means the cursor is past every row, which is the last page rather than the
    // first, as the DCC gap list argues for the same arithmetic.
    const beyond = after === null ? 0 : rows.findIndex((row) => compareKeys(row.key, after) > 0);
    const start = beyond === -1 ? rows.length : beyond;
    const window = rows.slice(start, start + limit);
    const last = window[window.length - 1];

    return {
      person: nodeOf(personId),
      data: window.flatMap((row) => {
        const node = nodeOf(row.id);

        return node === null ? [] : [node];
      }),
      next_cursor:
        start + limit < rows.length && last !== undefined ? encodeRosterCursor(last.key) : null,
    };
  }
}

/**
 * How many people sit beneath each node of the branch, the node excluded.
 *
 * Iterative rather than recursive: a branch at a Network root is thousands deep in the
 * worst case the schema allows, and the walk above has already refused a cycle.
 */
export function countBeneath(
  rootId: string,
  childrenOf: ReadonlyMap<string, readonly string[]>,
): Map<string, number> {
  const order: string[] = [];
  const stack = [rootId];

  while (stack.length > 0) {
    const id = stack.pop() as string;
    order.push(id);
    stack.push(...(childrenOf.get(id) ?? []));
  }

  const counts = new Map<string, number>();

  for (const id of order.reverse()) {
    counts.set(
      id,
      (childrenOf.get(id) ?? []).reduce((sum, child) => sum + 1 + (counts.get(child) ?? 0), 0),
    );
  }

  return counts;
}

function keyOf(identity: { lastName: string; firstName: string; memberId: string }): RosterCursor {
  return {
    lastName: identity.lastName,
    firstName: identity.firstName,
    memberId: identity.memberId,
  };
}

/** The same comparison the DCC gap list pages by, so the sort and the cursor agree. */
function compareKeys(left: RosterCursor, right: RosterCursor): number {
  return (
    left.lastName.localeCompare(right.lastName) ||
    left.firstName.localeCompare(right.firstName) ||
    left.memberId.localeCompare(right.memberId)
  );
}
