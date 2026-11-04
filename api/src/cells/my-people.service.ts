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
  /**
   * The Cell they belong to, else one they lead, else null, with who leads it (decision 0437),
   * by first name too for the phone row; `led_by` is null only where the Cell has no current
   * leader. A client says "you" where it names the reader.
   */
  cell: {
    cell_id: string;
    category: string | null;
    day_of_week: number | null;
    led_by: { person_id: string; full_name: string; first_name: string } | null;
  } | null;
  /** True where the reader holds no `cell.view_subtree` over them, so `cell` says nothing. */
  cell_withheld: boolean;
}

/**
 * A leader's people as one plain list (SKILL.md section 19, decisions 0422 and 0437): every level
 * of their branch for an account without Full view, and two levels, the people they disciple
 * directly and the people those disciple, for a Full view account, whose Family Tree shows every
 * level beside it. The tree is read as it stands now.
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

  /**
   * Whether the list reaches every level (decision 0437): the account's screens decide, as the
   * server names them, so a client never works it out (decision 0323).
   */
  private async everyLevel(actor: Actor): Promise<boolean> {
    return (await this.authorization.rolesAndGrantsFor(actor.accountId)).screens !== 'FULL';
  }

  /**
   * The people listed, each mapped to who disciples them: the reader's direct disciples, and
   * beneath them everyone deeper, or only the next level for a Full view account.
   */
  private async levels(
    actor: Actor,
  ): Promise<{ direct: string[]; beneath: Map<string, string>; everyLevel: boolean }> {
    const me = canonicalId(actor.personId);
    const [edges, everyLevel] = await Promise.all([
      this.hierarchy.subtreeEdgesOf(actor.personId),
      this.everyLevel(actor),
    ]);
    const direct = edges
      .filter((edge) => canonicalId(edge.leaderId) === me)
      .map((edge) => canonicalId(edge.personId));
    const directSet = new Set(direct);
    const beneath = new Map(
      edges
        .filter((edge) => canonicalId(edge.personId) !== me)
        .filter((edge) => !directSet.has(canonicalId(edge.personId)))
        .filter((edge) => everyLevel || directSet.has(canonicalId(edge.leaderId)))
        .map((edge) => [canonicalId(edge.personId), canonicalId(edge.leaderId)] as const),
    );
    return { direct, beneath, everyLevel };
  }

  async counts(
    actor: Actor,
  ): Promise<{ all: number; direct: number; beneath: number; every_level: boolean }> {
    const { direct, beneath, everyLevel } = await this.levels(actor);
    return {
      all: direct.length + beneath.size,
      direct: direct.length,
      beneath: beneath.size,
      every_level: everyLevel,
    };
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
    const names = await this.people.namesOf([
      ...new Set([...leaderOf.keys(), ...beneath.values()]),
    ]);
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
        cell: cellOf(cells.get(id), { id, name: name.fullName }),
        cell_withheld: !cells.has(id),
      };
    });

    // Who leads each Cell, by first name too (decision 0437): most are already among the names
    // read above, and the rest are read in one query.
    const missing = rows.flatMap((row) => {
      const id = row.cell?.led_by?.person_id;
      return id === undefined || names.has(canonicalId(id)) ? [] : [canonicalId(id)];
    });
    const moreNames = await this.people.namesOf([...new Set(missing)]);
    for (const row of rows) {
      const ledBy = row.cell?.led_by;
      if (ledBy) {
        const id = canonicalId(ledBy.person_id);
        ledBy.first_name = (names.get(id) ?? moreNames.get(id))?.firstName ?? ledBy.full_name;
      }
    }
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
type MembershipEntry = CellEntry & { leader: { person_id: string; full_name: string } | null };

/**
 * The Cell a person belongs to, else the first they lead, else none, with its leader (decision
 * 0437): a member's Cell is led by its current leader, a Cell they lead by themselves.
 */
function cellOf(
  entry: Record<string, unknown> | undefined,
  person: { id: string; name: string },
): MyPeopleRow['cell'] {
  if (entry === undefined) {
    return null;
  }
  const membership = entry.membership as MembershipEntry | null;
  const leads = entry.leads as CellEntry[];
  const cell = membership ?? leads[0] ?? null;
  if (cell === null) {
    return null;
  }
  const leader =
    membership !== null ? membership.leader : { person_id: person.id, full_name: person.name };
  return {
    cell_id: cell.cell_id,
    category: cell.category,
    day_of_week: cell.day_of_week,
    // The first name is filled in by the caller, which holds the names.
    led_by:
      leader === null
        ? null
        : { person_id: leader.person_id, full_name: leader.full_name, first_name: '' },
  };
}
