import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import { AuthorizationService, type Actor } from '../auth/authorization/authorization.service';
import { Capability } from '../auth/authorization/capabilities';
import { HierarchyService } from '../hierarchy/hierarchy.service';
import { NetworksService } from '../networks/networks.service';
import { DATABASE, type Db } from '../database/database.module';

import { normalizeName } from './duplicate-matching';
import {
  ACCENTED,
  UNACCENTED,
  composeName,
  escapeLike,
  type PersonRecord,
  type SearchCursor,
} from './people.shared';

/**
 * What another module may learn about a Person in order to decide about them.
 *
 * Deliberately not `PersonRecord`: section 8 protects a birthday and a mobile
 * number, and a cross-module reader has no business receiving them. This carries
 * the identity needed to address somebody and the two lifecycle facts that decide
 * whether they may acquire a new relationship.
 */
export interface PersonForDecision {
  id: string;
  /**
   * The Member ID (section 3), which section 8 publishes church-wide.
   *
   * Here because two collections break a name tie with it and one of them assembles
   * its list in application code — so it needs the field beside the name rather than
   * from a second read on a second connection.
   */
  memberId: string;
  /** Composed here, because `people` owns name shape (section 3). */
  fullName: string;
  /**
   * The given name on its own, for addressing somebody rather than identifying
   * them — a greeting, or the salutation of an email.
   *
   * It is supplied here for the same reason `fullName` is composed here: section
   * 3 gives `people` the name shape, so a caller that needs a part of a name asks
   * for that part rather than splitting the whole one.
   *
   * **It is whatever was encoded, and nothing validates it.** Section 3 directs a
   * generational suffix into `last_name`, but that is a convention rather than an
   * invariant: `CreatePersonDto` accepts any string of 1 to 100 characters, the
   * tree import takes a spreadsheet column verbatim, and `duplicate-matching.ts`
   * reads a suffix out of the *first* name precisely because it can be there. A
   * caller rendering this is rendering what somebody typed.
   */
  firstName: string;
  /**
   * The family name on its own, for **ordering** rather than for addressing.
   *
   * Section 8 orders the church-wide directory by `(last_name, first_name, id)`, and
   * two collections page by `(last_name, first_name, member_id)` — so a caller
   * assembling a list in application code needs this half of the name as a field
   * rather than by splitting `fullName`, which is not splittable: a middle name sits
   * between them and a generational suffix lives inside this one (section 3).
   */
  lastName: string;
  mergedIntoId: string | null;
  isArchived: boolean;
}

/**
 * Reading a Person, and the church-wide directory search (SKILL.md sections 3 and
 * 8).
 *
 * Separate from the write paths because it shares nothing with them: no
 * transaction, no person lock, no idempotency claim, no audit entry. Section 8's
 * redaction is the whole of the authorization work here, and keeping it away from
 * the eleven-step write skeleton is what makes either readable.
 *
 * It is also where other modules ask about a Person, since this one owns `persons`
 * and `person_lifecycle` (section 2) — see `forDecisionWithin`.
 */
@Injectable()
export class PeopleReadService {
  constructor(
    @Inject(DATABASE) private readonly db: Db,
    private readonly hierarchy: HierarchyService,
    private readonly networks: NetworksService,
    private readonly authorization: AuthorizationService,
  ) {}

  /**
   * The interface another module uses to decide something about a Person.
   *
   * **`persons` and `person_lifecycle` belong to this module** (section 2), so a
   * module that needs to know whether somebody may be given an account, or what to
   * call them in an email, asks here rather than joining the tables. `auth` did
   * join them, in three places, until the authorization seam moved into its own
   * module and made this import possible without a cycle.
   *
   * It takes an executor **so that a caller deciding inside a transaction reads
   * that transaction's state**, rather than the state the request arrived with.
   * That is what provisioning needs, and it is the reason the parameter is
   * required rather than optional: a caller inside a transaction that forgot to
   * pass one would read from the pool and decide on stale rows, which is
   * invisible at the call site.
   *
   * A caller that is *not* deciding inside a transaction has nothing to hand it
   * and should use `forDecision` below, which supplies this module's own pool.
   * Requiring an executor from those callers achieved nothing except to make
   * another module take a database handle in order to give one back.
   */
  async forDecisionWithin(executor: Db, personId: string): Promise<PersonForDecision | null> {
    const person = await executor
      .selectFrom('persons')
      .leftJoin('person_lifecycle', (join) =>
        join
          .onRef('person_lifecycle.person_id', '=', 'persons.id')
          .on('person_lifecycle.ended_at', 'is', null),
      )
      .select([
        'persons.id as id',
        'persons.member_id as member_id',
        'persons.first_name as first_name',
        'persons.middle_name as middle_name',
        'persons.last_name as last_name',
        'persons.merged_into_id as merged_into_id',
        'person_lifecycle.state as state',
      ])
      .where('persons.id', '=', personId)
      .executeTakeFirst();

    if (!person) {
      return null;
    }

    return {
      id: person.id,
      memberId: person.member_id,
      fullName: composeName(person),
      firstName: person.first_name,
      lastName: person.last_name,
      mergedIntoId: person.merged_into_id,
      isArchived: person.state === 'ARCHIVED',
    };
  }

  /**
   * The same read for many people at once, as a map missing anyone with no row.
   *
   * An attendance roster decides per person whether they may be recorded — an
   * archived Person may not be, and a merged one is a record that has been
   * absorbed — and a DCC submission carries the whole checklist (section 14). The
   * per-person form would issue one query per name, twice: once to build the list
   * and once to write it.
   *
   * It composes the same `PersonForDecision` rather than a narrower shape, so a
   * caller deciding about one person and a caller deciding about fifty are reading
   * the same fields through the same lens.
   */
  async forDecisionsWithin(
    executor: Db,
    personIds: readonly string[],
  ): Promise<Map<string, PersonForDecision>> {
    if (personIds.length === 0) {
      return new Map();
    }

    const rows = await executor
      .selectFrom('persons')
      .leftJoin('person_lifecycle', (join) =>
        join
          .onRef('person_lifecycle.person_id', '=', 'persons.id')
          .on('person_lifecycle.ended_at', 'is', null),
      )
      .select([
        'persons.id as id',
        'persons.member_id as member_id',
        'persons.first_name as first_name',
        'persons.middle_name as middle_name',
        'persons.last_name as last_name',
        'persons.merged_into_id as merged_into_id',
        'person_lifecycle.state as state',
      ])
      .where('persons.id', 'in', [...personIds])
      .execute();

    return new Map(
      rows.map((row) => [
        row.id,
        {
          id: row.id,
          memberId: row.member_id,
          fullName: composeName(row),
          firstName: row.first_name,
          lastName: row.last_name,
          mergedIntoId: row.merged_into_id,
          isArchived: row.state === 'ARCHIVED',
        },
      ]),
    );
  }

  /**
   * The same read, for a caller that is not inside a transaction.
   *
   * It exists so that such a caller does not have to hold a database handle
   * purely to hand this module the pool it already has.
   */
  async forDecision(personId: string): Promise<PersonForDecision | null> {
    return this.forDecisionWithin(this.db, personId);
  }

  /**
   * A Person by id, or null.
   *
   * Field-level redaction is the caller's job, not this one: section 8 decides
   * what a viewer may see from their pastoral scope, and the service does not know
   * who is asking.
   */
  async findById(personId: string): Promise<PersonRecord | null> {
    const row = await this.db
      .selectFrom('persons')
      .select([
        'id',
        'member_id',
        'first_name',
        'middle_name',
        'last_name',
        'birth_date',
        'sex',
        'civil_status',
        'mobile_number',
      ])
      .where('id', '=', personId)
      // Consistent with the other read paths. A Person absorbed by a merge is not
      // a valid target of any later write; the survivor carries the identity
      // (section 3, Person Merge). Merge is Stage 3, so this filters nothing
      // today -- which is exactly when the inconsistency is cheap to remove.
      .where('merged_into_id', 'is', null)
      .executeTakeFirst();

    return row ?? null;
  }

  /**
   * Identifying names for a set of Persons, keyed by id.
   *
   * Exists so that a module holding a list of person identifiers does not read
   * `persons` to put names on them (section 2). `hierarchy` walks the pastoral
   * path and returns identifiers; this turns them into the two fields section 8
   * permits church-wide.
   *
   * **A Person absorbed by a merge is deliberately not filtered out, where the
   * other reads in this file filter one.** The difference is what an absence
   * would mean. On a lookup a filtered row is simply not found; on a path it is a
   * hole, and a path with a hole reads as a shorter chain rather than as an
   * error. Section 3 also says a merge never rewrites pastoral records to point
   * at a different Person, so an absorbed ancestor genuinely stays on the chain
   * and the real question is whether to render them or the survivor. That is
   * Person Merge's to answer, for every surface at once, and merge is Stage 3 --
   * so nothing today can reach it, and it is recorded as open rather than decided
   * here.
   */
  async namesOf(
    personIds: readonly string[],
  ): Promise<Map<string, { memberId: string; fullName: string }>> {
    if (personIds.length === 0) {
      return new Map();
    }

    const rows = await this.db
      .selectFrom('persons')
      .select(['id', 'member_id', 'first_name', 'middle_name', 'last_name'])
      .where('id', 'in', [...personIds])
      .execute();

    return new Map(
      rows.map((row) => [row.id, { memberId: row.member_id, fullName: composeName(row) }]),
    );
  }

  /**
   * Church-wide search by name (section 8), cursor-paginated (section 22).
   *
   * Keyset rather than offset, because rows inserted while a client is paging
   * shift every subsequent offset and the directory grows during a Sunday service
   * — which duplicates and skips records, and is worse for mobile sync. The key
   * is `(last_name, first_name, id)`, and `id` is there to make it total: two
   * people legitimately share a name, and a key that is not unique loses rows at
   * the page boundary.
   */
  async searchByName(
    term: string,
    limit: number,
    cursor: SearchCursor | null = null,
  ): Promise<{ rows: PersonRecord[]; nextCursor: SearchCursor | null }> {
    // Both sides normalized. Normalizing only the term meant `Nuñez` was searched
    // for as `nunez` against a raw stored `Nuñez` and never found -- and section 8
    // makes this search the mechanism section 3's duplicate prevention depends on,
    // so a miss here creates the duplicate.
    //
    // `%` and `_` are escaped: unescaped, `q=%%` pages out the whole directory.
    const normalized = normalizeName(term);

    // `normalizeName` drops suffix tokens and collapses separators, so a term
    // that looked like two characters can arrive here empty: `Jr`, `II`, `--`,
    // two spaces. An empty term builds the pattern `%%`, which matches every row
    // -- the directory dump `escapeLike` was added to prevent, reached by a
    // shorter route. Section 8 makes this search church-wide for identity
    // resolution, not for bulk export.
    if (normalized === '') {
      return { rows: [], nextCursor: null };
    }

    const pattern = `%${escapeLike(normalized).replace(/\s+/g, '%')}%`;
    const normalizedFirst = sql<string>`lower(translate(first_name, ${ACCENTED}, ${UNACCENTED}))`;
    const normalizedLast = sql<string>`lower(translate(last_name, ${ACCENTED}, ${UNACCENTED}))`;

    let query = this.db
      .selectFrom('persons')
      .select([
        'id',
        'member_id',
        'first_name',
        'middle_name',
        'last_name',
        'birth_date',
        'sex',
        'civil_status',
        'mobile_number',
      ])
      // A merged-away Person is not a search result: the survivor carries the
      // identity (section 3, Person Merge).
      .where('merged_into_id', 'is', null)
      .where((eb) =>
        eb.or([
          eb(normalizedFirst, 'like', pattern),
          eb(normalizedLast, 'like', pattern),
          eb(
            sql<string>`lower(translate(first_name || ' ' || last_name, ${ACCENTED}, ${UNACCENTED}))`,
            'like',
            pattern,
          ),
        ]),
      )
      .orderBy('last_name')
      .orderBy('first_name')
      .orderBy('id')
      // One more than asked for, which is how the last page is recognised without
      // a count -- section 22 does not return totals.
      .limit(limit + 1);

    if (cursor !== null) {
      query = query.where((eb) =>
        eb.or([
          eb('last_name', '>', cursor.lastName),
          eb.and([eb('last_name', '=', cursor.lastName), eb('first_name', '>', cursor.firstName)]),
          eb.and([
            eb('last_name', '=', cursor.lastName),
            eb('first_name', '=', cursor.firstName),
            eb('id', '>', cursor.id),
          ]),
        ]),
      );
    }

    const found = await query.execute();
    const rows = found.slice(0, limit);
    const last = rows[rows.length - 1];

    return {
      rows,
      nextCursor:
        found.length > limit && last !== undefined
          ? { lastName: last.last_name, firstName: last.first_name, id: last.id }
          : null,
    };
  }

  /**
   * Whether the actor may see this person's full profile (SKILL.md section 8).
   *
   * Asked of the authorization service rather than reimplemented, so that a Senior
   * Pastor's Whole Church scope and an Admin-issued wider grant reach the same
   * answer here as they do in the guard.
   *
   * **Pool-only, and it says so rather than taking an executor.** `covers` reads
   * the account's grants before it evaluates any scope, so handing it a
   * transaction would not honour one — and a signature that accepted one would
   * promise otherwise. A caller that genuinely needs this decision inside a
   * transaction reads the authority first and calls `coversWith`, which is what
   * the reassignment path does.
   *
   * Here rather than in the controller because it is authorization over church
   * data, which section 22 keeps in a service.
   */
  async isWithinViewScope(actor: Actor, personId: string): Promise<boolean> {
    return this.authorization.covers(actor, Capability.PeopleViewSubtree, {
      kind: 'person',
      personId,
    });
  }

  /**
   * The five fields section 8 permits for a person outside the viewer's pastoral
   * scope — Member ID, full name, sex, current Network and the name of their
   * current direct leader — plus two that are not about them.
   *
   * `id` is the handle the duplicate-acknowledgement flow needs to name a candidate
   * back to the server, and `scope` tells a client it is looking at a withheld
   * profile rather than an empty one. Section 8's list is about a person's
   * *details*, and neither of these is one; they are named here rather than left
   * for a reader to notice the count does not match.
   *
   * Written as a list of what is *included* rather than as a list of what is
   * removed. A redaction that deletes named fields lets the next field added to
   * the profile through by default, which is the wrong direction for a rule about
   * what the church may see.
   */
  async minimalIdentity(person: PersonRecord): Promise<Record<string, unknown>> {
    const [network, leader] = await Promise.all([
      this.networks.currentNetwork(this.db, person.id),
      this.hierarchy.directLeaderNameOf(person.id),
    ]);

    return {
      id: person.id,
      member_id: person.member_id,
      full_name: composeName(person),
      sex: person.sex,
      network,
      direct_leader_name: leader,
      // Named, so a client can tell a withheld profile from an empty one and say
      // so, rather than rendering a person who looks like they have no details.
      scope: 'IDENTITY_ONLY',
    };
  }

  /**
   * People whose own pastoral leader holds no open pastoral assignment
   * (SKILL.md sections 5, 19 and 20; decision 0232).
   *
   * **The condition, never the lifecycle flag.** Section 20 requires this list and
   * named its subject "a person whose pastoral leader is **archived**"; what it
   * exists to counteract is the reconstruction one paragraph above, which continues
   * a chain past a leader holding no assignment *within the period* — and section 5
   * gives three legitimate causes of holding none. Keyed on the flag this would
   * surface one cause and miss two while the reconstruction hid all three. The two
   * also come apart in both directions: an archived Person keeps an open row until
   * it is closed, and an unarchived one may hold none.
   *
   * **The one exclusion is section 5's own remedy, one relationship over.** A leader
   * holding an `ADMIN` account is outside the pastoral structure deliberately and
   * permanently, so their disciples are not waiting for a repair. Section 5 states
   * that remedy for the neighbouring list — Persons holding no assignment of their
   * own — and it is the same argument here. It prejudges nothing about whether such
   * a Person may hold disciples at all, which is open.
   *
   * **Undated, and it names no period.** Somebody reassigned last week needs no
   * action today, so this asks about now: section 7's first clause, the same one
   * decision 0204 applied to the Cell roster. It is deliberately not the dated
   * reading decision 0231 gives a collection that *does* name one.
   *
   * **Ordered by name and never by how long a gap has stood** (sections 13, 15, 17).
   * A list ordered by staleness is a ranking of neglect whatever it is called, which
   * is why the ordering is decided here rather than left to a caller's `sort`.
   *
   * A root's row carries a null `leader_id` and is not a gap — nobody is missing
   * above a root (section 5, Network roots) — so those rows are excluded by the
   * join rather than by a filter.
   */
  async awaitingReassignment(
    scope: { kind: 'WHOLE_CHURCH' } | { kind: 'PERSONS'; personIds: ReadonlySet<string> },
    limit: number,
    cursor: SearchCursor | null = null,
  ): Promise<{
    rows: {
      id: string;
      member_id: string;
      first_name: string;
      middle_name: string | null;
      last_name: string;
      leader_id: string;
      leader_member_id: string;
      leader_first_name: string;
      leader_middle_name: string | null;
      leader_last_name: string;
    }[];
    nextCursor: SearchCursor | null;
  }> {
    // An empty scope selects nobody. Expressed here rather than as an `IN ()`,
    // which PostgreSQL rejects, and it is the honest answer for an actor whose
    // grant reaches nobody.
    if (scope.kind === 'PERSONS' && scope.personIds.size === 0) {
      return { rows: [], nextCursor: null };
    }

    let query = this.db
      .selectFrom('pastoral_assignments as edge')
      .innerJoin('persons as person', 'person.id', 'edge.person_id')
      .innerJoin('persons as leader', 'leader.id', 'edge.leader_id')
      .select([
        'person.id as id',
        'person.member_id as member_id',
        'person.first_name as first_name',
        'person.middle_name as middle_name',
        'person.last_name as last_name',
        'leader.id as leader_id',
        'leader.member_id as leader_member_id',
        'leader.first_name as leader_first_name',
        'leader.middle_name as leader_middle_name',
        'leader.last_name as leader_last_name',
      ])
      .where('edge.ended_at', 'is', null)
      // A merged-away Person is not listed: the survivor carries the identity
      // (section 3, Person Merge).
      //
      // **The same is deliberately not asked of the leader.** A filter there was
      // written and withdrawn: section 3 never rewrites a pastoral edge, so a
      // disciple whose leader was absorbed still has no reachable leader and is
      // exactly the gap this list exists to surface — dropping their row would hide
      // it. Whether `former_leader` should then name the absorbed record or the
      // survivor is Person Merge's to answer for every surface at once, which
      // `CLAUDE.md` records, and is not this endpoint's to decide. Unreachable
      // today: nothing writes `merged_into_id`.
      .where('person.merged_into_id', 'is', null)
      // **An archived Person is not listed, because section 5 refuses to reassign
      // one.** Section 19 asks each entry to carry the action that resolves it, and
      // decision 0229 states the consequence for the sibling list: an entry no act
      // resolves is what an attention list must never carry. Listing one would send a
      // reader to a screen that refuses them.
      //
      // Unreachable today — no route holds `people.manage_lifecycle`, so nothing
      // writes `ARCHIVED` — and written now because the day archival ships is the
      // same day this list's headline case becomes real.
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom('person_lifecycle as life')
              .select(sql`1`.as('one'))
              .whereRef('life.person_id', '=', 'person.id')
              .where('life.ended_at', 'is', null)
              .where('life.state', '=', 'ARCHIVED'),
          ),
        ),
      )
      // The condition itself: the leader holds no open assignment of their own.
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom('pastoral_assignments as up')
              .select(sql`1`.as('one'))
              .whereRef('up.person_id', '=', 'edge.leader_id')
              .where('up.ended_at', 'is', null),
          ),
        ),
      )
      // Section 5's remedy, applied one relationship over: an administrator outside
      // the pastoral structure is in the correct and permanent state, so their
      // disciples are not waiting for a reassignment.
      //
      // **A live `ADMIN` role is a proxy for that state and not the state itself**,
      // which is stated rather than assumed. Nothing forbids a leader inside the tree
      // from also holding `ADMIN`, and if such a leader's own assignment ends, this
      // exclusion takes their whole disciple set off the list. Section 5 states the
      // remedy for the neighbouring list, where the Person and the state coincide;
      // here they need not, and `CLAUDE.md` carries that as open.
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom('accounts as account')
              .innerJoin('account_roles as role', 'role.account_id', 'account.id')
              .select(sql`1`.as('one'))
              .whereRef('account.person_id', '=', 'edge.leader_id')
              .where('role.role', '=', 'ADMIN')
              .where('role.revoked_at', 'is', null),
          ),
        ),
      )
      .orderBy('person.last_name')
      .orderBy('person.first_name')
      .orderBy('person.id')
      // One more than asked for, so the last page is recognised without a count
      // (section 22 returns no totals).
      .limit(limit + 1);

    if (scope.kind === 'PERSONS') {
      query = query.where('person.id', 'in', [...scope.personIds]);
    }

    if (cursor !== null) {
      query = query.where((eb) =>
        eb.or([
          eb('person.last_name', '>', cursor.lastName),
          eb.and([
            eb('person.last_name', '=', cursor.lastName),
            eb('person.first_name', '>', cursor.firstName),
          ]),
          eb.and([
            eb('person.last_name', '=', cursor.lastName),
            eb('person.first_name', '=', cursor.firstName),
            eb('person.id', '>', cursor.id),
          ]),
        ]),
      );
    }

    const found = await query.execute();
    const rows = found.slice(0, limit);
    const last = rows[rows.length - 1];

    return {
      rows,
      nextCursor:
        found.length > limit && last !== undefined
          ? { lastName: last.last_name, firstName: last.first_name, id: last.id }
          : null,
    };
  }
}
