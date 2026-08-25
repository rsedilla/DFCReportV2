/**
 * The first Admin account (SKILL.md section 6, The first Admin account).
 *
 * The reasoning for this existing at all is in `scripts/bootstrap-admin.ts`, which
 * is the only caller. What is here rather than there is everything that has to be
 * testable: a script is not, and section 6 carries rules — the refusal, the lock,
 * the null actor, the absent pastoral assignment — that would otherwise be stated
 * with nothing able to fail on them.
 *
 * **It writes no table itself**, which is the whole shape of this file. The first
 * version inserted into `persons`, `person_lifecycle`, `network_assignments`,
 * `accounts` and `account_roles` directly, justified against section 2's *imports*
 * rule — a different sentence from "a module owns its tables. No other module
 * reads or writes them directly", which carries no exemption and which this
 * repository defended once already at the cost of restructuring the module graph
 * (2026-08-24, the authorization seam).
 *
 * So each write goes to the module that owns the table:
 * `PeopleService.createSystemAdministratorWithin`, which opens the Network row
 * through `networks` in turn; `AccountProvisioningService.createFirstAdminWithin`;
 * and `AuditService`. What is left here is the part that belongs to nobody else —
 * the lock, the refusal, and the order.
 */

import { sql } from 'kysely';

import type { AuditService } from '../../audit/audit.service';
import type { AccountProvisioningService } from '../../auth/account-provisioning.service';
import type { Db } from '../../database/database.module';
import type { CivilStatus, NetworkName, Sex } from '../../database/schema';
import type { PeopleService } from '../../people/people.service';

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
 * at the only moment this may run there are zero accounts, and every supported
 * path that creates a Person requires one — so there is no Person to name as a
 * leader. Worse, it opened a pastoral edge with none of the checks section 5
 * requires. `PeopleService.create` locks the leader and calls
 * `assertLeaderIsAssignable` first, and of the three things that catches, the
 * database backstops only the cross-Network one: **an archived or merged leader is
 * refused by application code alone**, which I verified by probing this schema.
 *
 * An administrator who is discipled is placed by an ordinary reassignment
 * afterwards, once there is an actor to perform it and a tree to place them in.
 */
export async function bootstrapFirstAdmin(
  db: Db,
  modules: {
    people: PeopleService;
    accounts: AccountProvisioningService;
    audit: AuditService;
  },
  input: BootstrapInput,
): Promise<BootstrapResult> {
  const encodedAt = new Date();

  return db.transaction().execute(async (trx) => {
    // **Lock before looking.** Two runs would otherwise both find an empty table
    // and both create an Admin, which is the failure the refusal exists to
    // prevent. Transaction-scoped, so a failing path cannot leak it.
    //
    // **This is a third path that depends on READ COMMITTED** (section 24, which
    // names only the Network change and the reassignment). The lock statement is
    // snapshot-taking, so under REPEATABLE READ the snapshot would be fixed before
    // the lock is granted and the loser would read a pre-lock `accounts` — and
    // there is no unique constraint behind this to catch what follows. Recorded
    // because the 2026-08-23 ruling's whole argument was that the dependency is
    // invisible while unstated.
    await sql`SELECT pg_advisory_xact_lock(${BOOTSTRAP_LOCK_KEY})`.execute(trx);

    // "Any account", not "any Admin": a system already in use by somebody is not a
    // fresh installation, whatever roles it holds, and a narrower check would let
    // this mint an Admin into a live church's records.
    const existing = await trx.selectFrom('accounts').select('id').limit(1).executeTakeFirst();
    if (existing) {
      throw new AlreadyBootstrappedError();
    }

    const person = await modules.people.createSystemAdministratorWithin(trx, {
      firstName: input.firstName,
      middleName: input.middleName,
      lastName: input.lastName,
      sex: input.sex,
      civilStatus: input.civilStatus,
      encodedAt,
    });

    const account = await modules.accounts.createFirstAdminWithin(trx, {
      personId: person.id,
      email: input.email,
    });

    // Section 21 lists person creation, account creation and role changes
    // separately, so each is a separate entry — one describing everything would
    // hide two of them from a reader searching for either. Each carries a null
    // actor, which section 21 allows for a system action and for nothing else.
    await modules.audit.writeWithin(trx, {
      actorId: null,
      action: 'person.created',
      targetType: 'person',
      targetId: person.id,
      // Section 21 wants the values, not merely that it happened — an entry
      // recording only the identifiers cannot answer what was created. A first
      // version omitted `middle_name` and `member_id`, so an administrator created
      // with a middle name had it in `persons` and in no audit entry.
      after: {
        member_id: person.memberId,
        first_name: input.firstName,
        middle_name: input.middleName,
        last_name: input.lastName,
        birth_date: null,
        sex: input.sex,
        civil_status: input.civilStatus,
        network: person.network,
        pastoral_leader_id: null,
        bootstrap: true,
      },
    });

    await modules.audit.writeWithin(trx, {
      actorId: null,
      action: 'account.created',
      targetType: 'account',
      targetId: account.id,
      after: { person_id: person.id, status: 'PENDING_ACTIVATION', bootstrap: true },
    });

    await modules.audit.writeWithin(trx, {
      actorId: null,
      action: 'role.granted',
      targetType: 'account',
      targetId: account.id,
      after: { role: 'ADMIN', bootstrap: true },
    });

    return {
      personId: person.id,
      memberId: person.memberId,
      accountId: account.id,
      email: account.email,
      network: person.network,
      activationToken: account.activationToken,
      activationExpiresAt: account.activationExpiresAt,
    };
  });
}
