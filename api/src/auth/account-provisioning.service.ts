import { Inject, Injectable } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import { InvariantViolationError, NotFoundError } from '../common/errors/api-error';
import { IdempotencyService } from '../common/idempotency/idempotency.service';
import { DATABASE, type Db } from '../database/database.module';
import { EMAIL_PORT, type EmailPort } from '../email/email.port';

import { AccountTokensService } from './account-tokens.service';
import { normalizeEmail } from './accounts.repository';
import { type Actor } from './authorization/authorization.service';

import type { CurrentClaim } from '../common/idempotency/current-idempotency.decorator';
import type { AccountRole } from '../database/schema';

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
 * are one transaction**, and the email is sent after it commits. Both halves of
 * that ordering matter and neither is obvious:
 *
 * - Sending inside the transaction would mail a token for an account that a later
 *   failure rolls back, so the holder receives an invitation to activate something
 *   that does not exist.
 * - Committing without sending leaves an account nobody can reach, which is why a
 *   delivery failure is not swallowed here — it is reported, and the operator
 *   re-sends rather than the leader waiting for mail that was dropped in silence.
 */
@Injectable()
export class AccountProvisioningService {
  constructor(
    @Inject(DATABASE) private readonly db: Db,
    @Inject(EMAIL_PORT) private readonly email: EmailPort,
    private readonly tokens: AccountTokensService,
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
      const person = await trx
        .selectFrom('persons')
        .select(['id', 'first_name', 'middle_name', 'last_name', 'merged_into_id'])
        .where('id', '=', input.personId)
        .executeTakeFirst();

      if (!person) {
        throw new NotFoundError('No such person.');
      }

      if (person.merged_into_id !== null) {
        throw new InvariantViolationError(
          'That person was absorbed by a merge. Use the surviving Person instead.',
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
        .values({ account_id: account.id, role: input.role, granted_by: actor.accountId })
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
          to: {
            email: account.email,
            name: [person.first_name, person.middle_name, person.last_name]
              .filter((part) => part !== null && part !== '')
              .join(' '),
          },
          token: token.token,
          expiresAt: token.expiresAt,
        },
      };
    });

    // **After the commit, deliberately.** See the class docblock: a token mailed
    // for a rolled-back account invites somebody to activate nothing.
    await this.email.send(outcome.message);

    return outcome.body;
  }
}
