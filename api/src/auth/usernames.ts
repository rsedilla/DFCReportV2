import { sql } from 'kysely';

import type { Db } from '../database/database.module';
import type { Database } from '../database/schema';
import type { Transaction } from 'kysely';

/**
 * A username's shape (SKILL.md section 6, decision 0337): lowercase letters and numbers, 3 to
 * 30, starting with a letter. The same pattern is the `accounts_username_shape` check in
 * migration 0025, so the application and the database refuse alike.
 */
export const USERNAME_PATTERN = /^[a-z][a-z0-9]{2,29}$/;

/** Capitals are ignored: a username is stored and compared lowercase. */
export function canonicalUsername(value: string): string {
  return value.trim().toLowerCase();
}

const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv']);

/** Marks removed (`ñ` is `n`), lowercase, and anything but a to z dropped. */
function lettersOf(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

/**
 * The suggestion before any number (decision 0337): the first letter of the first name, of
 * the middle name where there is one, and the surname without a trailing `Jr`, `Sr`, `II`,
 * `III` or `IV`. A name with no letter a to z to start from starts `user`, so the result
 * always begins with a letter.
 */
export function usernameBase(names: {
  firstName: string;
  middleName: string | null;
  lastName: string;
}): string {
  const surnameWords = names.lastName
    .split(/[\s\-'’.,]+/)
    .map(lettersOf)
    .filter((word) => word !== '');
  while (surnameWords.length > 1 && SUFFIXES.has(surnameWords[surnameWords.length - 1])) {
    surnameWords.pop();
  }

  const base = `${lettersOf(names.firstName).slice(0, 1)}${lettersOf(names.middleName ?? '').slice(0, 1)}${surnameWords.join('')}`;

  return (/^[a-z]/.test(base) ? base : `user${base}`).slice(0, 30);
}

/**
 * The base where it is free and three characters long, otherwise the first free one with 2,
 * then 3, added (decision 0337). A name another account holds is taken; the account asking
 * may keep its own.
 */
export async function nextFreeUsername(
  executor: Db | Transaction<Database>,
  base: string,
  exceptAccountId: string | null,
): Promise<string> {
  // Every name sharing the shortest prefix a candidate keeps, so a base cut to make room
  // for its number is still checked. `base` is lowercase letters only, safe in a pattern.
  const rows = await executor
    .selectFrom('accounts')
    .select('username')
    .where('username', 'like', `${base.slice(0, 25)}%`)
    .$if(exceptAccountId !== null, (query) => query.where('id', '!=', exceptAccountId as string))
    .execute();
  const taken = new Set(rows.map((row) => row.username));

  if (base.length >= 3 && !taken.has(base)) {
    return base;
  }

  for (let number = 2; ; number += 1) {
    const suffix = String(number);
    const candidate = `${base.slice(0, 30 - suffix.length)}${suffix}`;
    // A one-letter base needs a two-digit number to reach three characters (`a10`).
    if (candidate.length >= 3 && !taken.has(candidate)) {
      return candidate;
    }
  }
}

/** Whether another account than this one holds the name. */
export async function usernameTaken(
  executor: Db | Transaction<Database>,
  username: string,
  exceptAccountId: string | null,
): Promise<boolean> {
  const row = await executor
    .selectFrom('accounts')
    .select(sql<number>`1`.as('one'))
    .where('username', '=', username)
    .$if(exceptAccountId !== null, (query) => query.where('id', '!=', exceptAccountId as string))
    .executeTakeFirst();

  return row !== undefined;
}
