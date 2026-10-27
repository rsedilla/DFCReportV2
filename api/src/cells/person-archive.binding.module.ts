import { Global, Module } from '@nestjs/common';

import { ARCHIVE_CELLS_PORT } from '../people/person-archive.ports';

import { CellsModule } from './cells.module';
import { PersonArchiveCellsAdapter } from './person-archive.adapter';

/**
 * Binds `people`'s archive Cells port to the module that owns those tables (decision 0397).
 * `@Global()` and a module of its own for the reasons `CellRelationshipsBindingModule`
 * gives: `people` cannot import `CellsModule`, which imports it, and what is global here is
 * one token.
 */
@Global()
@Module({
  imports: [CellsModule],
  providers: [{ provide: ARCHIVE_CELLS_PORT, useExisting: PersonArchiveCellsAdapter }],
  exports: [ARCHIVE_CELLS_PORT],
})
export class PersonArchiveCellsBindingModule {}
