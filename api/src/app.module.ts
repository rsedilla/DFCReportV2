import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { SettingsModule } from './admin/settings/settings.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { AccessTokenGuard } from './auth/authorization/access-token.guard';
import { AuthorizationModule } from './auth/authorization/authorization.module';
import { CapabilityGuard } from './auth/authorization/capability.guard';
import { ApiExceptionFilter } from './common/errors/api-exception.filter';
import { IdempotencyInterceptor } from './common/idempotency/idempotency.interceptor';
import { IdempotencyModule } from './common/idempotency/idempotency.module';
import { AppConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { HealthController } from './health/health.controller';
import { HierarchyModule } from './hierarchy/hierarchy.module';
import { NetworksModule } from './networks/networks.module';
import { CELL_SCOPE_PORT } from './auth/authorization/cell-scope.port';
import { CellsModule } from './cells/cells.module';
import { CellsReadService } from './cells/cells.read.service';
import { PeopleModule } from './people/people.module';

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
 *
 * **Both guards' modules are imported here for that reason.** Nest resolves a
 * provider's dependencies in the context of the module that registers it, so a
 * globally registered guard needs its dependencies reachable from *this* module
 * rather than from wherever the guard's class happens to live. `AuthorizationModule`
 * was added when the authorization seam split out of `AuthModule`: `AuthModule`
 * imports it but does not re-export it, so the graph compiled and every request
 * failed at `CapabilityGuard`. The unit suite could not see it, because it never
 * builds the application.
 */
@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }]),
    IdempotencyModule,
    AuditModule,
    SettingsModule,
    AuthModule,
    AuthorizationModule,
    HierarchyModule,
    NetworksModule,
    PeopleModule,
    CellsModule,
  ],
  controllers: [HealthController],
  providers: [
    /**
     * How the capability guard places a Cell in the pastoral tree (SKILL.md section
     * 7), bound here because neither module may import the other: `cells` imports
     * `AuthorizationModule` to ask its own authorization questions, and
     * `AuthorizationModule` needs the answer to one about `cell_leaderships`, which
     * `cells` owns (section 2). The interface lives with the guard, the
     * implementation with the table, and the binding is this line.
     *
     * `useExisting` rather than `useClass`, so the guard and `cells` share one
     * instance and one connection pool.
     */
    { provide: CELL_SCOPE_PORT, useExisting: CellsReadService },
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AccessTokenGuard },
    { provide: APP_GUARD, useClass: CapabilityGuard },
    // After both guards, so the actor is resolved and an unauthorized request
    // never claims a key (SKILL.md section 22).
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
  ],
})
export class AppModule {}
