import { Module } from '@nestjs/common';

import { EMAIL_PORT } from './email.port';
import { LoggingEmailAdapter } from './logging-email.adapter';

/**
 * The one place a provider is named (SKILL.md section 2, Chosen stack).
 *
 * Swapping `LoggingEmailAdapter` for a real one is a change to this file and
 * nothing else. That is the entire point of the abstraction: no service imports an
 * adapter, they inject `EMAIL_PORT`, so business logic cannot acquire a dependency
 * on a provider by accident.
 */
@Module({
  providers: [{ provide: EMAIL_PORT, useClass: LoggingEmailAdapter }],
  exports: [EMAIL_PORT],
})
export class EmailModule {}
