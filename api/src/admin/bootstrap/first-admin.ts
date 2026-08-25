/**
 * The first Admin account (SKILL.md section 6, The first Admin account).
 *
 * The reasoning for this existing at all is in `scripts/bootstrap-admin.ts`, which
 * is the only caller. What is here rather than there is everything that has to be
 * testable: a script is not, and section 6 carries rules — the refusal, the lock,
 * the null actor, the absent pastoral assignment — that would otherwise be stated
 * with nothing able to fail on them.
 *
 * Split for the same reason `admin/tree-import/tree-csv.ts` is split from its CLI,
 * and at the same seam: everything decidable lives in a module, and the script does
 * argument parsing, wiring and printing.
 */

import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';

import { normalizeEmail } from '../../auth/accounts.repository';

import type { AuditService } from '../../audit/audit.service';
import type { AccountTokensService } from '../../auth/account-tokens.service';
import type { Db } from '../../database/database.module';
import type { CivilStatus, NetworkName, Sex } from '../../database/schema';
import type { NetworksService } from '../../networks/networks.service';

/** Section 6 gives an activation token seven days, as ordinary provisioning does. */
export const ACTIVATION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Any 64-bit key will do; it only has to be the same one for every run. Named
 * rather than computed so a reader can see there is nothing behind the number.
 */
const BOOTSTRAP_LOCK_KEY = 4_198_205_711_001n;

export interface BootstrapInput {
  email: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  sex: Sex;
  civilStatus: CivilStatus;
}

export interface BootstrapResult {
  personId: string;
  memberId: string;
  accountId: string;
  email: string;
  network: NetworkName;
  /** The only copy. Nothing stored it; the row holds a hash (section 6). */
  activationToken: string;
  activationExpiresAt: Date;
}

/** Thrown where an account already exists, which is what makes this one-time. */
export class AlreadyBootstrappedError extends Error {
  constructor() {
    super(
      'An account already exists, so this is not a fresh installation. The first ' +
        'Admin is created once; provision further accounts through POST /api/v1/accounts, ' +
        'which is audited and names the Admin who did it.',
    );
    this.name = 'AlreadyBootstrappedError';
  }
}

/**
 * **The administrator this creates is never placed in the pastoral tree**, and the
 * option to place them was removed rather than left unused.
 *
 * It was there for an administrator the church disciples, and it could not work:
 * at the only moment this command may run there are zero accounts, and every
 * supported path that creates a Person requires one — so there is no Person to
 * name as a leader. Worse, it opened a pastoral edge with none of the checks
 * section 5 requires. `PeopleService.create` locks the leader and calls
 * `assertLeaderIsAssignable` first, and of the three things that catches, the
 * database backstops only the cross-Network one: **an archived or merged leader is
 * refused by application code alone**, which I verified by probing this schema.
 *
 * An administrator who is discipled is placed by an ordinary reassignment
 * afterwards, once there is an actor to perform it and a tree to place them in.
 *
 * **Writes rows rather than calling `PeopleService.create` and
 * `AccountProvisioningService.provision`**, which both require an actor and an
 * idempotency claim that do not exist yet.
 *
 * The first version of this file justified that by claiming the section 5
 * invariants are all constraint triggers and partial unique indexes, so a direct
 * write meets every one. **That was false**, and is recorded here rather than
 * quietly dropped: the database enforces three of the five — one active
 * assignment, no self-assignment, and the same-Network edge — while "both
 * endpoints in scope" and "no cycles" live in `hierarchy`, as `0001`'s own header
 * says. It is true of *this* path only because this path opens no pastoral edge at
 * all, which is the narrower claim and the one that holds.
 *
 * What is reused is everything a second implementation would drift from: email
 * normalization, token minting and hashing, the audit row shape, and the
 * sex-to-Network mapping.
 */
export async function bootstrapFirstAdmin(
  db: Db,
  services: {
    tokens: AccountTokensService;
    audit: AuditService;
    networks: NetworksService;
  },
  input: BootstrapInput,
): Promise<BootstrapResult> {
  const encodedAt = new Date();
  // Section 4: assigned from sex, never proposed, and taken from the module that
  // owns the mapping rather than restated here.
  const network = services.networks.networkForSex(input.sex);

  return db.transaction().execute(async (trx) => {
    // **Lock before looking.** Two runs would otherwise both find an empty table
    // and both create an Admin, which is the failure the refusal exists to
    // prevent. Transaction-scoped, so a failing path cannot leak it.
    await sql`SELECT pg_advisory_xact_lock(${BOOTSTRAP_LOCK_KEY})`.execute(trx);

    // "Any account", not "any Admin": a system already in use by somebody is not a
    // fresh installation, whatever roles it holds, and a narrower check would let
    // this mint an Admin into a live church's records.
    const existing = await trx.selectFrom('accounts').select('id').limit(1).executeTakeFirst();
    if (existing) {
      throw new AlreadyBootstrappedError();
    }

    const person = await trx
      .insertInto('persons')
      .values({
        id: randomUUID(),
        first_name: input.firstName,
        middle_name: input.middleName,
        last_name: input.lastName,
        // Section 3 makes a birthday optional and forbids inventing one. Nothing
        // here knows it, and a bootstrap is the last place to guess.
        birth_date: null,
        sex: input.sex,
        civil_status: input.civilStatus,
      })
      .returning(['id', 'member_id'])
      .executeTakeFirstOrThrow();

    // Section 4: Network follows from sex, effective-dated, stored rather than
    // derived on every query. `actor_id` is null for the same reason the audit
    // entries are — sections 3 and 4 permit it for a system action and for nothing
    // else.
    await trx
      .insertInto('network_assignments')
      .values({ person_id: person.id, network, actor_id: null, started_at: encodedAt })
      .execute();

    await trx
      .insertInto('person_lifecycle')
      .values({ person_id: person.id, state: 'CURRENT', actor_id: null, started_at: encodedAt })
      .execute();

    const account = await trx
      .insertInto('accounts')
      .values({
        person_id: person.id,
        email: input.email,
        // Through `normalizeEmail`, which trims as well as lowercasing. A second
        // implementation that dropped the trim would store a value no sign-in and
        // no password reset could ever match — and this command refuses to run
        // twice, so the installation would be unrecoverable.
        email_normalized: normalizeEmail(input.email),
        // Section 6: the holder sets their own password, and nobody else ever
        // knows it — which is why there is an activation token rather than a
        // value here.
        password_hash: null,
        status: 'PENDING_ACTIVATION',
      })
      .returning(['id', 'email'])
      .executeTakeFirstOrThrow();

    await trx
      .insertInto('account_roles')
      .values({
        account_id: account.id,
        role: 'ADMIN',
        // Section 7 permits null for the first Admin account, granted by a system
        // action. This is the only thing that may use it.
        granted_by: null,
        senior_pastor_slot: null,
      })
      .execute();

    const token = await services.tokens.mintWithin(
      trx,
      account.id,
      'ACTIVATION',
      ACTIVATION_LIFETIME_MS,
    );

    // Section 21 lists person creation, account creation and role changes
    // separately, so each is a separate entry — one describing everything would
    // hide two of them from a reader searching for either.
    await services.audit.writeWithin(trx, {
      actorId: null,
      action: 'person.created',
      targetType: 'person',
      targetId: person.id,
      after: {
        first_name: input.firstName,
        last_name: input.lastName,
        sex: input.sex,
        civil_status: input.civilStatus,
        network,
        pastoral_leader_id: null,
        bootstrap: true,
      },
    });

    await services.audit.writeWithin(trx, {
      actorId: null,
      action: 'account.created',
      targetType: 'account',
      targetId: account.id,
      after: { person_id: person.id, status: 'PENDING_ACTIVATION', bootstrap: true },
    });

    await services.audit.writeWithin(trx, {
      actorId: null,
      action: 'role.granted',
      targetType: 'account',
      targetId: account.id,
      after: { role: 'ADMIN', bootstrap: true },
    });

    return {
      personId: person.id,
      memberId: person.member_id,
      accountId: account.id,
      email: account.email,
      network,
      activationToken: token.token,
      activationExpiresAt: token.expiresAt,
    };
  });
}
