import { Body, Controller, Post } from '@nestjs/common';

import { Capability } from './authorization/capabilities';
import { RequiresCapability } from './authorization/authorization.decorators';
import {
  CurrentIdempotency,
  type CurrentClaim,
} from '../common/idempotency/current-idempotency.decorator';
import { AccountProvisioningService } from './account-provisioning.service';
import { CurrentActor } from './current-actor.decorator';
import { ProvisionAccountDto } from './dto/credentials.dto';

import type { Actor } from './authorization/authorization.service';

/**
 * Provisioning, which is an administrative action on somebody else's Account
 * (SKILL.md section 22).
 *
 * Separate from `AuthController` deliberately. Everything under `/auth` is either
 * on section 7's closed unauthenticated list or acts solely on the caller's own
 * session, and that is what makes the prefix's exemption from the capability guard
 * readable in one place. This endpoint is neither, and it declares a capability.
 */
@Controller('accounts')
export class AccountsController {
  constructor(private readonly provisioning: AccountProvisioningService) {}

  /**
   * Creates an account, grants the role that qualifies it, and sends the
   * activation email (section 6, Account activation).
   *
   * Scope resolves through the Person, which is what section 7 says an Account
   * target does — but the Account does not exist yet, so the target is the Person
   * named in the body. `accounts.manage` is Whole Church and Admin-only, so the
   * scope check is not what carries this endpoint; the capability is.
   */
  @Post()
  @RequiresCapability(Capability.AccountsManage, { kind: 'person', from: 'body.person_id' })
  async provision(
    @Body() body: ProvisionAccountDto,
    @CurrentActor() actor: Actor,
    @CurrentIdempotency() claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    return this.provisioning.provision(
      { personId: body.person_id, email: body.email, role: body.role },
      actor,
      claim,
    );
  }
}
