import { Global, Module } from '@nestjs/common';

import { MERGED_PERSONS_PORT } from '../auth/authorization/merged-persons.port';

import { MergedPersonsAdapter } from './merged-persons.adapter';

/**
 * Binds the authorization seam's merged-persons port to the module that owns `persons`
 * (decision 0408, point 17). `@Global()` for the reason `AdminAccountsBindingModule` gives:
 * the consumer, `AuthorizationService`, is registered in `AuthorizationModule`, which cannot
 * import `PeopleModule` back. It imports nothing: the adapter needs only the database, which is
 * global, so the binding cannot close a cycle through `PeopleModule`.
 */
@Global()
@Module({
  providers: [
    MergedPersonsAdapter,
    { provide: MERGED_PERSONS_PORT, useExisting: MergedPersonsAdapter },
  ],
  exports: [MERGED_PERSONS_PORT],
})
export class MergedPersonsBindingModule {}
