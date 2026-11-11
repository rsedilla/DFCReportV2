import { Inject, Injectable } from '@nestjs/common';
import { sql, type ExpressionBuilder } from 'kysely';

import { type RosterCursor } from '../common/roster-cursor';
import { DATABASE, type Db } from '../database/database.module';
import { normalizeName } from '../people/duplicate-matching';
import { composeName, escapeLike } from '../people/people.shared';

import type { AccountRole, AccountStatus, Database } from '../database/schema';

/** The filters of the Admin area's Accounts list (decision 0419). */
export const ACCOUNT_FILTERS = [
  'ALL',
  'ACTIVE',
  'PENDING_ACTIVATION',
  'PAUSED',
  'NO_SECOND_STEP',
  'DISABLED',
] as const;

export type AccountFilter = (typeof ACCOUNT_FILTERS)[number];

export interface AccountListRow {
  account_id: string;
  person_id: string;
  name: string;
  email: string;
  username: string | null;
  roles: AccountRole[];
  status: AccountStatus;
  created_at: string;
  /** Sign-in paused after ten wrong passwords (decision 0413), until this instant. */
  paused_until: string | null;
  second_step: { required: boolean; set_up_at: string | null };
  full_view: boolean;
  approves_cells: boolean;
  moves_people: boolean;
}

type Eb = ExpressionBuilder<Database, 'accounts'>;

/**
 * Every account, for the Admin area's Accounts tab (SKILL.md section 19, decision 0419).
 *
 * Rooted in `accounts`, which this module owns, and joined to `persons` for the name it is
 * ordered and searched by: section 2's exempt shape, named in `module-boundaries.json`.
 */
@Injectable()
export class AccountsListService {
  constructor(@Inject(DATABASE) private readonly db: Db) {}

  async list(options: {
    q: string | null;
    filter: AccountFilter;
    limit: number;
    cursor: RosterCursor | null;
  }): Promise<{ rows: AccountListRow[]; nextCursor: RosterCursor | null }> {
    const { q, filter, limit, cursor } = options;

    let query = this.db
      .selectFrom('accounts')
      .innerJoin('persons', 'persons.id', 'accounts.person_id')
      .select((eb) => [
        'accounts.id as account_id',
        'accounts.person_id as person_id',
        'accounts.email as email',
        'accounts.username as username',
        'accounts.status as status',
        'accounts.created_at as created_at',
        'accounts.full_view as full_view',
        'accounts.approves_cells as approves_cells',
        'accounts.moves_people as moves_people',
        'persons.member_id as member_id',
        'persons.title as title',
        'persons.first_name as first_name',
        'persons.middle_name as middle_name',
        'persons.last_name as last_name',
        eb
          .selectFrom('account_roles')
          .select(
            sql<AccountRole[]>`array_agg(account_roles.role::text ORDER BY account_roles.role)`.as(
              'r',
            ),
          )
          .whereRef('account_roles.account_id', '=', 'accounts.id')
          .where('account_roles.revoked_at', 'is', null)
          .as('roles'),
        pausedUntil(eb).as('paused_until'),
        owesSecondStep(eb).as('owes_second_step'),
        eb
          .selectFrom('second_steps')
          .select('second_steps.set_up_at')
          .whereRef('second_steps.account_id', '=', 'accounts.id')
          .where('second_steps.revoked_at', 'is', null)
          .$castTo<Date | null>()
          .as('second_step_set_up_at'),
      ])
      .where((eb) => filterWhere(eb, filter))
      .orderBy('persons.first_name')
      .orderBy('persons.last_name')
      .orderBy('persons.member_id')
      // One more than asked for, which is how the last page is recognised without a count.
      .limit(limit + 1);

    if (q !== null) {
      const name = normalizeName(q);
      const pattern = `%${escapeLike(name).replace(/\s+/g, '%')}%`;
      const address = `%${escapeLike(q.trim().toLowerCase())}%`;
      query = query.where((eb) =>
        eb.or([
          ...(name === ''
            ? []
            : [
                eb('persons.search_first_name', 'like', pattern),
                eb('persons.search_last_name', 'like', pattern),
                eb('persons.search_full_name', 'like', pattern),
              ]),
          eb('accounts.email_normalized', 'like', address),
          eb('accounts.username', 'like', address),
        ]),
      );
    }

    if (cursor !== null) {
      query = query.where((eb) =>
        eb.or([
          eb('persons.first_name', '>', cursor.firstName),
          eb.and([
            eb('persons.first_name', '=', cursor.firstName),
            eb('persons.last_name', '>', cursor.lastName),
          ]),
          eb.and([
            eb('persons.first_name', '=', cursor.firstName),
            eb('persons.last_name', '=', cursor.lastName),
            eb('persons.member_id', '>', cursor.memberId),
          ]),
        ]),
      );
    }

    const found = await query.execute();
    const page = found.slice(0, limit);
    const last = page[page.length - 1];

    return {
      rows: page.map((row) => ({
        account_id: row.account_id,
        person_id: row.person_id,
        name: composeName(row),
        email: row.email,
        username: row.username,
        roles: row.roles ?? [],
        status: row.status,
        created_at: new Date(row.created_at).toISOString(),
        paused_until: row.paused_until === null ? null : new Date(row.paused_until).toISOString(),
        second_step: {
          required: row.owes_second_step === true,
          set_up_at:
            row.second_step_set_up_at === null
              ? null
              : new Date(row.second_step_set_up_at).toISOString(),
        },
        full_view: row.full_view,
        approves_cells: row.approves_cells,
        moves_people: row.moves_people,
      })),
      nextCursor:
        found.length > limit && last !== undefined
          ? { firstName: last.first_name, lastName: last.last_name, memberId: last.member_id }
          : null,
    };
  }

  /** How many accounts each filter holds, one statement so the counts agree. */
  async counts(): Promise<Record<Lowercase<AccountFilter>, number>> {
    const row = await this.db
      .selectFrom('accounts')
      .select((eb) =>
        ACCOUNT_FILTERS.map((filter) =>
          eb.fn
            .count<string>('accounts.id')
            .filterWhere(filterWhere(eb, filter))
            .as(filter.toLowerCase()),
        ),
      )
      .executeTakeFirstOrThrow();

    return Object.fromEntries(
      ACCOUNT_FILTERS.map((filter) => {
        const key = filter.toLowerCase() as Lowercase<AccountFilter>;
        return [key, Number((row as Record<string, string>)[key])];
      }),
    ) as Record<Lowercase<AccountFilter>, number>;
  }
}

/**
 * Until when the account's sign-in is paused, by either name it signs in with (decision
 * 0413), or null. The identifiers are `SignInPauseService`'s: `email:` with the normalized
 * address, `username:` with the name, which is stored lowercase.
 */
function pausedUntil(eb: Eb) {
  return eb
    .selectFrom('sign_in_pauses')
    .select(sql<Date | null>`max(sign_in_pauses.paused_until)`.as('p'))
    .where((inner) =>
      inner.or([
        inner('sign_in_pauses.identifier', '=', sql<string>`'email:' || accounts.email_normalized`),
        inner('sign_in_pauses.identifier', '=', sql<string>`'username:' || accounts.username`),
      ]),
    )
    .where(sql<boolean>`sign_in_pauses.paused_until > now()`);
}

/** Holds `ADMIN`, `NETWORK_ADMIN` or `SENIOR_PASTOR`, so signs in with a second step (decision 0302). */
function owesSecondStep(eb: Eb) {
  return eb
    .exists(
      eb
        .selectFrom('account_roles')
        .select('account_roles.id')
        .whereRef('account_roles.account_id', '=', 'accounts.id')
        .where('account_roles.role', 'in', ['ADMIN', 'NETWORK_ADMIN', 'SENIOR_PASTOR'])
        .where('account_roles.revoked_at', 'is', null),
    )
    .$castTo<boolean>();
}

function filterWhere(eb: Eb, filter: AccountFilter) {
  switch (filter) {
    case 'ALL':
      return sql<boolean>`true`;
    case 'ACTIVE':
    case 'PENDING_ACTIVATION':
    case 'DISABLED':
      return eb('accounts.status', '=', filter);
    case 'PAUSED':
      return eb(pausedUntil(eb), 'is not', null);
    case 'NO_SECOND_STEP':
      // An account in use that owes the step and has none: one waiting for activation sets it
      // up on its first sign-in, and a disabled one signs in to nothing.
      return eb.and([
        eb('accounts.status', '=', 'ACTIVE'),
        owesSecondStep(eb),
        eb.not(
          eb.exists(
            eb
              .selectFrom('second_steps')
              .select('second_steps.id')
              .whereRef('second_steps.account_id', '=', 'accounts.id')
              .where('second_steps.revoked_at', 'is', null),
          ),
        ),
      ]);
  }
}
