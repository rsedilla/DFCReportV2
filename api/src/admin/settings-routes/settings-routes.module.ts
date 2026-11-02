import { Module } from '@nestjs/common';

import { AttendanceModule } from '../../attendance/attendance.module';
import { AuthModule } from '../../auth/auth.module';
import { AuthorizationModule } from '../../auth/authorization/authorization.module';
import { SettingsModule } from '../settings/settings.module';

import { SettingsRoutesController } from './settings-routes.controller';
import { SettingsRoutesService } from './settings-routes.service';

/**
 * The Admin's Settings routes (decision 0425), inside `admin` beside `settings`. Not part
 * of `SettingsModule`, which imports nothing so that `attendance` may import it: this one
 * asks `attendance` how far the DCC calendar reaches, and nothing imports this one.
 */
@Module({
  imports: [SettingsModule, AttendanceModule, AuthModule, AuthorizationModule],
  controllers: [SettingsRoutesController],
  providers: [SettingsRoutesService],
})
export class SettingsRoutesModule {}
