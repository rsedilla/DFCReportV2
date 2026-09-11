import type { Db } from '../database/database.module';
import type { Database } from '../database/schema';
import type { Transaction } from 'kysely';

/**
 * Which of these Persons hold a live `ADMIN` account (SKILL.md sections 2, 5 and 6;
 * ruling of 2026-09-11).
 *
 * **Declared here and implemented in `auth`, because the direction is a cycle.** Section 2
 * reserves a port for that case "and only there": `auth` imports `PeopleModule`, so
 * `people` cannot import `auth` back and call it the ordinary way, which is what the other
 * three reads that ruling re-homed were able to do.
 *
 * **What it is for** is Section 5's remedy applied one relationship over. An administrator
 * outside the pastoral structure holds no assignment of their own and is in the correct and
 * permanent state, so their disciples are not waiting for a reassignment and do not belong
 * on Section 20's attention list.
 *
 * **A live `ADMIN` role is a proxy for that state rather than the state itself**, which is
 * recorded as open in `CLAUDE.md` and is unchanged by this port: nothing forbids a leader
 * inside the tree from also holding `ADMIN`, and if such a leader's own assignment ends,
 * this exclusion takes their whole disciple set off the list. Moving the read changes no
 * rule — it is the same proxy, asked of the module that owns the tables.
 *
 * **It takes a set and answers a set**, rather than being asked per leader. The caller
 * holds every broken edge at once and would otherwise issue one query per row, which is
 * the shape Section 2's own exemption paragraph rejects for `openDisciplesOf`.
 */
export const ADMIN_ACCOUNTS_PORT = Symbol('ADMIN_ACCOUNTS_PORT');

export interface AdminAccountsPort {
  /**
   * Of these Persons, those holding an `ADMIN` role that has not been revoked.
   *
   * Takes the caller's executor so the answer is read inside the transaction that asked,
   * rather than asking a bounded pool for a second connection while holding one (section
   * 24). An empty input answers an empty set without querying.
   */
  personsHoldingAdminWithin(
    executor: Db | Transaction<Database>,
    personIds: readonly string[],
  ): Promise<Set<string>>;
}
