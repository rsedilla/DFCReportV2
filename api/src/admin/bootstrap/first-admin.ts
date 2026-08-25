/**
 * The first Admin account (SKILL.md section 6, The first Admin account).
 *
 * The reasoning for this existing at all is in `scripts/bootstrap-admin.ts`, which
 * is the only caller. What is here rather than there is everything that has to be
 * testable: a script is not, and section 6 now carries rules — the refusal, the
 * null actor, the absent pastoral assignment — that would otherwise be stated with
 * nothing able to fail on them.
 *
 * Split for the same reason `admin/tree-import/tree-csv.ts` is split from its CLI,
 * and the seam is in the same place: everything decidable lives in a module, and
 * the script does argument parsing, wiring and printing.
 */

import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';

import type { AuditService } from '../../audit/audit.service';
import type { AccountTokensService } from '../../auth/account-tokens.service';
import type { Db } from '../../database/database.module';
import type { CivilStatus, NetworkName, Sex } from '../../database/schema';

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
  /**
   * Null where the administrator is not part of the pastoral structure, which
   * section 5 invariant 3 permits as a correct permanent state. Never invented to
   * make a record look complete: a person placed in a tree they do not belong to
   * is counted in a subtree that does not contain them, and no report says so.
   */
  pastoralLeaderId: string | null;
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
 * Writes rows rather than calling `PeopleService.create` and
 * `AccountProvisioningService.provision`, which both require an actor and an
 * idempotency claim that do not exist yet.
 *
 * Section 2's rule that imports run through the domain services exists because a
 * script "bypasses every service-layer check" — but the section 5 invariants are
 * constraint triggers and partial unique indexes, and a direct write meets every
 * one of them. What is reused is everything where a second implementation would
 * drift: token minting and hashing, the audit row shape, and the sex-to-Network
 * mapping, all passed in by the caller.
 */
export async function bootstrapFirstAdmin(
  db: Db,
  services: { tokens: AccountTokensService; audit: AuditService },
  input: BootstrapInput,
  network: NetworkName,
): Promise<BootstrapResult> {
  const encodedAt = new Date();

  return db.transaction().execute(async (trx) => {
    // **Lock before looking.** Two runs would otherwise both find an empty table
    // and both create an Admin, which is the failure the refusal exists to
    // prevent. Transaction-scoped, so a failing path cannot leak it.
    await sql`SELECT pg_advisory_xact_lock(${BOOTSTRAP_LOCK_KEY})`.execute(trx);

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
    // derived on every query.
    await trx
      .insertInto('network_assignments')
      .values({ person_id: person.id, network, started_at: encodedAt })
      .execute();

    await trx
      .insertInto('person_lifecycle')
      .values({ person_id: person.id, state: 'CURRENT', actor_id: null, started_at: encodedAt })
      .execute();

    // **No pastoral assignment unless one was named.** Section 5 invariant 3
    // permits zero for an administrator outside the pastoral structure, and that
    // is correct and permanent rather than a gap. Where the administrator *is*
    // discipled, the edge is opened here and the same constraints govern it as
    // any other.
    if (input.pastoralLeaderId !== null) {
      await trx
        .insertInto('pastoral_assignments')
        .values({
          person_id: person.id,
          leader_id: input.pastoralLeaderId,
          root_network: null,
          started_at: encodedAt,
        })
        .execute();
    }

    const account = await trx
      .insertInto('accounts')
      .values({
        person_id: person.id,
        email: input.email,
        email_normalized: input.email.toLowerCase(),
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
    // separately, so each is a separate entry — and each carries a null actor,
    // which section 21 allows only for a system action.
    const systemEntry = { actorId: null, targetType: 'account' as const };

    await services.audit.writeWithin(trx, {
      ...systemEntry,
      action: 'person.created',
      targetType: 'person',
      targetId: person.id,
      after: {
        first_name: input.firstName,
        last_name: input.lastName,
        sex: input.sex,
        civil_status: input.civilStatus,
        network,
        pastoral_leader_id: input.pastoralLeaderId,
        bootstrap: true,
      },
    });

    await services.audit.writeWithin(trx, {
      ...systemEntry,
      action: 'account.created',
      targetId: account.id,
      after: { person_id: person.id, status: 'PENDING_ACTIVATION', bootstrap: true },
    });

    await services.audit.writeWithin(trx, {
      ...systemEntry,
      action: 'role.granted',
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
