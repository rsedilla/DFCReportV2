import type { Logger } from '@nestjs/common';

import type { EmailPort } from '../email/email.port';
import type { PeopleReadService } from '../people/people.read.service';
import type { AccountsRepository } from './accounts.repository';
import type { SignInName, SignInPauseService } from './sign-in-pause.service';

/** What {@link notePasswordPause} needs, taken from whichever service started the pause. */
export interface PauseAlertDeps {
  pauses: SignInPauseService;
  people: PeopleReadService;
  accounts: AccountsRepository;
  email: EmailPort;
  logger: Logger;
}

/**
 * Writes a pause started by wrong current passwords on My Account to the audit log and emails
 * each active Admin (decision 0448): its own audit entry naming the signed-in account, its own
 * once a day, and its own email, which says the signed-in session itself may be in other hands.
 * It never throws, so a failing mail provider changes nothing the caller answers.
 */
export async function noteCurrentPasswordPause(
  deps: PauseAlertDeps,
  email: string,
  identifier: string,
  accountId: string,
  holderPersonId: string,
  pausedUntil: Date,
): Promise<void> {
  try {
    const send = await deps.pauses.recordCurrentPasswordPause(accountId, identifier, pausedUntil);
    if (!send) {
      return;
    }
    const holder = (await deps.people.forDecision(holderPersonId))?.fullName ?? 'an unnamed person';
    for (const admin of await deps.accounts.activeAdministrators()) {
      const name = (await deps.people.forDecision(admin.person_id))?.fullName ?? '';
      await deps.email.send({
        kind: 'CURRENT_PASSWORD_PAUSED',
        to: { email: admin.email, name },
        email,
        holder,
        pausedUntil,
      });
    }
  } catch (error) {
    deps.logger.error(
      `Could not record or report the current-password pause of account ${accountId}.`,
      error instanceof Error ? error.stack : undefined,
    );
  }
}

/**
 * Writes the pause of an account's name to the audit log and, within the daily caps, emails
 * each active Admin (decision 0413), for a pause started at sign-in. It never throws, so a
 * failing mail provider changes nothing the caller answers.
 */
export async function notePasswordPause(
  deps: PauseAlertDeps,
  typed: SignInName,
  identifier: string,
  accountId: string,
  holderPersonId: string,
  pausedUntil: Date,
): Promise<void> {
  try {
    const email = await deps.pauses.recordPause(accountId, identifier, pausedUntil);
    if (!email) {
      return;
    }
    const holder = (await deps.people.forDecision(holderPersonId))?.fullName ?? 'an unnamed person';
    for (const admin of await deps.accounts.activeAdministrators()) {
      const name = (await deps.people.forDecision(admin.person_id))?.fullName ?? '';
      await deps.email.send({
        kind: 'SIGN_IN_PAUSED',
        to: { email: admin.email, name },
        typed,
        holder,
        pausedUntil,
      });
    }
  } catch (error) {
    deps.logger.error(
      `Could not record or report the sign-in pause of account ${accountId}.`,
      error instanceof Error ? error.stack : undefined,
    );
  }
}
