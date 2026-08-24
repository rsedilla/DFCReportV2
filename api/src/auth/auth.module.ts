import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { AuditModule } from '../audit/audit.module';
import { APP_CONFIG, type AppConfig } from '../config/configuration';
import { EmailModule } from '../email/email.module';
import { PeopleModule } from '../people/people.module';

import { AuthorizationModule } from './authorization/authorization.module';

import { AccountProvisioningService } from './account-provisioning.service';
import { AccountTokensService } from './account-tokens.service';
import { AccountsController } from './accounts.controller';
import { AccountsRepository } from './accounts.repository';
import { AuthController } from './auth.controller';
import { CredentialsService } from './credentials.service';
import { AuthService } from './auth.service';
import { AccessTokenGuard } from './authorization/access-token.guard';
import { PasswordService } from './password.service';
import { TokensService } from './tokens.service';

/**
 * The `auth` module: accounts, tokens, sessions, and the capability and scope
 * guard (SKILL.md section 2, Modules).
 */
@Module({
  imports: [
    AuditModule,
    AuthorizationModule,
    EmailModule,
    // **`auth` reads no table it does not own.** Provisioning and the reset flow
    // both need a Person's name and lifecycle, and section 2 gives `persons` to
    // `people` — so they ask `people` rather than joining its table. This import
    // is only possible because the authorization seam moved out: `people` needs
    // `AuthorizationService`, and importing `AuthModule` for it made this a cycle.
    PeopleModule,
    JwtModule.registerAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        secret: config.jwtSecret,
        signOptions: { algorithm: 'HS256' },
        verifyOptions: { algorithms: ['HS256'] },
      }),
    }),
  ],
  controllers: [AuthController, AccountsController],
  providers: [
    AccountProvisioningService,
    AccountTokensService,
    AccountsRepository,
    AuthService,
    CredentialsService,
    PasswordService,
    TokensService,
    AccessTokenGuard,
  ],
  // AccessTokenGuard and CapabilityGuard are registered as global guards in
  // AppModule, so their dependencies must be resolvable from there. Nest resolves
  // a provider's dependencies in the context of the module that registers it.
  exports: [AccountsRepository, AccessTokenGuard, TokensService],
})
export class AuthModule {}
