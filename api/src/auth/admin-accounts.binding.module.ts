import { Global, Module } from '@nestjs/common';

import { ADMIN_ACCOUNTS_PORT } from '../people/admin-accounts.port';

import { AccountsRepository } from './accounts.repository';
import { AuthModule } from './auth.module';

/**
 * Binds `people`'s admin-accounts port to the module that owns those tables (SKILL.md
 * section 2; `admin-accounts.port.ts`; ruling of 2026-09-11).
 *
 * **`@Global()` for the reason `CellRelationshipsBindingModule` states**, which is about
 * where Nest resolves a dependency rather than about the provider deserving to be
 * everywhere: a provider's dependencies resolve in the context of the module that
 * *registers* it, so `PeopleReadService` — registered in `PeopleModule` — cannot see a
 * binding placed in `AppModule`'s provider list. What is global here is one token.
 *
 * **A module of its own rather than `@Global()` on `AuthModule`**, and here the argument
 * is stronger than it was there: `AuthModule` carries controllers, the credentials
 * service and the token services, and making it global would put every one of them in
 * reach of every module in order to deliver a single set-valued read.
 *
 * `PeopleModule` cannot import `AuthModule` — `auth` imports `people`, so that is the
 * cycle the port exists for, and it is the only one of the four reads decision 0241
 * re-homed that needed one.
 */
@Global()
@Module({
  imports: [AuthModule],
  providers: [{ provide: ADMIN_ACCOUNTS_PORT, useExisting: AccountsRepository }],
  exports: [ADMIN_ACCOUNTS_PORT],
})
export class AdminAccountsBindingModule {}
