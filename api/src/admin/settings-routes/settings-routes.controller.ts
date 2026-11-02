import { Body, Controller, Get, HttpCode, Patch, Post, Put } from '@nestjs/common';

import {
  AuthenticatedOnly,
  RequiresCapability,
} from '../../auth/authorization/authorization.decorators';
import { type Actor } from '../../auth/authorization/authorization.service';
import { Capability } from '../../auth/authorization/capabilities';
import { CurrentActor } from '../../auth/current-actor.decorator';
import {
  CurrentIdempotency,
  type CurrentClaim,
} from '../../common/idempotency/current-idempotency.decorator';

import { CellAttentionMonthsDto } from './dto/cell-attention-months.dto';
import { RecordVerseDto } from './dto/record-verse.dto';
import {
  SettingsRoutesService,
  type RecordVerse,
  type SettingsView,
} from './settings-routes.service';

/**
 * `/api/v1/settings` (SKILL.md sections 7 and 19, decision 0425): the Admin's Settings tab.
 *
 * **Everything here is under `settings.manage` against the church**, read included: the
 * values are church-wide operational settings and the tab is the administrator's. The
 * capability is Whole Church only (section 7), so a church target is covered by a Whole
 * Church grant and nothing narrower, as the Encounter season routes are.
 */
@Controller('settings')
export class SettingsRoutesController {
  constructor(private readonly settings: SettingsRoutesService) {}

  @Get()
  @RequiresCapability(Capability.SettingsManage, { kind: 'church' })
  async read(): Promise<SettingsView> {
    return this.settings.read();
  }

  /**
   * The verse under Record's welcome, read by every signed-in account because Record shows it
   * to everyone (decision 0425). It is words the church chose to show, not a record of anybody.
   */
  @Get('record-verse')
  @AuthenticatedOnly('The verse Record shows every signed-in account; it describes nobody.')
  async recordVerse(): Promise<RecordVerse> {
    return this.settings.recordVerse();
  }

  @Put('record-verse')
  @RequiresCapability(Capability.SettingsManage, { kind: 'church' })
  async setRecordVerse(
    @Body() body: RecordVerseDto,
    @CurrentActor() actor: Actor,
    @CurrentIdempotency() claim: CurrentClaim,
  ): Promise<SettingsView> {
    return this.settings.setRecordVerse(
      actor,
      { text: body.text ?? null, reference: body.reference ?? null },
      claim,
    );
  }

  @Patch('cell-attention-months')
  @RequiresCapability(Capability.SettingsManage, { kind: 'church' })
  async setCellAttentionMonths(
    @Body() body: CellAttentionMonthsDto,
    @CurrentActor() actor: Actor,
    @CurrentIdempotency() claim: CurrentClaim,
  ): Promise<SettingsView> {
    return this.settings.setCellAttentionMonths(actor, body.months, claim);
  }

  @Post('initial-encoding/close')
  @HttpCode(200)
  @RequiresCapability(Capability.SettingsManage, { kind: 'church' })
  async closeInitialEncoding(
    @CurrentActor() actor: Actor,
    @CurrentIdempotency() claim: CurrentClaim,
  ): Promise<SettingsView> {
    return this.settings.closeInitialEncoding(actor, claim);
  }
}
