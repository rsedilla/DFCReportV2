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
 * Reading a Person, and the church-wide directory search (SKILL.md sections 3 and
 * 8).
 *
 * Separate from the write paths because it shares nothing with them: no
 * transaction, no person lock, no idempotency claim, no audit entry. Section 8's
 * redaction is the whole of the authorization work here, and keeping it away from
 * the eleven-step write skeleton is what makes either readable.
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
}
