import { ApiError, ApiErrorCode } from '../errors/api-error';

import type { Transaction } from 'kysely';
import type { AccountsRepository } from '../../auth/accounts.repository';
import type { Db } from '../../database/database.module';
import type { Database } from '../../database/schema';
import type { PeopleReadService } from '../../people/people.read.service';
import type { ConflictSide } from '../errors/version-conflict';

/**
 * `VERSION_CONFLICT` for a Growth record (SKILL.md section 28; decision 0282).
 *
 * A Growth row carries no version: a row is never changed once it stands, only
 * superseded by a correction, so the row's own identifier is what a client saw and
 * what it sends back. Where the row it saw is no longer current, nothing is saved and
 * the line is named, with both sides section 22 requires a person to choose between.
 *
 * `submitted_row` and `current_row` take the places of section 22's two versions.
 * Either may be null: a client that saw nothing, or a record withdrawn since.
 */
export class GrowthConflictError extends ApiError {
  constructor(params: {
    message: string;
    submittedRow: string | null;
    currentRow: string | null;
    submitted: ConflictSide;
    current: ConflictSide;
  }) {
    super(ApiErrorCode.VERSION_CONFLICT, params.message, {
      submitted_row: params.submittedRow,
      current_row: params.currentRow,
      submitted: render(params.submitted),
      current: render(params.current),
    });
  }
}

/** A Person's name for one side of a conflict, read on the caller's executor. */
export async function nameOfPerson(
  deps: { people: PeopleReadService },
  executor: Db | Transaction<Database>,
  personId: string,
): Promise<{ id: string; name: string }> {
  const person = await deps.people.forDecisionWithin(executor, personId);
  return { id: personId, name: person?.fullName ?? 'somebody' };
}

/**
 * The name behind an account, asked of `auth`, which owns `accounts` (section 2), on the
 * caller's executor so a conflict raised inside a transaction takes no second connection.
 */
export async function nameOfAccount(
  deps: { people: PeopleReadService; accounts: AccountsRepository },
  executor: Db | Transaction<Database>,
  accountId: string,
): Promise<{ id: string; name: string }> {
  const personId = await deps.accounts.personBehindWithin(executor, accountId);
  if (personId === null) {
    return { id: accountId, name: 'an account that no longer exists' };
  }

  const person = await deps.people.forDecisionWithin(executor, personId);
  return { id: accountId, name: person?.fullName ?? 'somebody' };
}

function render(side: ConflictSide): Record<string, unknown> {
  return {
    ...side.values,
    recorded_at: side.recordedAt,
    actor: { id: side.actor.id, name: side.actor.name },
  };
}
