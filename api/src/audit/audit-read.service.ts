import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import { AccountsRepository } from '../auth/accounts.repository';
import { CURSOR_INSTANT_FORMAT } from '../cells/leadership-request-cursor';
import { CellsReadService } from '../cells/cells.read.service';
import { ValidationFailedError } from '../common/errors/api-error';
import { canonicalId, isUuid } from '../common/identifiers';
import { DATABASE, type Db } from '../database/database.module';
import { normalizeName } from '../people/duplicate-matching';
import { SEARCH_MINIMUM } from '../people/dto/people.dto';
import { PeopleReadService } from '../people/people.read.service';
import { KIND_OF_ACTION, actionsOfKind, type AuditKind } from './audit-kinds';
import { type AuditLogCursor } from './audit-log-cursor';

import type { AuditAction, Json } from '../database/schema';

export interface AuditLogRow {
  id: string;
  occurred_at: string;
  action: AuditAction;
  kind: Exclude<AuditKind, 'EVERYTHING'> | null;
  /** Null for a system action (section 21). */
  actor: { account_id: string; person_id: string | null } | null;
  target: {
    type: string;
    id: string;
    /** The Person an entry is about, directly or through their account. */
    person_id: string | null;
    /** The `CELL-000000` handle of a Cell target. */
    cell_code: string | null;
  };
  before: Json | null;
  after: Json | null;
  reason: string | null;
}

/**
 * The most people one name search is widened to. A two-letter name can match more people than
 * this in a large church, and then the entries of the rest are not found by it; the answer says
 * so (`truncated`, decision 0429), and a longer name, or a Member ID, finds them.
 */
export const SEARCH_PEOPLE_CEILING = 1000;

/**
 * The Admin's Audit Log (SKILL.md sections 19 and 21, decision 0428): the whole log, newest
 * first, searched and narrowed.
 *
 * **Every query here is rooted in `audit_log` and reads nothing else.** The names an entry is
 * shown and searched by belong to `people`, `auth` and `cells`, so each is asked through its
 * owning module (section 2): a search is turned into the Persons, accounts and Cells it means
 * before the log is read, and a page is named after it is read.
 */
@Injectable()
export class AuditReadService {
  constructor(
    @Inject(DATABASE) private readonly db: Db,
    private readonly people: PeopleReadService,
    private readonly accounts: AccountsRepository,
    private readonly cells: CellsReadService,
  ) {}

  async list(options: {
    q: string | null;
    kind: AuditKind;
    limit: number;
    cursor: AuditLogCursor | null;
  }): Promise<{
    rows: AuditLogRow[];
    names: Record<string, { name: string; member_id: string }>;
    nextCursor: AuditLogCursor | null;
    /** The search matched more people than it looks through (decision 0429). */
    truncated: boolean;
  }> {
    const { q, kind, limit, cursor } = options;
    const matching = q === null ? null : await this.matching(q);
    const truncated = matching?.truncated ?? false;

    if (matching !== null && matching.isEmpty) {
      return { rows: [], names: {}, nextCursor: null, truncated };
    }

    let query = this.db
      .selectFrom('audit_log')
      .select([
        'id',
        'occurred_at',
        sql<string>`to_char(occurred_at at time zone 'UTC', ${sql.lit(CURSOR_INSTANT_FORMAT)})`.as(
          'occurred_at_key',
        ),
        'action',
        'target_type',
        'target_id',
        'actor_id',
        'before',
        'after',
        'reason',
      ])
      .orderBy('occurred_at', 'desc')
      .orderBy('id', 'desc')
      // One more than asked for, which is how the last page is recognised without a count.
      .limit(limit + 1);

    if (kind !== 'EVERYTHING') {
      query = query.where('action', 'in', actionsOfKind(kind));
    }

    if (matching !== null) {
      query = query.where((eb) =>
        eb.or([
          ...(matching.people.length === 0
            ? []
            : [eb.and([eb('target_type', '=', 'person'), eb('target_id', 'in', matching.people)])]),
          ...(matching.accounts.length === 0
            ? []
            : [
                eb.and([
                  eb('target_type', '=', 'account'),
                  eb('target_id', 'in', matching.accounts),
                ]),
                eb('actor_id', 'in', matching.accounts),
              ]),
          ...(matching.cells.length === 0
            ? []
            : [eb.and([eb('target_type', '=', 'cell'), eb('target_id', 'in', matching.cells)])]),
        ]),
      );
    }

    if (cursor !== null) {
      // Cast on the parameter, so the comparison is at the column's own precision.
      const at = sql<Date>`${cursor.occurredAt}::timestamptz`;
      query = query.where((eb) =>
        eb.or([
          eb('occurred_at', '<', at),
          eb.and([eb('occurred_at', '=', at), eb('id', '<', cursor.id)]),
        ]),
      );
    }

    const found = await query.execute();
    const page = found.slice(0, limit);
    const last = page[page.length - 1];

    const accountIds = new Set<string>();
    const cellIds: string[] = [];
    for (const row of page) {
      if (row.actor_id !== null) accountIds.add(row.actor_id);
      if (row.target_type === 'account' && isUuid(row.target_id)) accountIds.add(row.target_id);
      if (row.target_type === 'cell' && isUuid(row.target_id)) cellIds.push(row.target_id);
    }
    const [personOfAccount, codes] = await Promise.all([
      this.accounts.personsOfAccounts([...accountIds]),
      this.cells.codesOf(cellIds),
    ]);

    const rows: AuditLogRow[] = page.map((row) => ({
      id: row.id,
      occurred_at: new Date(row.occurred_at).toISOString(),
      action: row.action,
      kind: KIND_OF_ACTION[row.action] ?? null,
      actor:
        row.actor_id === null
          ? null
          : { account_id: row.actor_id, person_id: personOfAccount.get(row.actor_id) ?? null },
      target: {
        type: row.target_type,
        id: row.target_id,
        person_id:
          row.target_type === 'person'
            ? row.target_id
            : row.target_type === 'account'
              ? (personOfAccount.get(row.target_id) ?? null)
              : null,
        cell_code: row.target_type === 'cell' ? (codes.get(row.target_id) ?? null) : null,
      },
      before: row.before,
      after: row.after,
      reason: row.reason,
    }));

    return {
      rows,
      names: await this.namesIn(rows),
      nextCursor:
        found.length > limit && last !== undefined
          ? { occurredAt: last.occurred_at_key, id: last.id }
          : null,
      truncated,
    };
  }

  /**
   * What a search means, as the Persons, accounts and Cells whose entries it finds: a Cell ID
   * by its handle's start, otherwise a name or a Member ID through the people search, the
   * entries found being those about a Person or their account and those their account made.
   */
  private async matching(q: string): Promise<{
    people: string[];
    accounts: string[];
    cells: string[];
    isEmpty: boolean;
    truncated: boolean;
  }> {
    const term = q.trim();

    if (/^cell-?\d*$/i.test(term)) {
      const digits = term.replace(/^cell-?/i, '');
      const cells = await this.cells.idsWithCodePrefix(`CELL-${digits}`);
      return { people: [], accounts: [], cells, isEmpty: cells.length === 0, truncated: false };
    }

    // **The minimum is counted on the term as it is searched** (decision 0429), as the People
    // search counts it: `a-` and ` a` pass the DTO's bound on the raw string and search for one
    // letter. A Member ID is matched by its start and needs no such count.
    if (
      !/^m-?\d+$/i.test(term) &&
      normalizeName(term).replace(/\s+/g, '').length < SEARCH_MINIMUM
    ) {
      throw new ValidationFailedError('Enter at least two letters of a name.', { field: 'q' });
    }

    const { rows, nextCursor } = await this.people.searchByName(
      term,
      SEARCH_PEOPLE_CEILING,
      null,
      null,
      { memberId: true },
    );
    const people = rows.map((row) => canonicalId(row.id));
    const accounts = await this.accounts.accountsOfPersons(people);
    return {
      people,
      accounts,
      cells: [],
      isEmpty: people.length === 0,
      // More people match than the search looks through, and the answer says so (decision 0429).
      truncated: nextCursor !== null,
    };
  }

  /**
   * Names for every Person a page mentions: who acted, whom an entry is about, and those an
   * entry's before and after name by identifier, such as the leaders a move went from and to.
   * Asked of `people` rather than read here (section 2); an identifier naming no Person, such
   * as a Cell's, is simply left out.
   */
  private async namesIn(
    rows: readonly AuditLogRow[],
  ): Promise<Record<string, { name: string; member_id: string }>> {
    const ids = new Set<string>();
    const visit = (value: unknown, key: string | null): void => {
      if (typeof value === 'string') {
        if (key !== null && /(^|_)id$/.test(key) && isUuid(value)) {
          ids.add(canonicalId(value));
        }
      } else if (Array.isArray(value)) {
        for (const each of value) visit(each, key);
      } else if (typeof value === 'object' && value !== null) {
        for (const [k, v] of Object.entries(value)) visit(v, k);
      }
    };
    for (const row of rows) {
      if (row.actor?.person_id) ids.add(row.actor.person_id);
      if (row.target.person_id) ids.add(row.target.person_id);
      visit(row.before, null);
      visit(row.after, null);
    }
    const found = await this.people.namesOf([...ids]);
    return Object.fromEntries(
      [...found].map(([id, person]) => [id, { name: person.fullName, member_id: person.memberId }]),
    );
  }
}
