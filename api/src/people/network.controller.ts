import { Controller, Get, Param, Query } from '@nestjs/common';

import { RequiresCapability } from '../auth/authorization/authorization.decorators';
import { Capability } from '../auth/authorization/capabilities';
import { CurrentActor } from '../auth/current-actor.decorator';
import { type Actor } from '../auth/authorization/authorization.service';
import { NotFoundError } from '../common/errors/api-error';
import { unresolvableCursor } from '../common/cursor';
import { isUuid } from '../common/identifiers';
import { HierarchyService } from '../hierarchy/hierarchy.service';

import { TreePagingQueryDto } from './dto/network.dto';
import { NetworkTreeService } from './network-tree.service';
import { PeopleReadService } from './people.read.service';

/** One node of the flat `descendants` view: who it is, and whether it opens. */
interface TreeNode {
  id: string;
  member_id: string;
  full_name: string;
  /** Whether this person currently leads anybody, so a client knows what expands. */
  leads_anyone: boolean;
}

/**
 * How a `descendants` node is assembled, and why it takes two reads rather than a join.
 *
 * `hierarchy` owns `pastoral_assignments` and `people` owns `persons`, so a tree of
 * names spans both. The edges come back as identifiers and `namesOf` resolves a whole
 * page of them in **one** statement, which is why these routes add nothing to
 * `module-boundaries.json`: no query here roots in a table its module does not own.
 */
async function nodesFor(
  read: PeopleReadService,
  hierarchy: HierarchyService,
  personIds: readonly string[],
): Promise<TreeNode[]> {
  if (personIds.length === 0) {
    return [];
  }

  const [names, leading] = await Promise.all([
    read.namesOf(personIds),
    hierarchy.whichLeadAnyone(personIds),
  ]);

  // In the order the caller handed them, which is the order the cursor is built on.
  return personIds.flatMap((personId) => {
    const named = names.get(personId);

    // Both ends of an edge are foreign keys into `persons`, so a missing name is a
    // defect in the data; dropped, because a page missing one node still navigates.
    return named === undefined
      ? []
      : [
          {
            id: personId,
            member_id: named.memberId,
            full_name: named.fullName,
            leads_anyone: leading.has(personId),
          },
        ];
  });
}

/**
 * `GET /api/v1/network/my-tree` (SKILL.md sections 17 and 22, decision 0252).
 *
 * **The actor's own place in the tree, and the one route here that needs no
 * identifier.** It answers the node the Network screen starts from and the first page of
 * the disciples beneath it, in the shape `children` answers for anybody else, because it
 * is the same collection.
 *
 * **The target is the actor**, because the route names nobody. `OWN_SUBTREE` covers it
 * since that scope includes the actor.
 *
 * Current state, with headcounts of the tree now (decision 0252). The figures that carry
 * a month are read under their own capabilities, on routes of their own.
 *
 * **`roots` is where a reader outside the tree starts** (decision 0268): the Network roots
 * their scope reaches, and empty for anybody holding an assignment.
 */
@Controller('network')
export class NetworkController {
  constructor(private readonly tree: NetworkTreeService) {}

  @Get('my-tree')
  @RequiresCapability(Capability.PeopleViewSubtree, { kind: 'actor' })
  async myTree(
    @CurrentActor() actor: Actor,
    @Query() query: TreePagingQueryDto,
  ): Promise<Record<string, unknown>> {
    const branch = await this.tree.branchOf(actor.personId, query);

    if (branch.person === null) {
      // An authenticated actor always has a Person (section 6), so this is a defect in
      // the data rather than a state a client can reach. `NOT_FOUND` rather than a bare
      // throw, which would render `INTERNAL_ERROR`.
      throw new NotFoundError('No such person.');
    }

    return { ...branch, roots: await this.tree.rootsReachedBy(actor) };
  }
}

/**
 * `GET /api/v1/leaders/{id}/children` and `/descendants` (section 22, decision 0252).
 *
 * **Direct leaders and descendants are different things and are never conflated**
 * (section 5), which is why these are two routes rather than one with a depth
 * parameter. The first answers the people somebody disciples, with the focus person and
 * the headcounts of the tree now; the second answers everyone beneath them, flat and
 * paged by depth.
 *
 * Both are guarded by `people.view_subtree` against the person in the path, resolving
 * through the pastoral tree in force now — the same capability and target kind as
 * `GET /people/{id}/pastoral-path`.
 *
 * **Existence is checked after the guard and never before it** (decision 0253). A
 * narrower grant is refused whether or not the identifier names anybody, so the pair of
 * answers cannot be used to learn who exists; only an actor whose scope would have
 * covered the person reaches `NOT_FOUND`, for whom absence is genuinely absence.
 */
@Controller('leaders')
export class LeadersController {
  constructor(
    private readonly hierarchy: HierarchyService,
    private readonly read: PeopleReadService,
    private readonly tree: NetworkTreeService,
  ) {}

  @Get(':id/children')
  @RequiresCapability(Capability.PeopleViewSubtree, { kind: 'person', from: 'params.id' })
  async children(
    @Param('id') id: string,
    @Query() query: TreePagingQueryDto,
  ): Promise<Record<string, unknown>> {
    await this.assertExists(id);

    return { ...(await this.tree.branchOf(id, query)) };
  }

  @Get(':id/descendants')
  @RequiresCapability(Capability.PeopleViewSubtree, { kind: 'person', from: 'params.id' })
  async descendants(
    @Param('id') id: string,
    @Query() query: TreePagingQueryDto,
  ): Promise<Record<string, unknown>> {
    await this.assertExists(id);

    const after = decodeDescendantsCursor(query.cursor);
    const limit = query.limit ?? 50;

    // **One row more than asked for, which is how the cursor is decided**, rather than a
    // second query counting what remains over a subtree that at a root is a Network.
    const rows = await this.hierarchy.descendantsPageOf(id, { after, limit: limit + 1 });
    const page = rows.slice(0, limit);
    const nodes = await nodesFor(
      this.read,
      this.hierarchy,
      page.map((row) => row.personId),
    );
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const last = page[page.length - 1];

    return {
      data: page.flatMap((row) => {
        const node = byId.get(row.personId);

        return node === undefined ? [] : [{ ...node, depth: row.depth }];
      }),
      next_cursor:
        rows.length > limit && last !== undefined
          ? encodeDescendantsCursor({ depth: last.depth, personId: last.personId })
          : null,
    };
  }

  /**
   * Asked after the guard, so that scope decides the answer and existence never does.
   *
   * The comment on `pastoral-path` states the same rule: the guard resolved scope
   * against this identifier and does not establish that the row is there.
   */
  private async assertExists(id: string): Promise<void> {
    if (!(await this.read.findById(id))) {
      throw new NotFoundError('No such person.');
    }
  }
}

interface DescendantsCursor {
  depth: number;
  personId: string;
}

/**
 * **Every decoded key is validated, not merely type-checked.** Both keys are bound into
 * the statement as casts — `::int` and `::uuid` — so a forged cursor carrying `1.5`,
 * `1e999` (which `JSON.parse` yields as `Infinity`) or a `personId` that is not a UUID
 * would reach PostgreSQL as `22P02`, which nothing classifies and which renders
 * `INTERNAL_ERROR`. Section 22 gives a cursor that is "unparseable, forged, **or
 * structurally wrong**" the same `VALIDATION_FAILED` answer.
 */
function decodeDescendantsCursor(value: string | undefined): DescendantsCursor | null {
  const parsed = decodeCursorPayload(value);

  if (parsed === null) {
    return null;
  }

  const depth: unknown = parsed.depth;
  const personId: unknown = parsed.personId;

  // **Bounded to what the column holds, and `Number.isInteger` does not do that.**
  // `depth` is bound as `::int`, so 2147483648 answers `22003` and 1e30 answers `22P02`
  // -- both integers by that predicate, neither an `int4`.
  if (
    typeof depth !== 'number' ||
    !Number.isInteger(depth) ||
    depth < 0 ||
    depth > INT4_MAX ||
    typeof personId !== 'string' ||
    !isUuid(personId)
  ) {
    throw unresolvableCursor();
  }

  return { depth, personId };
}

/** The largest value PostgreSQL's `int4` holds, which is what `depth` is bound as. */
const INT4_MAX = 2147483647;

function decodeCursorPayload(value: string | undefined): Record<string, unknown> | null {
  // An absent cursor starts at the first page. The empty string is refused by the DTO in
  // front of this -- `@Length(1, ...)` -- and treated as absent here anyway.
  if (value === undefined || value === '') {
    return null;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    throw unresolvableCursor();
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw unresolvableCursor();
  }

  return parsed as Record<string, unknown>;
}

function encodeDescendantsCursor(cursor: DescendantsCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}
