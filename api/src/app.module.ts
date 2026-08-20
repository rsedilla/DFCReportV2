import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { AuthModule } from './auth/auth.module';
import { AccessTokenGuard } from './auth/authorization/access-token.guard';
import { CapabilityGuard } from './auth/authorization/capability.guard';
import { ApiExceptionFilter } from './common/errors/api-exception.filter';
import { AppConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { HealthController } from './health/health.controller';
import { HierarchyModule } from './hierarchy/hierarchy.module';
import { NetworksModule } from './networks/networks.module';

/**
 * A modular monolith (SKILL.md section 1, principle 13). Modules are named in
 * section 2 and organised by module, never by layer: a `controllers/`,
 * `services/`, `entities/` layout spreads every feature across four folders and
 * gives no boundary anything can be enforced on.
 *
 * The modules that exist so far are `auth`, `hierarchy` and `networks`. The other
 * six arrive with the stages that need them (docs/ROADMAP.md).
 *
 * The two guards are global and ordered: authentication first, then the
 * capability and scope check. Registering them here rather than per controller is
 * what makes an endpoint closed until it declares otherwise.
 */
@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }]),
    AuthModule,
    HierarchyModule,
    NetworksModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AccessTokenGuard },
    { provide: APP_GUARD, useClass: CapabilityGuard },
  ],
})
export class AppModule {}
