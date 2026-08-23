import { Inject, Injectable, Logger } from '@nestjs/common';

import { CapabilityDeniedError, ScopeDeniedError } from '../../common/errors/api-error';
import { DATABASE, type Db } from '../../database/database.module';
import { HierarchyService } from '../../hierarchy/hierarchy.service';
import { NetworksService } from '../../networks/networks.service';

import { isCapability, isReadCapability, type Capability } from './capabilities';
import { ROLE_DEFAULTS } from './role-defaults';
import { ScopeType, type Scope, type Target } from './scopes';

import type { AccountRole } from '../../database/schema';

export interface Actor {
  accountId: string;
  personId: string;
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
    private readonly hierarchy: HierarchyService,
    private readonly networks: NetworksService,
  ) {}

  /**
   * The roles the account currently holds.
   *
   * Authorization is decided by capability and scope, and this is the one rule
   * that is not: SKILL.md section 5 invariant 4 names **roles** — "Only Admin or
   * a Senior Pastor may do so" — because the rule is about who is outside the
   * pastoral incentive rather than about what anyone was granted. It is exposed
   * here rather than read from `account_roles` by the module that needs it,
   * because `auth` owns that table (section 2, Modules).
   */
  async rolesFor(accountId: string): Promise<AccountRole[]> {
    const rows = await this.db
      .selectFrom('account_roles')
      .select('role')
      .where('account_id', '=', accountId)
      .where('revoked_at', 'is', null)
      .execute();

    return rows.map((row) => row.role);
  }

  async grantsFor(accountId: string): Promise<EffectiveGrant[]> {
    const [roles, grants] = await Promise.all([
      this.db
        .selectFrom('account_roles')
        .select('role')
        .where('account_id', '=', accountId)
        .where('revoked_at', 'is', null)
        .execute(),
      this.db
        .selectFrom('capability_grants')
        .select(['capability', 'scope_type', 'scope_network', 'read_only'])
        .where('account_id', '=', accountId)
        .where('revoked_at', 'is', null)
        .execute(),
    ]);

    const effective: EffectiveGrant[] = [];

    for (const { role } of roles) {
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

    return effective;
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
   */
  async authorize(actor: Actor, capability: Capability, target: Target): Promise<void> {
    const grants = (await this.grantsFor(actor.accountId)).filter(
      (grant) => grant.capability === capability,
    );

    if (grants.length === 0) {
      throw new CapabilityDeniedError(`You do not hold ${capability}.`, { capability });
    }

    for (const grant of grants) {
      // The guard runs outside any transaction, so the pooled connection is the
      // right reader here. A caller re-checking scope *inside* a transaction —
      // section 5 invariant 1 after taking the person lock — passes its own.
      if (await this.scopeCovers(this.db, grant.scope, target, actor)) {
        return;
      }
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
  async covers(
    executor: Db,
    actor: Actor,
    capability: Capability,
    target: Target,
  ): Promise<boolean> {
    return this.coversWith(
      executor,
      actor,
      await this.grantsFor(actor.accountId),
      capability,
      target,
    );
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
   */
  async coversWith(
    executor: Db,
    actor: Actor,
    grants: readonly EffectiveGrant[],
    capability: Capability,
    target: Target,
  ): Promise<boolean> {
    for (const grant of grants.filter((held) => held.capability === capability)) {
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
