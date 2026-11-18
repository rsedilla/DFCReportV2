import { Global, Module } from '@nestjs/common';

import { ARCHIVE_EQUIPPING_PORT } from '../people/person-archive.ports';

import { EquippingModule } from './equipping.module';
import { PersonArchiveEquippingAdapter } from './person-archive.adapter';

/**
 * Binds `people`'s archive Equipping port to the module that owns those tables (decision
 * 0499), for the reason `PersonArchiveCellsBindingModule` gives: `people` cannot import
 * `EquippingModule`, which imports it.
 */
@Global()
@Module({
  imports: [EquippingModule],
  providers: [{ provide: ARCHIVE_EQUIPPING_PORT, useExisting: PersonArchiveEquippingAdapter }],
  exports: [ARCHIVE_EQUIPPING_PORT],
})
export class PersonArchiveEquippingBindingModule {}
