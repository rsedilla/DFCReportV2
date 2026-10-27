import type { Database } from '../database/schema';
import type { ScopeMembership } from '../auth/authorization/authorization.service';
import type { Transaction } from 'kysely';

/**
 * What archiving a Person asks of the two modules that own the other tables it touches
 * (SKILL.md sections 3 and 6, decision 0397), and what the *Absent 3+ Months* list asks of
 * the module that composes it.
 *
 * **Ports, because each direction is a cycle**, which is the one case section 2 reserves
 * them for: `cells` and `auth` import `PeopleModule`, and `reporting` imports it too, so
 * `people` cannot import any of them back. Each is declared here, where `people` needs it,
 * implemented in the owning module, and bound by a `@Global()` binding module there, as
 * `ADMIN_ACCOUNTS_PORT` and `CELL_RELATIONSHIPS_PORT` are.
 *
 * **Absent, the operation refuses**, on those ports' precedent: a wiring fault closes the
 * route rather than archiving somebody while leaving their Cell membership or their account
 * as it was. `test/unit/module-graph.spec.ts` asserts each is bound.
 */
export const ARCHIVE_CELLS_PORT = Symbol('ARCHIVE_CELLS_PORT');

/** A Cell named in the refusal to archive its leader, with how many members it has. */
export interface LedCell {
  id: string;
  /** `CELL-000000` (SKILL.md section 10). */
  cellId: string;
  members: number;
}

export interface ArchiveCellsPort {
  /**
   * Every Cell the person currently leads, with its member count, for section 3's refusal,
   * which names what must be resolved first. Read inside the archive's transaction.
   */
  ledCellsWithin(executor: Transaction<Database>, personId: string): Promise<LedCell[]>;

  /**
   * Ends the person's open Cell membership at `at`, keeping the row (section 10), and audits
   * it as any ending of a membership is. Null where they held none.
   */
  endMembershipWithin(
    executor: Transaction<Database>,
    personId: string,
    at: Date,
    actorAccountId: string,
  ): Promise<{ cellUuid: string; cellId: string } | null>;

  /**
   * Each person's most recent Cell membership's Cell, open or closed, for the Admin's
   * *Archived* list. A person who was never in a Cell is absent.
   */
  latestCellsOf(
    personIds: readonly string[],
  ): Promise<
    Map<
      string,
      { id: string; cell_id: string; category: string | null; day_of_week: number | null }
    >
  >;
}

export const ARCHIVE_ACCOUNTS_PORT = Symbol('ARCHIVE_ACCOUNTS_PORT');

export interface ArchiveAccountsPort {
  /** The Person's account and its status, or null where they hold none. */
  accountOfWithin(
    executor: Transaction<Database>,
    personId: string,
  ): Promise<{ id: string; status: 'PENDING_ACTIVATION' | 'ACTIVE' | 'DISABLED' } | null>;

  /**
   * Disables the account inside the caller's transaction: every session and every link ends
   * at once, and `account.disabled` is audited (section 6). The caller has already refused
   * an account that is disabled.
   */
  disableWithin(
    executor: Transaction<Database>,
    accountId: string,
    actorAccountId: string,
  ): Promise<void>;
}

export const ABSENT_PEOPLE_PORT = Symbol('ABSENT_PEOPLE_PORT');

/** One row of the *Absent 3+ Months* list (decision 0397). */
export interface AbsentPerson {
  id: string;
  member_id: string;
  full_name: string;
  leader: { person_id: string; full_name: string } | null;
  /** The Cell they are a member of now, or null. */
  cell: { id: string; cell_id: string; category: string | null; day_of_week: number | null } | null;
  /** The Cells they lead now, with their member counts; such a row carries no Archive. */
  leads: {
    id: string;
    cell_id: string;
    category: string | null;
    day_of_week: number | null;
    members: number;
  }[];
  /** Their latest Present mark at a Cell meeting, or a meeting of a Cell they led. */
  last_at_cell: string | null;
  /** Their latest Present mark on a DCC Sunday. */
  last_at_dcc: string | null;
}

export interface AbsentPeoplePort {
  /**
   * The list for one actor's scope, in first-name order, a page at a time, and the three
   * months it covers as `YYYY-MM`.
   */
  absentPage(
    scope: ScopeMembership,
    limit: number,
    cursor: { firstName: string; lastName: string; memberId: string } | null,
  ): Promise<{
    months: string[];
    rows: AbsentPerson[];
    nextCursor: { firstName: string; lastName: string; memberId: string } | null;
  }>;
}
