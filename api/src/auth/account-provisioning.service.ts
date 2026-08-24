import { Inject, Injectable, Logger } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import { InvariantViolationError, NotFoundError } from '../common/errors/api-error';
import { IdempotencyService } from '../common/idempotency/idempotency.service';
import { DATABASE, type Db } from '../database/database.module';
import { EMAIL_PORT, type EmailPort, type OutboundEmail } from '../email/email.port';

import { PeopleReadService } from '../people/people.read.service';

import { AccountTokensService } from './account-tokens.service';
import { normalizeEmail } from './accounts.repository';
import { type Actor } from './authorization/authorization.service';

import type { CurrentClaim } from '../common/idempotency/current-idempotency.decorator';
import type { AccountRole, Database } from '../database/schema';
import type { Transaction } from 'kysely';

/** How long an activation token lives. Longer than a reset, and for a reason. */
const ACTIVATION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The roles that qualify a Person for an account today (SKILL.md section 6).
 *
 * `LEADER` is absent deliberately and temporarily: a Leader account's
 * qualification is an active Cell leadership assignment (section 11), `cells` is
 * Stage 3, and there is nothing yet to check one against. Accepting a `LEADER`
 * request with the check deferred would detach "leader" from "leads a Cell" for a
 * whole stage, which section 11 makes non-negotiable and which the 2026-08-20
 * ruling on submission roll-up refused to widen section 6 for.
 *
 * Stage 3 adds `LEADER` here **and** the leadership check beside it, in one change.
 */
const QUALIFYING_ROLES: readonly AccountRole[] = ['ADMIN', 'SENIOR_PASTOR'];

export interface ProvisionAccountInput {
  personId: string;
  email: string;
  role: AccountRole;
}

/**
 * Creating an account and inviting its holder to set a password (SKILL.md section
 * 6, Account activation).
 *
 * **The account, its qualifying role, its activation token and the audit entries
 * are one transaction**, and the email is sent after it commits. Sending inside
 * would mail a token for an account a later failure rolls back, so the holder is
 * invited to activate something that does not exist.
 *
 * **A delivery failure does not fail the request**, and that is the half an earlier
 * version got wrong. It raised, which broke the write-endpoint contract in
 * `CLAUDE.md`: the completion is recorded *inside* the transaction, so by the time
 * the send runs the store already holds a `COMPLETED` 201. Raising then gave the
 * client a 500 while every retry on that key replayed the 201 — and the release
 * path could not help, since its predicate is `IN_FLIGHT` and the row was already
 * `COMPLETED`. An account was left stranded with a live token nobody held.
 *
 * The account genuinely was created, so 201 is the honest answer. The failure is
 * logged and the operator re-sends through `POST /accounts/{id}/activation-email`,
 * which is the second path section 6 step 3 previously lacked — previously the
 * only recovery was the holder using `forgot-password`, which works on a
 * `PENDING_ACTIVATION` account by accident and audits as a password reset.
 */
@Injectable()
export class AccountProvisioningService {
  private readonly logger = new Logger(AccountProvisioningService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Db,
    @Inject(EMAIL_PORT) private readonly email: EmailPort,
    private readonly tokens: AccountTokensService,
    private readonly people: PeopleReadService,
    private readonly audit: AuditService,
    private readonly idempotency: IdempotencyService,
  ) {}

  async provision(
    input: ProvisionAccountInput,
    actor: Actor,
    claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    if (!QUALIFYING_ROLES.includes(input.role)) {
      // Section 22: a rule about what may be recorded, whoever submits it, which
      // is what separates this from `SCOPE_DENIED`. The actor's authority is not
      // in question — an Admin cannot do this either, yet.
      throw new InvariantViolationError(
        'An account is provisioned together with the role that qualifies it, and only ADMIN and SENIOR_PASTOR qualify today. A LEADER account arrives with the Cell leadership that qualifies it.',
        { role: input.role, qualifying_roles: QUALIFYING_ROLES },
      );
    }

    const outcome = await this.db.transaction().execute(async (trx) => {
      // Through `people`, which owns `persons` and `person_lifecycle` (section 2).
      const person = await this.people.forDecisionWithin(trx, input.personId);

      if (!person) {
        throw new NotFoundError('No such person.');
      }

      if (person.mergedIntoId !== null) {
        throw new InvariantViolationError(
          'That person was absorbed by a merge. Use the surviving Person instead.',
          { person_id: input.personId },
        );
      }

      // **An archived Person is not given an account.** Section 6 covers the
      // access decision *at* archive and reactivation *after* it, and said nothing
      // about creating one for somebody already archived; settled 2026-08-24 and
      // written to section 6.
      //
      // Consistent with every neighbouring rule: section 5 refuses an archived
      // Person as a pastoral destination, section 3 refuses archiving somebody who
      // leads a Cell. An archived Person does not acquire new live relationships,
      // and an account is one.
      if (person.isArchived) {
        throw new InvariantViolationError(
          'That person is archived. Restore them first, which is a separate and separately audited decision.',
          { person_id: input.personId },
        );
      }

      // Section 6: one Person has at most one Account, whatever number of Cells
      // they lead. Refused rather than reused, because reuse would silently
      // re-invite somebody whose account is already active.
      const existing = await trx
        .selectFrom('accounts')
        .select('id')
        .where('person_id', '=', input.personId)
        .executeTakeFirst();

      if (existing) {
        throw new InvariantViolationError('That person already has an account.', {
          person_id: input.personId,
        });
      }

      // **The email is unique after normalization (section 6), and the constraint
      // alone is not an answer.** A duplicate raises 23505, which the exception
      // filter does not recognise, so it renders `INTERNAL_ERROR` — the
      // 500-instead-of-an-answer failure recorded on 2026-08-23 for the self-leader
      // check. Checked here so an administrator is told what is wrong.
      //
      // The constraint still decides it under a race; that path is a 500 that a
      // retry turns into this refusal, which is the lesser half and is why this
      // check is not itself the enforcement.
      const takenEmail = await trx
        .selectFrom('accounts')
        .select('id')
        .where('email_normalized', '=', normalizeEmail(input.email))
        .executeTakeFirst();

      if (takenEmail) {
        throw new InvariantViolationError('That email address already has an account.', {
          field: 'email',
        });
      }

      // **Which slot a Senior Pastor takes is chosen here, not by the caller.**
      // Section 7 caps the role at two and the 2026-08-21 ruling calls a slot "a
      // seat, not a rank" — so naming one chooses nothing meaningful, and a caller
      // naming an occupied slot would get a constraint violation for a decision it
      // should never have been making.
      //
      // Read inside the transaction, and the partial unique index is what actually
      // enforces the cap: two concurrent provisions both seeing slot 2 free means
      // one insert fails, which is the outcome the index exists to guarantee and
      // which a count could not.
      const slot = input.role === 'SENIOR_PASTOR' ? await freeSeniorPastorSlot(trx) : null;

      const account = await trx
        .insertInto('accounts')
        .values({
          person_id: input.personId,
          email: input.email.trim(),
          email_normalized: normalizeEmail(input.email),
          status: 'PENDING_ACTIVATION',
        })
        .returning(['id', 'email', 'status'])
        .executeTakeFirstOrThrow();

      await trx
        .insertInto('account_roles')
        .values({
          account_id: account.id,
          role: input.role,
          senior_pastor_slot: slot,
          granted_by: actor.accountId,
        })
        .execute();

      const token = await this.tokens.mintWithin(
        trx,
        account.id,
        'ACTIVATION',
        ACTIVATION_LIFETIME_MS,
      );

      // Section 21 lists account creation and role changes separately, so each is
      // recorded separately, in the transaction that performed it.
      await this.audit.writeWithin(trx, {
        actorId: actor.accountId,
        action: 'account.created',
        targetType: 'account',
        targetId: account.id,
        after: { person_id: input.personId, status: 'PENDING_ACTIVATION' },
      });

      await this.audit.writeWithin(trx, {
        actorId: actor.accountId,
        action: 'role.granted',
        targetType: 'account',
        targetId: account.id,
        after: { role: input.role },
      });

      const body = {
        id: account.id,
        person_id: input.personId,
        email: account.email,
        status: account.status,
        role: input.role,
      };

      // Last statement in the transaction, so a concurrent retry waits on the
      // key's row lock rather than being answered `REQUEST_IN_FLIGHT` (section 22,
      // and CLAUDE.md, Write endpoints).
      await this.idempotency.completeWithin(trx, { ...claim, status: 201, body });

      return {
        body,
        message: {
          kind: 'ACTIVATION' as const,
          to: { email: account.email, name: person.fullName },
          token: token.token,
          expiresAt: token.expiresAt,
        },
      };
    });

    // **After the commit, and never fatal.** See the class docblock: a token
    // mailed for a rolled-back account invites somebody to activate nothing, and
    // raising here would contradict a completion the store already holds.
    await this.sendOrLog(outcome.message, outcome.body.id);

    return outcome.body;
  }

  /**
   * Re-sends the activation email, minting a fresh token (SKILL.md section 6).
   *
   * **The path section 6 step 3 lacked.** A delivery failure at provisioning left
   * an account nobody could reach: a second `POST /accounts` is refused because
   * the Person already has one, and the holder's only route was `forgot-password`,
   * which happens to work on a `PENDING_ACTIVATION` account and audits as a
   * password reset rather than an activation.
   *
   * Minting supersedes any outstanding activation token, per section 6 — so the
   * link from a first attempt that *did* arrive stops working. That is the right
   * way round: the reason to re-send is that the first one did not reach anybody.
   */
  async resendActivation(accountId: string, actor: Actor, claim: CurrentClaim): Promise<void> {
    const outcome = await this.db.transaction().execute(async (trx) => {
      const account = await trx
        .selectFrom('accounts')
        .select(['id', 'person_id', 'email', 'status'])
        .where('id', '=', accountId)
        .executeTakeFirst();

      if (!account) {
        throw new NotFoundError('No such account.');
      }

      const person = await this.people.forDecisionWithin(trx, account.person_id);

      if (!person) {
        // Unreachable: `accounts.person_id` is a foreign key. Checked because the
        // alternative is addressing an email to `undefined`.
        throw new NotFoundError('No such person.');
      }

      // Only an account that has never been activated. An `ACTIVE` holder who has
      // forgotten their password uses `forgot-password`; a `DISABLED` one is not
      // invited back in through an activation link, since section 6 makes
      // reactivation a separate authorized decision.
      if (account.status !== 'PENDING_ACTIVATION') {
        throw new InvariantViolationError('That account is not awaiting activation.', {
          account_id: accountId,
          status: account.status,
        });
      }

      const token = await this.tokens.mintWithin(
        trx,
        accountId,
        'ACTIVATION',
        ACTIVATION_LIFETIME_MS,
      );

      await this.audit.writeWithin(trx, {
        actorId: actor.accountId,
        action: 'account.activation_resent',
        targetType: 'account',
        targetId: accountId,
      });

      // **Last statement, like every other write endpoint** (CLAUDE.md, Write
      // endpoints). Omitted at first, which made this the only write in the API
      // that recorded no completion — and the omission was not a narrow window but
      // the designed path: this endpoint raises on a delivery failure, the
      // interceptor's `release` then matched because the row genuinely was
      // `IN_FLIGHT`, and the retry minted a second token and wrote a second audit
      // entry claiming a re-send.
      await this.idempotency.completeWithin(trx, { ...claim, status: 204, body: null });

      return {
        kind: 'ACTIVATION' as const,
        to: { email: account.email, name: person.fullName },
        token: token.token,
        expiresAt: token.expiresAt,
      };
    });

    // **Fatal here, unlike provisioning, and the difference is the point.** The
    // whole purpose of this endpoint is to deliver a message, so an operator must
    // learn that it failed rather than being told it succeeded. Nothing is
    // stranded by raising: the transaction has committed a token that a further
    // re-send will simply supersede.
    await this.email.send(outcome);
  }

  /** Sends, and turns a failure into a log line rather than a thrown error. */
  private async sendOrLog(message: OutboundEmail, accountId: string): Promise<void> {
    try {
      await this.email.send(message);
    } catch (error) {
      this.logger.error(
        `Account ${accountId} was created but its activation email could not be sent. Re-send it with POST /api/v1/accounts/${accountId}/activation-email.`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}

/**
 * The free Senior Pastor seat, or a refusal when both are held.
 *
 * Section 7 caps the role at two, and the 2026-08-21 ruling put the cap in a
 * partial unique index rather than a counting trigger — because `pg_restore
 * --disable-triggers` skips a trigger and does not skip an index. **This read is
 * therefore not the enforcement**; it exists so that the ordinary case answers
 * `INVARIANT_VIOLATION` rather than a raw constraint violation rendered as a 500.
 * Under a race the index still decides, and one of the two requests fails.
 */
async function freeSeniorPastorSlot(trx: Transaction<Database>): Promise<number> {
  const held = await trx
    .selectFrom('account_roles')
    .select('senior_pastor_slot')
    .where('role', '=', 'SENIOR_PASTOR')
    .where('revoked_at', 'is', null)
    .execute();

  const taken = new Set(held.map((row) => row.senior_pastor_slot));
  const free = [1, 2].find((slot) => !taken.has(slot));

  if (free === undefined) {
    throw new InvariantViolationError(
      'Both Senior Pastor seats are held. Revoke one first, which is how a succession is recorded.',
      { role: 'SENIOR_PASTOR' },
    );
  }

  return free;
}
