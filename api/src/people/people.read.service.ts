import { Inject, Injectable, Optional } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';

import { AuthorizationService, type Actor } from '../auth/authorization/authorization.service';
import { Capability } from '../auth/authorization/capabilities';
import { HierarchyService } from '../hierarchy/hierarchy.service';
import { NetworksService } from '../networks/networks.service';
import { type RosterCursor } from '../common/roster-cursor';
import { ADMIN_ACCOUNTS_PORT, type AdminAccountsPort } from './admin-accounts.port';
import { DATABASE, type Db } from '../database/database.module';
import type { Database } from '../database/schema';

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
    // `auth` owns `accounts` and `account_roles`, and imports this module — so the read
    // is inverted through a port, which is what section 2 reserves one for (ruling of
    // 2026-09-11).
    //
    // **Optional, and the operation refuses when it is unbound**, which is what section 2
    // requires of an inversion port: a fail-open reading would turn a wiring fault into a
    // silent hole in section 5's administrator exclusion. `module-graph.spec.ts` asserts
    // the token resolves in a normally built application, because an optional injection
    // cannot fail at startup.
    @Optional()
    @Inject(ADMIN_ACCOUNTS_PORT)
    private readonly adminAccounts: AdminAccountsPort | null,
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
   * Search by name (section 8), cursor-paginated (section 22).
   *
   * Keyset rather than offset, because rows inserted while a client is paging
   * shift every subsequent offset and the directory grows during a Sunday service
   * — which duplicates and skips records, and is worse for mobile sync. The key
   * is `(last_name, first_name, id)`, and `id` is there to make it total: two
   * people legitimately share a name, and a key that is not unique loses rows at
   * the page boundary.
   *
   * **`restrictTo` narrows the rows, and it is applied in SQL rather than to the
   * page** (ruling of 2026-09-13, decision 0244). Filtering the returned page
   * instead would be shorter and wrong: `limit` would be spent on rows about to be
   * discarded, so a caller asking for fifty could receive three and a `next_cursor`
   * of null while matches remained — the truncation `CLAUDE.md` already records as
   * open against the duplicate-candidate lookup, reproduced here deliberately.
   *
   * `null` means no restriction, which is the church-wide search section 8 has
   * always defined. The caller decides; this method holds no opinion about which
   * surface deserves which.
   */
  async searchByName(
    term: string,
    limit: number,
    cursor: SearchCursor | null = null,
    restrictTo: ReadonlySet<string> | null = null,
  ): Promise<{ rows: PersonRecord[]; nextCursor: SearchCursor | null }> {
    // Both sides normalized. Normalizing only the term meant `Nuñez` was searched
    // for as `nunez` against a raw stored `Nuñez` and never found -- and a miss here
    // loses somebody from their own leader's list. *This said section 8 makes this
    // search the mechanism section 3's duplicate prevention depends on; since
    // decision 0244 that is `duplicate-candidates`, which this method is not.*
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

    // An empty restriction is not an absent one: `in ()` is malformed SQL, and
    // dropping the clause instead would hand the caller the church.
    //
    // **Unreachable today, and kept anyway.** `subtreeOf` seeds at the actor, so
    // `OWN_SUBTREE` always contains them; `SUBTREE_EXCL_SELF` cannot pass this
    // route's `{ kind: 'actor' }` guard at all; and a `NETWORK` grant covering the
    // actor enumerates at least the actor. So no caller can produce an empty set
    // through the route as it stands. It is a guard against the next scope kind
    // rather than a behaviour, and is described as one — an earlier version of this
    // comment stated it as something a leader experiences, which no leader can.
    if (restrictTo !== null && restrictTo.size === 0) {
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
      .$if(restrictTo !== null, (qb) => qb.where('id', 'in', [...(restrictTo ?? [])]))
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
   * A Person's display name on the caller's executor, or null where no row matches.
   *
   * **Exists so that `attendance` need not read `persons`** (SKILL.md section 2, ruling of
   * 2026-09-11). Its conflict bodies name whoever recorded the reading a client is being
   * shown, and looked the name up directly because the table was reachable.
   *
   * **It takes an executor**, because section 14 makes a conflict an ordinary outcome and
   * those paths hold a transaction: reaching the pool would ask a bounded one for a second
   * connection while holding one (section 24).
   *
   * **First and last only, which is what the callers render.** No middle name and no
   * Member ID: this answers "who is this" in a sentence, not an identity payload, and
   * {@link minimalIdentity} below is the one that decides what a Person discloses.
   */
  async displayNameWithin(
    executor: Db | Transaction<Database>,
    personId: string,
  ): Promise<string | null> {
    const person = await executor
      .selectFrom('persons')
      .select(['first_name', 'last_name'])
      .where('id', '=', personId)
      .executeTakeFirst();

    return person === undefined ? null : `${person.first_name} ${person.last_name}`;
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
    // **The port is checked before anything else reads or returns**, so a wiring fault
    // cannot hide behind an empty scope or a healthy tree. Both early returns below answer
    // without reaching the administrator exclusion, and a refusal placed after them would
    // surface on the day a leader departs rather than on the day of the deployment —
    // which is the counter-rule `cells.index.service.ts` states for the same shape.
    //
    // **Falsy rather than `=== null`, and the difference is what the branch is for.** Nest
    // injects `undefined` for an unresolved `@Optional()` token, so a check against `null`
    // alone is dead on the only fault that produces one — which is the defect this port
    // shipped with. It admits `null` as well because `useValue(undefined)` does not
    // override a real provider, so a test overriding the *token* can only inject `null`;
    // a test overriding the binding *module* reaches `undefined`, and
    // `admin-accounts-port-unbound.e2e.spec.ts` does both. Read into a local so the
    // narrowing holds across the awaits below.
    const adminAccounts = this.adminAccounts;

    if (!adminAccounts) {
      // Section 2: an inversion port refuses rather than skipping the check. Answering
      // without the administrator exclusion would put an administrator's whole disciple
      // set on an attention list nobody can act on, which is the silent hole the
      // fail-closed reading exists to prevent.
      throw new Error(
        'Cannot list the people awaiting reassignment: ADMIN_ACCOUNTS_PORT is not bound, ' +
          'so the SKILL.md section 5 administrator exclusion cannot be applied. This is a ' +
          'deployment fault.',
      );
    }

    // An empty scope selects nobody. Expressed here rather than as an `IN ()`,
    // which PostgreSQL rejects, and it is the honest answer for an actor whose
    // grant reaches nobody.
    if (scope.kind === 'PERSONS' && scope.personIds.size === 0) {
      return { rows: [], nextCursor: null };
    }

    // **Which edges are broken is `hierarchy`'s question**, and the administrator
    // exclusion is `auth`'s (SKILL.md section 2, ruling of 2026-09-11). Both were read
    // here as correlated sub-queries against tables this module does not own. They are now
    // asked of their owners and applied as sets, which is what lets this query root in
    // `persons` and join nothing across a module boundary.
    const edges = await this.hierarchy.brokenEdgesWithin(this.db);
    if (edges.length === 0) {
      return { rows: [], nextCursor: null };
    }

    // Section 5's remedy, applied one relationship over: an administrator outside the
    // pastoral structure is in the correct and permanent state, so their disciples are not
    // waiting for a reassignment.
    //
    // **A live `ADMIN` role is a proxy for that state and not the state itself**, which is
    // stated rather than assumed and is unchanged by moving the read. Nothing forbids a
    // leader inside the tree from also holding `ADMIN`, and if such a leader's own
    // assignment ends, this exclusion takes their whole disciple set off the list. Section
    // 5 states the remedy for the neighbouring list, where the Person and the state
    // coincide; here they need not, and `CLAUDE.md` carries that as open.
    const administrators = await adminAccounts.personsHoldingAdminWithin(this.db, [
      ...new Set(edges.map((edge) => edge.leaderId)),
    ]);

    const leaderFor = new Map<string, string>();
    for (const edge of edges) {
      if (!administrators.has(edge.leaderId)) {
        leaderFor.set(edge.personId, edge.leaderId);
      }
    }

    if (leaderFor.size === 0) {
      return { rows: [], nextCursor: null };
    }

    let query = this.db
      .selectFrom('persons as person')
      .select([
        'person.id as id',
        'person.member_id as member_id',
        'person.first_name as first_name',
        'person.middle_name as middle_name',
        'person.last_name as last_name',
      ])
      .where('person.id', 'in', [...leaderFor.keys()])
      // A merged-away Person is not listed: the survivor carries the identity
      // (section 3, Person Merge).
      //
      // **The same is deliberately not asked of the leader.** A filter there was
      // written and withdrawn: section 3 never rewrites a pastoral edge, so a
      // disciple whose leader was absorbed still has no reachable leader and is
      // exactly the gap this list exists to surface.
      .where('person.merged_into_id', 'is', null)
      // **An archived Person is not listed, because section 5 refuses to reassign
      // one.** Section 19 asks each entry to carry the action that resolves it, and
      // decision 0229 states the consequence for the sibling list: an entry no act
      // resolves is what an attention list must never carry.
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
    const page = found.slice(0, limit);
    const last = page[page.length - 1];

    // **The leaders of this page only**, after paging rather than joined into it. At most
    // `limit` rows, and `persons` is this module's own table, so the second read costs one
    // round trip and crosses nothing.
    const leaders = await this.leadersFor([
      ...new Set(page.map((row) => leaderFor.get(row.id) as string)),
    ]);

    const rows = page.map((row) => {
      const leader = leaders.get(leaderFor.get(row.id) as string);

      if (leader === undefined) {
        // Unreachable: `pastoral_assignments.leader_id` carries a foreign key, so the row
        // this page was built from names a Person who exists. Thrown rather than dropped,
        // because dropping would shorten a page silently — and where the query this
        // replaced inner-joined the leader, a missing one removed the entry before the
        // limit was applied rather than after it.
        throw new Error(`No Person row for the former leader of ${row.id}`);
      }

      return { ...row, ...leader };
    });

    return {
      rows,
      nextCursor:
        found.length > limit && last !== undefined
          ? { lastName: last.last_name, firstName: last.first_name, id: last.id }
          : null,
    };
  }

  /** The former leaders named on a page of the attention list, by identifier. */
  private async leadersFor(leaderIds: readonly string[]): Promise<
    Map<
      string,
      {
        leader_id: string;
        leader_member_id: string;
        leader_first_name: string;
        leader_middle_name: string | null;
        leader_last_name: string;
      }
    >
  > {
    if (leaderIds.length === 0) {
      return new Map();
    }

    const rows = await this.db
      .selectFrom('persons')
      .select(['id', 'member_id', 'first_name', 'middle_name', 'last_name'])
      .where('id', 'in', [...leaderIds])
      .execute();

    return new Map(
      rows.map((row) => [
        row.id,
        {
          leader_id: row.id,
          leader_member_id: row.member_id,
          leader_first_name: row.first_name,
          leader_middle_name: row.middle_name,
          leader_last_name: row.last_name,
        },
      ]),
    );
  }

  /**
   * People in scope holding no active Cell membership (SKILL.md sections 10, 15 and
   * 19; decision 0233).
   *
   * **Section 15 requires the list and section 10 fills it.** A closure "must not
   * complete without the decision being made", members may be left unassigned by
   * explicit choice, and the people left that way "appear in the attention list in
   * Section 15". This is that list.
   *
   * **A person leading an `ACTIVE` Cell is excluded, and that is not a detail.** A
   * leader holds no `cell_memberships` row, so the literal reading of section 15
   * places every Cell Leader in the church on a list of people needing a Cell —
   * alphabetically among their own downline. Reproduced against the demo database
   * before the exclusion was written. It keys on **leading**, not on holding any Cell
   * relationship, so a leader whose Cell has closed reappears, which is right.
   *
   * *Whether such a person is a **member** of their own Cell is a wider question with
   * consequences in section 12, and decision 0233 deliberately does not settle it.
   * This exclusion is correct under either answer.*
   *
   * **Archived and merged-away people are excluded** on the sibling list's ground
   * (decision 0232, and decision 0229 before it): adding either to a Cell is refused,
   * so the entry would carry no act that resolves it.
   *
   * **Undated.** It asks about now — somebody placed last week needs no action today —
   * so it names no period, which is what keeps it out of decision 0231's dated class.
   *
   * **Ordered by name**, never by how long somebody has been without a Cell (sections
   * 13, 15 and 17). That ordering would rank the leaders who have not yet placed
   * people rather than the people.
   *
   * **Rooted in `persons`, which this module owns, and reading three tables `cells`
   * owns as anti-joins** — `cell_memberships`, `cell_leaderships` and `cells` itself.
   *
   * **Section 2's exemption names this join** (decision 0234). The exemption is "a read
   * joined onto a query rooted in a table the reading module owns", which this is, and
   * section 2 now names it. Widening the list took a ruling with all three of its legs.
   *
   * *No count is stated here. A first version called this "the third instance", which was
   * false of the tree — `cells` joins `persons` in two more places — and whether section
   * 2's enumeration is of instances or of argued instances is a Stop Condition.*
   *
   * **The two existing ports were never counter-examples**, which is what made the
   * amendment the principled answer rather than the convenient one — and the
   * discriminator is the **call site**. `NetworksService` asks `openLeadershipsOf` as a
   * precondition check keyed by a `personId` it already holds, and `CapabilityGuard` asks
   * `leaderForScope` to resolve one Cell. Neither read is joined onto anything, so neither
   * is a join onto a query rooted in the reading module's own table. They instance section
   * 2's main rule, inverted because the direction would be a cycle, and never its
   * exemption.
   *
   * *A first version argued this from where each port's implementation roots, which is
   * true of any port implementation — the one this method was offered included — and so
   * distinguished nothing.*
   *
   * *A first version of this docblock claimed a port would return a short page. It is
   * withdrawn: a port returning the placed set puts the filter back in the `WHERE` clause
   * as a `NOT IN`, so the page is full. The scope filter below is that shape already.*
   *
   * *`awaitingReassignment` above is **not** precedent for this, and the reason has
   * changed rather than lapsed. It was cited as precedent in error while it selected from
   * `pastoral_assignments` and read `accounts` and `account_roles`, satisfying neither the
   * exemption's premise nor any other clause of section 2 — a Stop Condition in its own
   * right, which decision 0241 settled by re-homing its edge condition to `hierarchy` and
   * its administrator exclusion to `auth`, rather than by admitting either. It now roots in `persons` and crosses nothing, so it is not an
   * exemption instance at all and still cannot be precedent for one.*
   */
  async withoutACell(
    scope: { kind: 'WHOLE_CHURCH' } | { kind: 'PERSONS'; personIds: ReadonlySet<string> },
    limit: number,
    cursor: RosterCursor | null = null,
  ): Promise<{
    rows: {
      id: string;
      member_id: string;
      first_name: string;
      middle_name: string | null;
      last_name: string;
    }[];
    nextCursor: RosterCursor | null;
  }> {
    // An empty scope selects nobody, and `IN ()` is not valid SQL.
    if (scope.kind === 'PERSONS' && scope.personIds.size === 0) {
      return { rows: [], nextCursor: null };
    }

    let query = this.db
      .selectFrom('persons as person')
      .select([
        'person.id as id',
        'person.member_id as member_id',
        'person.first_name as first_name',
        'person.middle_name as middle_name',
        'person.last_name as last_name',
      ])
      .where('person.merged_into_id', 'is', null)
      // No open membership: the condition section 15 states.
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom('cell_memberships as membership')
              .select(sql`1`.as('one'))
              .whereRef('membership.person_id', '=', 'person.id')
              .where('membership.ended_at', 'is', null),
          ),
        ),
      )
      // Leading an ACTIVE Cell counts as having one (decision 0233).
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom('cell_leaderships as leadership')
              .innerJoin('cells as led', 'led.id', 'leadership.cell_id')
              .select(sql`1`.as('one'))
              .whereRef('leadership.person_id', '=', 'person.id')
              .where('leadership.ended_at', 'is', null)
              .where('led.state', '=', 'ACTIVE'),
          ),
        ),
      )
      // An archived Person cannot be added to a Cell, so no act resolves the entry.
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
      .orderBy('person.last_name')
      .orderBy('person.first_name')
      // The Member ID rather than the identifier, so this reuses `RosterCursor`
      // instead of declaring a fourth cursor shape. It is unique and not null, so the
      // three keys are a total order.
      .orderBy('person.member_id')
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
            eb('person.member_id', '>', cursor.memberId),
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
          ? { lastName: last.last_name, firstName: last.first_name, memberId: last.member_id }
          : null,
    };
  }
}
