import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { Capability } from './authorization/capabilities';
import { RequiresCapability } from './authorization/authorization.decorators';
import {
  CurrentIdempotency,
  type CurrentClaim,
} from '../common/idempotency/current-idempotency.decorator';
import { ScopeDeniedError } from '../common/errors/api-error';
import { AccountAccessService } from './account-access.service';
import { AccountReachService } from './account-reach.service';
import { AccountProvisioningService } from './account-provisioning.service';
import { AccountsListService } from './accounts-list.service';
import { decodeRosterCursor, encodeRosterCursor } from '../common/roster-cursor';
import { CredentialsService } from './credentials.service';
import { CurrentActor } from './current-actor.decorator';
import { SecondStepService } from './second-step.service';
import {
  CorrectAccountEmailDto,
  CreateNetworkAdminDto,
  ProvisionAccountDto,
  SetApprovesCellsDto,
  SetFullViewDto,
  SetMovesPeopleDto,
} from './dto/credentials.dto';
import { AccountsListDto } from './dto/accounts-list.dto';

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
    private readonly credentials: CredentialsService,
    private readonly accountsList: AccountsListService,
    private readonly reach: AccountReachService,
  ) {}

  /**
   * Creates an account, grants the role that qualifies it, and sends the
   * activation email (section 6, Account activation).
   *
   * Scope resolves through the Person, which is what section 7 says an Account
   * target does — but the Account does not exist yet, so the target is the Person
   * named in the body.
   *
   * **A Network Admin gives a Leader account and no other** (section 7, decision 0469), to a
   * Person of their Network who is not its root.
   */
  @Post()
  @RequiresCapability(Capability.AccountsManage, { kind: 'person', from: 'body.person_id' })
  async provision(
    @Body() body: ProvisionAccountDto,
    @CurrentActor() actor: Actor,
    @CurrentIdempotency() claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    if ((await this.reach.reachOf(actor, Capability.AccountsManage)) !== null) {
      if (body.role !== 'LEADER') {
        throw new ScopeDeniedError('You give Leader accounts only.', { role: body.role });
      }
      await this.reach.assertReachesPerson(actor, body.person_id);
    }

    return this.provisioning.provision(
      { personId: body.person_id, email: body.email, role: body.role },
      actor,
      claim,
    );
  }

  /**
   * Creates a Person and a `NETWORK_ADMIN` account together (section 7, decision 0469). A
   * church target, so only a Whole Church holder of `accounts.manage` reaches it.
   */
  @Post('network-admin')
  @RequiresCapability(Capability.AccountsManage, { kind: 'church' })
  async provisionNetworkAdmin(
    @Body() body: CreateNetworkAdminDto,
    @CurrentActor() actor: Actor,
    @CurrentIdempotency() claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    return this.provisioning.provisionNetworkAdmin(
      {
        title: body.title ?? null,
        firstName: body.first_name,
        middleName: body.middle_name ?? null,
        lastName: body.last_name,
        birthDate: body.birth_date_not_given === true ? null : (body.birth_date ?? null),
        sex: body.sex,
        civilStatus: body.civil_status,
        mobileNumber: body.mobile_number_not_given === true ? null : (body.mobile_number ?? null),
        acknowledgedDuplicateIds: body.acknowledged_duplicate_ids ?? [],
        email: body.email,
      },
      actor,
      claim,
    );
  }

  /**
   * Every account, for the Admin area's Accounts tab (sections 19 and 22, decision 0419).
   *
   * Every account for a Whole Church holder of `accounts.manage`. A Network Admin reads the
   * Leader accounts of their own Network (decision 0469), and a holder over neither is refused.
   */
  @Get()
  @RequiresCapability(Capability.AccountsManage, { kind: 'held' })
  async list(
    @Query() query: AccountsListDto,
    @CurrentActor() actor: Actor,
  ): Promise<Record<string, unknown>> {
    const network = await this.reach.reachOf(actor, Capability.AccountsManage);
    const { rows, nextCursor } = await this.accountsList.list({
      network,
      without: await this.reach.personsOutsideReach(network),
      q: query.q ?? null,
      filter: query.filter ?? 'ALL',
      limit: query.limit ?? 50,
      cursor: decodeRosterCursor(query.cursor),
    });
    return { data: rows, next_cursor: encodeRosterCursor(nextCursor) };
  }

  /** How many accounts each filter of the list holds (decision 0419), guarded as the list is. */
  @Get('counts')
  @RequiresCapability(Capability.AccountsManage, { kind: 'held' })
  async counts(@CurrentActor() actor: Actor): Promise<Record<string, unknown>> {
    const network = await this.reach.reachOf(actor, Capability.AccountsManage);
    return this.accountsList.counts(network, await this.reach.personsOutsideReach(network));
  }

  /**
   * Whether a Person has an account, and its state (section 6, decision 0276): what the
   * person page's Account section shows an administrator. Guarded like provisioning,
   * against the Person.
   */
  @Get('for-person/:person_id')
  @RequiresCapability(Capability.AccountsManage, { kind: 'person', from: 'params.person_id' })
  async forPerson(
    @Param('person_id') personId: string,
    @CurrentActor() actor: Actor,
  ): Promise<Record<string, unknown>> {
    await this.reach.assertReachesPerson(actor, personId);
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
    await this.reach.assertReachesAccount(actor, id);
    await this.provisioning.resendActivation(id, actor, claim);
  }

  /**
   * Sends a password reset link to an account in use, at the account's own address
   * (section 6, decision 0393). Guarded like the re-send, against the Account.
   */
  @Post(':id/password-reset-email')
  @HttpCode(HttpStatus.NO_CONTENT)
  // As tight as forgot-password, since each request emails somebody else (section 24).
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @RequiresCapability(Capability.AccountsManage, { kind: 'account', from: 'params.id' })
  async sendPasswordReset(
    @Param('id') id: string,
    @CurrentActor() actor: Actor,
    @CurrentIdempotency() claim: CurrentClaim,
  ): Promise<void> {
    await this.reach.assertReachesAccount(actor, id);
    await this.credentials.sendResetByAdministrator(id, actor, claim);
  }

  /**
   * Corrects the address of an account nobody has activated, and sends the activation
   * email there (section 6, decision 0300). With `restart`, starts an account in use over
   * at a new address (decision 0415). Guarded like the re-send, against the Account.
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
    await this.reach.assertReachesAccount(actor, id);
    return this.provisioning.correctEmail(id, body.email, actor, claim, body.restart === true);
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
    await this.reach.assertReachesAccount(actor, id);
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
    await this.reach.assertReachesAccount(actor, id);
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
    await this.reach.assertReachesAccount(actor, id);
    return { ...(await this.access.reactivate(id, actor, claim)) };
  }

  /**
   * Ticks or clears Full view on a Leader account (section 7, decision 0323). Guarded by
   * `roles.manage`, which picks between the two Leader default sets, against the Account.
   */
  @Post(':id/full-view')
  @HttpCode(HttpStatus.OK)
  @RequiresCapability(Capability.RolesManage, { kind: 'account', from: 'params.id' })
  async setFullView(
    @Param('id') id: string,
    @Body() body: SetFullViewDto,
    @CurrentActor() actor: Actor,
    @CurrentIdempotency() claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    const wholeChurch = (await this.reach.reachOf(actor, Capability.RolesManage)) === null;
    await this.reach.assertReachesAccount(actor, id, Capability.RolesManage);
    return {
      ...(await this.access.setFullView(id, body.full_view, actor, claim, {
        // A tick only the Admin gives is only the Admin's to remove (decision 0469).
        mayClearOtherTicks: wholeChurch,
      })),
    };
  }

  /**
   * Ticks or clears Approves Cells on a Leader account (section 7, decision 0352), under
   * `roles.manage` against the Account, as Full view is.
   */
  @Post(':id/approves-cells')
  @HttpCode(HttpStatus.OK)
  @RequiresCapability(Capability.RolesManage, { kind: 'account', from: 'params.id' })
  async setApprovesCells(
    @Param('id') id: string,
    @Body() body: SetApprovesCellsDto,
    @CurrentActor() actor: Actor,
    @CurrentIdempotency() claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    await this.assertTicksAtWholeChurch(actor);
    return { ...(await this.access.setApprovesCells(id, body.approves_cells, actor, claim)) };
  }

  /** *Approves Cells* and *Moves people* need `roles.manage` at Whole Church (decision 0469). */
  private async assertTicksAtWholeChurch(actor: Actor): Promise<void> {
    if ((await this.reach.reachOf(actor, Capability.RolesManage)) !== null) {
      throw new ScopeDeniedError('Only the Admin gives or removes this tick.', {});
    }
  }

  /**
   * Ticks or clears Moves people on a Leader account (sections 5 and 7, decision 0356), under
   * `roles.manage` against the Account, as Approves Cells is.
   */
  @Post(':id/moves-people')
  @HttpCode(HttpStatus.OK)
  @RequiresCapability(Capability.RolesManage, { kind: 'account', from: 'params.id' })
  async setMovesPeople(
    @Param('id') id: string,
    @Body() body: SetMovesPeopleDto,
    @CurrentActor() actor: Actor,
    @CurrentIdempotency() claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    await this.assertTicksAtWholeChurch(actor);
    return { ...(await this.access.setMovesPeople(id, body.moves_people, actor, claim)) };
  }
}
