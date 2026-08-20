import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { APP_CONFIG, type AppConfig } from '../config/configuration';
import { HierarchyModule } from '../hierarchy/hierarchy.module';
import { NetworksModule } from '../networks/networks.module';

import { AccountsRepository } from './accounts.repository';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AccessTokenGuard } from './authorization/access-token.guard';
import { AuthorizationService } from './authorization/authorization.service';
import { CapabilityGuard } from './authorization/capability.guard';
import { PasswordService } from './password.service';
import { TokensService } from './tokens.service';

/**
 * The `auth` module: accounts, tokens, sessions, and the capability and scope
 * guard (SKILL.md section 2, Modules).
 */
@Module({
  imports: [
    HierarchyModule,
    NetworksModule,
    JwtModule.registerAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        secret: config.jwtSecret,
        signOptions: { algorithm: 'HS256' },
        verifyOptions: { algorithms: ['HS256'] },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AccountsRepository,
    AuthService,
    AuthorizationService,
    PasswordService,
    TokensService,
    AccessTokenGuard,
    CapabilityGuard,
  ],
  // AccessTokenGuard and CapabilityGuard are registered as global guards in
  // AppModule, so their dependencies must be resolvable from there. Nest resolves
  // a provider's dependencies in the context of the module that registers it.
  exports: [
    AccountsRepository,
    AuthorizationService,
    AccessTokenGuard,
    CapabilityGuard,
    TokensService,
  ],
})
export class AuthModule {}
