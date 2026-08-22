import { Global, Module } from '@nestjs/common';

import { IdempotencyService } from './idempotency.service';

/**
 * Shared rather than owned by a module, which is what SKILL.md section 26 says of
 * `idempotency_keys`: it is the one structure in the index with no owning module,
 * because every write endpoint in every module passes through it.
 */
@Global()
@Module({
  providers: [IdempotencyService],
  exports: [IdempotencyService],
})
export class IdempotencyModule {}
