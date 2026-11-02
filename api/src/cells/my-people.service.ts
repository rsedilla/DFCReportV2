import { Injectable } from '@nestjs/common';

import { AuthorizationService, type Actor } from '../auth/authorization/authorization.service';
import { Capability } from '../auth/authorization/capabilities';
import { canonicalId } from '../common/identifiers';
import { compareRosterKeys, rosterStart, type RosterCursor } from '../common/roster-cursor';
import { HierarchyService } from '../hierarchy/hierarchy.service';
import { PeopleReadService } from '../people/people.read.service';
import { CellsMembershipService } from './cells.membership.service';

/** One row of a leader's people (decision 0422). */
export interface MyPeopleRow {
  person_id: string;
  full_name: string;
  /** Who disciples them; null where that is the reader. */
  leader: { person_id: string; full_name: string } | null;
  /** The Cell they belong to, else one they lead, else null. */
  cell: { cell_id: string; category: string | null; day_of_week: number | null } | null;
  /** True where the reader holds no `cell.view_subtree` over them, so `cell` says nothing. */
  cell_withheld: boolean;
}

/**
 * A leader's people two levels down, as one plain list (SKILL.md section 19, decision 0422):
 * the people they disciple directly and the people those disciple, as the tree stands now.
 *
 * In `cells` because each row carries the person's Cell, which this module owns, and `cells`
 * already reads people and the tree (section 2): the route composes services and roots no
 * query in another module's table.
 */
@Injectable()
export class MyPeopleService {
  constructor(
    private readonly hierarchy: HierarchyService,
    private readonly people: PeopleReadService,
    private readonly membership: CellsMembershipService,
    private readonly authorization: AuthorizationService,
  ) {}

  /** The two levels, each person mapped to who disciples them. */
  private async levels(actor: Actor): Promise<{ direct: string[]; beneath: Map<string, string> }> {
    const me = canonicalId(actor.personId);
    const edges = await this.hierarchy.subtreeEdgesOf(actor.personId);
    const direct = edges
      .filter((edge) => canonicalId(edge.leaderId) === me)
      .map((edge) => canonicalId(edge.personId));
    const directSet = new Set(direct);
    const beneath = new Map(
      edges
        .filter((edge) => directSet.has(canonicalId(edge.leaderId)))
        .map((edge) => [canonicalId(edge.personId), canonicalId(edge.leaderId)] as const),
    );
    return { direct, beneath };
  }

  async counts(actor: Actor): Promise<{ all: number; direct: number; beneath: number }> {
    const { direct, beneath } = await this.levels(actor);
    return { all: direct.length + beneath.size, direct: direct.length, beneath: beneath.size };
  }

  async page(
    actor: Actor,
    options: { cursor: RosterCursor | null; limit: number },
  ): Promise<{ rows: MyPeopleRow[]; nextCursor: RosterCursor | null }> {
    const { direct, beneath } = await this.levels(actor);
    const leaderOf = new Map<string, string | null>([
      ...direct.map((id) => [id, null] as const),
      ...beneath,
    ]);
    const names = await this.people.namesOf([...new Set([...leaderOf.keys(), ...direct])]);
    const people = [...leaderOf.keys()]
      .flatMap((id) => {
        const name = names.get(id);
        return name === undefined ? [] : [{ id, name }];
      })
      .sort((left, right) => compareRosterKeys(keyOf(left), keyOf(right)));

    const start = rosterStart(people, keyOf, options.cursor);
    const page = people.slice(start, start + options.limit);
    const more = start + options.limit < people.length;

    // Each Cell only where the reader may read it, as `GET /cells/people/membership` does.
    const scope = await this.authorization.scopeMembership(actor, Capability.CellViewSubtree);
    const readable = page
      .map((person) => person.id)
      .filter((id) => scope.kind === 'WHOLE_CHURCH' || scope.personIds.has(id));
    const cells = new Map(
      (await this.membership.currentCellsOfMany(readable)).map((entry) => [
        canonicalId(entry.person_id as string),
        entry,
      ]),
    );

    const rows = page.map(({ id, name }): MyPeopleRow => {
      const leaderId = leaderOf.get(id) ?? null;
      const leaderName = leaderId === null ? undefined : names.get(leaderId);
      return {
        person_id: id,
        full_name: name.fullName,
        leader:
          leaderId === null ? null : { person_id: leaderId, full_name: leaderName?.fullName ?? '' },
        cell: cellOf(cells.get(id)),
        cell_withheld: !cells.has(id),
      };
    });
    const last = page[page.length - 1];

    return { rows, nextCursor: more && last !== undefined ? keyOf(last) : null };
  }
}

function keyOf(person: {
  name: { firstName: string; lastName: string; memberId: string };
}): RosterCursor {
  return {
    firstName: person.name.firstName,
    lastName: person.name.lastName,
    memberId: person.name.memberId,
  };
}

type CellEntry = { cell_id: string; category: string | null; day_of_week: number | null };

/** The Cell a person belongs to, else the first they lead, else none. */
function cellOf(entry: Record<string, unknown> | undefined): MyPeopleRow['cell'] {
  if (entry === undefined) {
    return null;
  }
  const membership = entry.membership as CellEntry | null;
  const leads = entry.leads as CellEntry[];
  const cell = membership ?? leads[0] ?? null;
  return cell === null
    ? null
    : { cell_id: cell.cell_id, category: cell.category, day_of_week: cell.day_of_week };
}
