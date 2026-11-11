import { Inject, Injectable } from '@nestjs/common';

import { ScopeDeniedError } from '../common/errors/api-error';
import { DATABASE, type Db } from '../database/database.module';

import { AuthorizationService, type Actor } from './authorization/authorization.service';
import { Capability } from './authorization/capabilities';

import type { NetworkName } from '../database/schema';

/**
 * Which accounts a holder of `accounts.manage` or `roles.manage` short of Whole Church reaches
 * (SKILL.md section 7, *The Network Admin*, decision 0469).
 *
 * The guard has already placed the account's Person in the actor's Network. These are the
 * domain checks that narrow it further, each refused `SCOPE_DENIED` because each concerns the
 * actor's authority over the target. A Whole Church holder passes every one.
 */
@Injectable()
export class AccountReachService {
  constructor(
    @Inject(DATABASE) private readonly db: Db,
    private readonly authorization: AuthorizationService,
  ) {}

  /**
   * How wide the actor holds a capability: null for the whole church, one Network otherwise.
   * A holder over neither is refused.
   */
  async reachOf(actor: Actor, capability: Capability): Promise<NetworkName | null> {
    const reach = await this.authorization.wideReachOf(actor, capability);

    if (reach === undefined) {
      throw new ScopeDeniedError('Those accounts are outside your scope.', {});
    }

    return reach;
  }

  /**
   * Refuses an account that holds anything but `LEADER` alone, the actor's own included, and
   * a Network root's account whatever it holds, to an actor short of Whole Church.
   */
  async assertReachesAccount(
    actor: Actor,
    accountId: string,
    capability: Capability = Capability.AccountsManage,
  ): Promise<void> {
    if ((await this.reachOf(actor, capability)) === null) {
      return;
    }

    const roles = await this.db
      .selectFrom('account_roles')
      .select('role')
      .where('account_id', '=', accountId)
      .where('revoked_at', 'is', null)
      .execute();

    if (roles.length !== 1 || roles[0].role !== 'LEADER') {
      throw new ScopeDeniedError('That account is not a Leader account of your Network.', {
        account_id: accountId,
      });
    }

    const account = await this.db
      .selectFrom('accounts')
      .select('person_id')
      .where('id', '=', accountId)
      .executeTakeFirst();

    if (account && (await this.authorization.holdsRootSeat(account.person_id))) {
      throw new ScopeDeniedError('A Network root’s account is the Admin’s to manage.', {
        account_id: accountId,
      });
    }
  }

  /**
   * The Persons whose accounts a list leaves out for an actor short of Whole Church: the
   * Network roots. None for a Whole Church holder.
   */
  async personsOutsideReach(reach: NetworkName | null): Promise<string[]> {
    return reach === null ? [] : this.authorization.rootSeatHolders();
  }

  /**
   * Refuses, to an actor short of Whole Church, a Person who is a Network root or whose
   * account is not a Leader account: a root is read and never changed, with or without an
   * account, and any other account is neither listed for them nor touched.
   */
  async assertReachesPerson(actor: Actor, personId: string): Promise<void> {
    if ((await this.reachOf(actor, Capability.AccountsManage)) === null) {
      return;
    }

    if (await this.authorization.holdsRootSeat(personId)) {
      throw new ScopeDeniedError('A Network root’s account is the Admin’s to manage.', {
        person_id: personId,
      });
    }

    const account = await this.db
      .selectFrom('accounts')
      .select('id')
      .where('person_id', '=', personId)
      .executeTakeFirst();

    if (account) {
      await this.assertReachesAccount(actor, account.id);
    }
  }
}
