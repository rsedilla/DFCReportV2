import { Global, Module } from '@nestjs/common';

import { ARCHIVE_ACCOUNTS_PORT } from '../people/person-archive.ports';

import { AuthModule } from './auth.module';
import { PersonArchiveAccountsAdapter } from './person-archive.adapter';

/**
 * Binds `people`'s archive accounts port to the module that owns those tables (decision
 * 0397). `@Global()` and a module of its own for the reasons `AdminAccountsBindingModule`
 * gives: `people` cannot import `AuthModule`, which imports it, and what is global here is
 * one token.
 */
@Global()
@Module({
  imports: [AuthModule],
  providers: [{ provide: ARCHIVE_ACCOUNTS_PORT, useExisting: PersonArchiveAccountsAdapter }],
  exports: [ARCHIVE_ACCOUNTS_PORT],
})
export class PersonArchiveAccountsBindingModule {}
