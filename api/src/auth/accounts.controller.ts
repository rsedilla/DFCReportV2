import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';

import { Capability } from './authorization/capabilities';
import { RequiresCapability } from './authorization/authorization.decorators';
import {
  CurrentIdempotency,
  type CurrentClaim,
} from '../common/idempotency/current-idempotency.decorator';
import { AccountAccessService } from './account-access.service';
import { AccountProvisioningService } from './account-provisioning.service';
import { CurrentActor } from './current-actor.decorator';
import { SecondStepService } from './second-step.service';
import { CorrectAccountEmailDto, ProvisionAccountDto } from './dto/credentials.dto';

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
  constructor(
    private readonly provisioning: AccountProvisioningService,
    private readonly secondSteps: SecondStepService,
    private readonly access: AccountAccessService,
  ) {}

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

  /**
   * Whether a Person has an account, and its state (section 6, decision 0276): what the
   * person page's Account section shows an administrator. Guarded like provisioning,
   * against the Person.
   */
  @Get('for-person/:person_id')
  @RequiresCapability(Capability.AccountsManage, { kind: 'person', from: 'params.person_id' })
  async forPerson(@Param('person_id') personId: string): Promise<Record<string, unknown>> {
    return this.provisioning.accountForPerson(personId);
  }

  /**
   * Re-sends an activation email that did not arrive (section 6).
   *
   * The path provisioning needs in order to be allowed to survive a delivery
   * failure. Its target is the Account, which section 7 resolves through its
   * Person — and unlike provisioning that Person can be found, since the Account
   * exists by the time anybody calls this.
   */
  @Post(':id/activation-email')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequiresCapability(Capability.AccountsManage, { kind: 'account', from: 'params.id' })
  async resendActivation(
    @Param('id') id: string,
    @CurrentActor() actor: Actor,
    @CurrentIdempotency() claim: CurrentClaim,
  ): Promise<void> {
    await this.provisioning.resendActivation(id, actor, claim);
  }

  /**
   * Corrects the address of an account nobody has activated, and sends the activation
   * email there (section 6, decision 0300). Guarded like the re-send, against the Account.
   */
  @Post(':id/email')
  @HttpCode(HttpStatus.OK)
  @RequiresCapability(Capability.AccountsManage, { kind: 'account', from: 'params.id' })
  async correctEmail(
    @Param('id') id: string,
    @Body() body: CorrectAccountEmailDto,
    @CurrentActor() actor: Actor,
    @CurrentIdempotency() claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    return this.provisioning.correctEmail(id, body.email, actor, claim);
  }

  /**
   * Resets a Senior Pastor's second sign-in step, ending their sessions; they set it up
   * again at their next sign-in (section 6, decision 0302). An administrator's is refused
   * here and reset only on the server.
   */
  @Post(':id/second-step/reset')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequiresCapability(Capability.AccountsManage, { kind: 'account', from: 'params.id' })
  async resetSecondStep(
    @Param('id') id: string,
    @CurrentActor() actor: Actor,
    @CurrentIdempotency() claim: CurrentClaim,
  ): Promise<void> {
    await this.secondSteps.resetByAdministrator(id, actor, claim);
  }

  /**
   * Disables an account: every session ends at once, every activation and reset link
   * stops working, and its holder cannot sign in (section 6, decision 0307). The actor's
   * own account is refused.
   */
  @Post(':id/disable')
  @HttpCode(HttpStatus.OK)
  @RequiresCapability(Capability.AccountsManage, { kind: 'account', from: 'params.id' })
  async disable(
    @Param('id') id: string,
    @CurrentActor() actor: Actor,
    @CurrentIdempotency() claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    return { ...(await this.access.disable(id, actor, claim)) };
  }

  /**
   * Re-enables a disabled account, as active or as awaiting activation where no password
   * was ever set (section 6, decision 0307).
   */
  @Post(':id/reactivate')
  @HttpCode(HttpStatus.OK)
  @RequiresCapability(Capability.AccountsManage, { kind: 'account', from: 'params.id' })
  async reactivate(
    @Param('id') id: string,
    @CurrentActor() actor: Actor,
    @CurrentIdempotency() claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    return { ...(await this.access.reactivate(id, actor, claim)) };
  }
}
