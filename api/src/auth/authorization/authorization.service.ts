import { Inject, Injectable, Logger } from '@nestjs/common';

import { CapabilityDeniedError, ScopeDeniedError } from '../../common/errors/api-error';
import { APP_CONFIG, type AppConfig } from '../../config/configuration';
import { DATABASE, type Db } from '../../database/database.module';
import { HierarchyService } from '../../hierarchy/hierarchy.service';
import { NetworksService } from '../../networks/networks.service';

import { isCapability, isReadCapability, type Capability } from './capabilities';
import { isGrantMaking } from './grant-making';
import { ROLE_DEFAULTS } from './role-defaults';
import { ScopeType, type Scope, type Target } from './scopes';
import { isNamedSeniorPastor } from './senior-pastors';
import { grantCoversNothing } from './single-scope';

import type { AccountRole } from '../../database/schema';

export interface Actor {
  accountId: string;
  personId: string;
}

/**
 * Everything about an account that decides authority, read once and passed on.
 *
 * It carries its own `accountId` so that it cannot be applied to a decision about
 * a different actor.
 */
export interface ActorAuthority {
  accountId: string;
  roles: readonly AccountRole[];
  grants: readonly EffectiveGrant[];
}

interface ActiveRoles {
  /** Roles whose row this system honours; the source of role defaults. */
  honoured: AccountRole[];
  /** Every active role row, honoured or not. See `activeRoles` for why both. */
  held: AccountRole[];
}

export interface EffectiveGrant {
  capability: Capability;
  scope: Scope;
  /** Where the authority came from, for diagnosing a denial. */
  source: 'role' | 'grant';
  /**
   * Null for authority carried by a role.
   *
   * SKILL.md section 7 defines `read_only` as a column on `capability_grants`
   * and says what it means there: the visible difference between letting someone
   * see a Network and letting them change it, on a scope widened beyond a
   * leader's normal management scope. It says nothing about the flag on a role
   * default, and inventing a value here would put a rule the specification does
   * not contain into every /auth/me response for a client to branch on.
   */
  readOnly: boolean | null;
}

/**
 * Identity + Permission + Pastoral Scope = Access (SKILL.md section 7).
 *
 * An account's effective authority is the union of the defaults of the roles it
 * holds and any capability granted to it explicitly. Authority only widens: there
 * is no mechanism for narrowing a role default on one account, and none is
 * needed, because removing the role or disabling the account is the answer.
 *
 * An account with no matching row is denied. The absence of a grant is a denial,
 * never a default allow.
 */
@Injectable()
export class AuthorizationService {
  private readonly logger = new Logger(AuthorizationService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Db,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly hierarchy: HierarchyService,
    private readonly networks: NetworksService,
  ) {}

  /**
   * The account's active roles, in two lists: those whose row this system honours,
   * and every row it holds.
   *
   * **The single reader of `account_roles` in this service, and that is the
   * point.** There were two — one for the roles an account holds, one inside
   * `grantsFor` for the defaults they carry — and a rule applied to one of them and
   * not the other is invisible: the account would be outside a role's defaults
   * while still counting as holding the role for the checks section 5 decides by
   * role, or the reverse. One reader means the question is asked once.
   *
   * Roles are exposed at all, rather than read from `account_roles` by the module
   * that needs them, for two reasons. `auth` owns that table (section 2, Modules).
   * And authorization is decided by capability and scope everywhere but one place:
   * section 5 invariant 4 names **roles** — "Only Admin or a Senior Pastor may do
   * so" — because that rule is about who sits outside the pastoral incentive rather
   * than about what anyone was granted. Today they reach `hierarchy` on
   * `ActorAuthority`, which {@link effective} builds from this — though
   * `assertMayReparent` takes only a person and a role list, so that is a fact
   * about its two call sites rather than a seam anything enforces.
   *
   * Today it refuses exactly one thing: a `SENIOR_PASTOR` row on an account whose
   * Person is not one of the two section 4 names (`senior-pastors.ts`). Such a row
   * cannot be created through provisioning, so reaching this means it arrived by
   * some route that skipped that check — which is the route a `pg_restore` takes,
   * and the reason section 7 puts the identity half on the path every request
   * follows rather than only at the write.
   */
  private async activeRoles(executor: Db, accountId: string): Promise<ActiveRoles> {
    const rows = await executor
      .selectFrom('account_roles')
      .innerJoin('accounts', 'accounts.id', 'account_roles.account_id')
      .select(['account_roles.role', 'accounts.person_id'])
      .where('account_roles.account_id', '=', accountId)
      .where('account_roles.revoked_at', 'is', null)
      .execute();

    return {
      honoured: rows
        .filter((row) => this.roleIsHonoured(accountId, row.role, row.person_id))
        .map((row) => row.role),
      // **Held, honoured or not**, and the distinction is load-bearing for exactly
      // one rule. Section 7 refuses a grant-making capability to an account
      // *holding* a `SENIOR_PASTOR` row, and the database refuses that pair on the
      // row rather than on whether configuration honours it. Deciding it here on
      // the honoured list instead would let the two enforcement points disagree:
      // configuration lost, the database still refuses the write while the
      // application honours the grant.
      held: rows.map((row) => row.role),
    };
  }

  /** Whether a role row grants what it appears to (SKILL.md section 7). */
  private roleIsHonoured(accountId: string, role: AccountRole, personId: string): boolean {
    if (role !== 'SENIOR_PASTOR') {
      return true;
    }

    if (isNamedSeniorPastor(personId, this.config.seniorPastorPersonIds)) {
      return true;
    }

    // Logged at `error`, because there are only two ways to reach it and both are
    // worth an operator's attention: a role row that never passed provisioning, or
    // configuration that has lost the identifiers. The second is the accepted cost
    // of failing closed (section 7) and looks exactly like the first from here,
    // which is why the message names both rather than guessing.
    this.logger.error(
      `Account ${accountId} holds SENIOR_PASTOR and its Person ${personId} is not one SKILL.md section 4 names. ` +
        'It grants nothing. Either the row bypassed provisioning, or SENIOR_PASTOR_PERSON_IDS is unset or wrong.',
    );

    return false;
  }

  /**
   * The roles this system honours for an account, read through a caller's
   * executor.
   *
   * **For a check that must not read a fact its caller supplied.** `authorityFor`
   * returns an `ActorAuthority`, which is plain data — fine for `coversWith`, whose
   * caller is the guard that just read it, and not fine for a service refusing a
   * *caller*: `PeopleImportService` is exported, so a module injecting it could
   * hand over `{ roles: ['ADMIN'] }` and satisfy any check made against that value.
   * A check reading `account_roles` cannot be answered by its caller.
   *
   * The executor is the parameter rather than the pool because that caller decides
   * inside its own transaction, where a pooled read asks a bounded pool for a
   * second connection (section 24) — the split `coversWith` and
   * `SettingsService.initialEncodingOpenWithin` already use.
   *
   * Honoured rather than held, which is the fail-closed half: a `SENIOR_PASTOR` row
   * this system refuses to honour must not satisfy a role check (section 7). The
   * *held* list exists for one rule that needs the opposite, and that rule is not
   * this one.
   */
  async honouredRolesWithin(executor: Db, accountId: string): Promise<AccountRole[]> {
    return (await this.activeRoles(executor, accountId)).honoured;
  }

  async grantsFor(accountId: string): Promise<EffectiveGrant[]> {
    return (await this.effective(accountId)).grants;
  }

  /**
   * An account's roles and the authority they and its explicit grants carry, from
   * one read of each table.
   *
   * `authorityFor` needs both and used to ask for them separately, which read
   * `account_roles` twice — harmless while the second read was free, and no longer
   * free now that a row this system refuses to honour is logged where it is
   * refused.
   *
   * **It halved that method's contribution and not the request's**, and the rule
   * is one line per call rather than any fixed number per request. A request makes
   * one call for each authorization read it takes: the guard's `authorize` always,
   * plus whatever its domain layer asks for. `POST /accounts` takes none beyond the
   * guard and so logs once; an unbackdated reassignment adds `authorityFor` for
   * section 5 invariant 1, and went from three lines to two; a backdated one adds a
   * second `authorize` for `records.backdate_effective_date`. A sex correction takes
   * one more than the reassignment of the same kind, for its Whole Church check —
   * three unbackdated and four backdated, rather than continuing the sequence above.
   *
   * *Two earlier versions of this paragraph each gave a count — "two per request",
   * then "twice regardless" — and both were exactly right for the one path they
   * were written from and wrong for every other. Counting a mechanism from the call
   * site in front of you is the fault this file's neighbourhood keeps recording.*
   *
   * The volume is nonetheless bounded rather than merely small: the partial unique
   * index permits at most two active `SENIOR_PASTOR` rows, so at most two accounts
   * can produce this line at all.
   */
  private async effective(
    accountId: string,
  ): Promise<{ roles: AccountRole[]; grants: EffectiveGrant[] }> {
    const [roles, grants] = await Promise.all([
      this.activeRoles(this.db, accountId),
      this.db
        .selectFrom('capability_grants')
        .select(['capability', 'scope_type', 'scope_network', 'read_only'])
        .where('account_id', '=', accountId)
        .where('revoked_at', 'is', null)
        .execute(),
    ]);

    const effective: EffectiveGrant[] = [];

    for (const role of roles.honoured) {
      for (const [capability, scopeType] of Object.entries(ROLE_DEFAULTS[role])) {
        effective.push({
          capability: capability as Capability,
          scope: { type: scopeType, network: null },
          source: 'role',
          readOnly: null,
        });
      }
    }

    for (const grant of grants) {
      if (!isCapability(grant.capability)) {
        // Unreachable while the `capability` type and this enumeration agree, and
        // logged rather than ignored if they ever stop agreeing.
        this.logger.error(
          `capability_grants holds "${grant.capability}", which is not a capability in SKILL.md section 7. Ignoring it.`,
        );
        continue;
      }

      if (roles.held.includes('SENIOR_PASTOR') && isGrantMaking(grant.capability)) {
        // **Section 7: the grant-making pair is never held by a Senior Pastor**,
        // by role or by grant. Migration 0006 refuses the write from both sides,
        // and this is the second enforcement point that section requires for the
        // same reason it gives for the identity check and for preferring an index
        // to a counting trigger: `pg_restore --disable-triggers` skips a constraint
        // trigger entirely, so a rule enforced only by one is a rule a restore can
        // load straight past.
        //
        // Decided on the role **row** rather than on an honoured role, so that this
        // and the database refuse the same states. See `activeRoles`.
        this.logger.error(
          `Account ${accountId} holds SENIOR_PASTOR and a grant of "${grant.capability}", which SKILL.md section 7 forbids together. Ignoring the grant.`,
        );
        continue;
      }

      if (grant.read_only && !isReadCapability(grant.capability)) {
        // The database rejects this row at creation. Should one exist anyway, it
        // grants nothing rather than silently granting a write.
        this.logger.error(
          `capability_grants holds a read-only grant of the write capability "${grant.capability}" for account ${accountId}. Ignoring it.`,
        );
        continue;
      }

      effective.push({
        capability: grant.capability,
        scope: { type: grant.scope_type, network: grant.scope_network },
        source: 'grant',
        readOnly: grant.read_only,
      });
    }

    return { roles: roles.honoured, grants: effective };
  }

  /**
   * Throws unless the actor holds `capability` over `target`.
   *
   * `CAPABILITY_DENIED` and `SCOPE_DENIED` are deliberately distinct, because the
   * two are independent grants and an administrator diagnosing a permission
   * problem needs to know which half failed.
   *
   * This is not the whole check. Several operations impose further conditions
   * that a capability and a scope cannot express, because they concern objects
   * other than the primary target: section 5 requires a reassignment's source and
   * destination leader both to be in scope, and forbids the actor acting on
   * themselves or on anyone upline of them. Those live in the owning module's
   * domain layer, additional to this and never a substitute for it.
   *
   * **A grant that covers nothing is skipped in the scope half, not the capability
   * half.** Section 7 gives some capabilities one scope, and a grant of one at
   * anything narrower covers nothing (`single-scope.ts`). An earlier version
   * dropped those grants in `grantsFor`, which was wrong in a way only an existing
   * test caught: the account then looks as though it does not hold the capability
   * at all, and the refusal becomes `CAPABILITY_DENIED`.
   *
   * The 2026-08-23 ruling says `SCOPE_DENIED`, and it is right for the reason
   * above — an administrator diagnosing this issued a grant with the wrong
   * **scope**, and `CAPABILITY_DENIED` would send them to add a capability they
   * had already granted.
   */
  async authorize(actor: Actor, capability: Capability, target: Target): Promise<void> {
    const grants = (await this.grantsFor(actor.accountId)).filter(
      (grant) => grant.capability === capability,
    );

    if (grants.length === 0) {
      throw new CapabilityDeniedError(`You do not hold ${capability}.`, { capability });
    }

    let coveredNothing = false;

    for (const grant of grants) {
      if (grantCoversNothing(capability, grant.scope.type)) {
        coveredNothing = true;
        continue;
      }

      // The guard runs outside any transaction, so the pooled connection is the
      // right reader here. A caller re-checking scope *inside* a transaction —
      // section 5 invariant 1 after taking the person lock — passes its own.
      if (await this.scopeCovers(this.db, grant.scope, target, actor)) {
        return;
      }
    }

    if (coveredNothing) {
      // **A different message, because "not over this record" would be a lie.** It
      // says another target would work; for a capability section 7 gives at Whole
      // Church only, none would. An administrator reading the generic wording goes
      // looking for the right record, and the thing to fix is the grant.
      throw new ScopeDeniedError(
        `You hold ${capability}, but section 7 grants it at Whole Church only and yours is narrower. It covers no record at all.`,
        { capability, required_scope: ScopeType.WholeChurch },
      );
    }

    throw new ScopeDeniedError(`You hold ${capability}, but not over this record.`, {
      capability,
      target_kind: target.kind,
    });
  }

  /**
   * Whether the actor holds `capability` over `target` — the same question
   * `authorize` asks, answered rather than thrown.
   *
   * SKILL.md section 5 invariant 1 needs it: a reassignment has a source and a
   * destination and the actor must be authorized for **both**, which is two
   * objects and one grant. The guard evaluates the request's primary target and
   * the owning module checks the rest (section 7), and the rest needs a predicate.
   *
   * Deliberately not a second way to authorize an endpoint. `authorize` remains
   * what a guard calls, because a guard that has to remember to throw is the
   * failure section 2 chose a fail-closed framework to avoid.
   */
  async covers(actor: Actor, capability: Capability, target: Target): Promise<boolean> {
    return this.coversWith(
      this.db,
      actor,
      await this.authorityFor(actor.accountId),
      capability,
      target,
    );
  }

  /**
   * An account's roles and grants, read together.
   *
   * Returned as one value carrying the account it was read for, so that
   * `coversWith` can refuse authority belonging to somebody else. That predicate
   * is what SKILL.md section 5 invariant 1 rests on and it *answers* rather than
   * throwing, so a caller handing it the wrong account's authority would get a
   * quiet yes — the kind of mistake `completeWithin`'s transaction parameter is
   * typed to make unrepresentable rather than merely absent.
   */
  async authorityFor(accountId: string): Promise<ActorAuthority> {
    return { accountId, ...(await this.effective(accountId)) };
  }

  /**
   * The same question, against grants the caller has already read.
   *
   * **This exists so that a caller inside a transaction touches the pool exactly
   * never.** `grantsFor` reads two tables on the pooled connection, and a pooled
   * read taken while holding a transaction asks a bounded pool for a second
   * connection — which SKILL.md section 24 names as a liveness hazard, because the
   * wait is unbounded and every waiter is holding a connection of its own.
   *
   * The split is along the right seam rather than a convenient one. An account's
   * grants are a fact about the account and cannot change under a tree write, so
   * reading them before the transaction costs nothing in correctness; *scope* is a
   * fact about the tree, and that is the half that has to see the transaction.
   *
   * `covers` above deliberately takes **no** executor. It reads grants on the pool
   * and so can never be honoured inside a transaction; a signature accepting one
   * would invite exactly the call this method exists to make possible, and would
   * silently fail to deliver it.
   */
  async coversWith(
    executor: Db,
    actor: Actor,
    authority: ActorAuthority,
    capability: Capability,
    target: Target,
  ): Promise<boolean> {
    if (authority.accountId !== actor.accountId) {
      // Unreachable through any call site, and checked because this predicate
      // decides authority and answers rather than throws.
      throw new Error(
        `Authority for account ${authority.accountId} was offered for a decision about ${actor.accountId}.`,
      );
    }

    for (const grant of authority.grants.filter((held) => held.capability === capability)) {
      if (grantCoversNothing(capability, grant.scope.type)) {
        continue;
      }

      if (await this.scopeCovers(executor, grant.scope, target, actor)) {
        return true;
      }
    }

    return false;
  }

  private async scopeCovers(
    executor: Db,
    scope: Scope,
    target: Target,
    actor: Actor,
  ): Promise<boolean> {
    if (scope.type === ScopeType.WholeChurch) {
      return true;
    }

    // A church-wide object -- a setting is the example -- is never in scope at any
    // narrower value than Whole Church (section 7).
    if (target.kind === 'church') {
      return false;
    }

    const personId = await this.personBehind(executor, target);
    if (personId === null) {
      return false;
    }

    switch (scope.type) {
      case ScopeType.OwnSubtree:
        return this.hierarchy.isWithinSubtree(executor, actor.personId, personId, {
          includeSelf: true,
        });
      case ScopeType.SubtreeExclSelf:
        return this.hierarchy.isWithinSubtree(executor, actor.personId, personId, {
          includeSelf: false,
        });
      case ScopeType.Network: {
        if (scope.network === null) {
          // The database requires a Network to be named on a NETWORK grant. An
          // unnamed one covers nothing rather than covering everything.
          return false;
        }
        const network = await this.networks.currentNetwork(executor, personId);
        return network !== null && network === scope.network;
      }
    }
  }

  /** An Account resolves through its Person; a Person is already one (section 7). */
  private async personBehind(
    executor: Db,
    target: Exclude<Target, { kind: 'church' }>,
  ): Promise<string | null> {
    if (target.kind === 'person') {
      return target.personId;
    }

    const account = await executor
      .selectFrom('accounts')
      .select('person_id')
      .where('id', '=', target.accountId)
      .executeTakeFirst();

    return account?.person_id ?? null;
  }
}
