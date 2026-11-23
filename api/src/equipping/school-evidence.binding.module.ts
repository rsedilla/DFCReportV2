import { Global, Module } from '@nestjs/common';

import { SCHOOL_EVIDENCE_PORT } from '../training/school-evidence.port';

import { EquippingModule } from './equipping.module';
import { SchoolEvidenceAdapter } from './school-evidence.adapter';

/**
 * Binds `training`'s school-evidence port to the module that owns those tables (decision 0509,
 * point 8), for the reason `PersonArchiveEquippingBindingModule` gives: `training` cannot
 * import `EquippingModule`, which imports it.
 */
@Global()
@Module({
  imports: [EquippingModule],
  providers: [{ provide: SCHOOL_EVIDENCE_PORT, useExisting: SchoolEvidenceAdapter }],
  exports: [SCHOOL_EVIDENCE_PORT],
})
export class SchoolEvidenceBindingModule {}
