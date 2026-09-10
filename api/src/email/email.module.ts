import { Module } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from '../config/configuration';
import { EMAIL_PORT } from './email.port';
import { LoggingEmailAdapter } from './logging-email.adapter';
import { OutboxEmailAdapter } from './outbox-email.adapter';

/**
 * The one place a provider is named (SKILL.md section 2, Chosen stack).
 *
 * Swapping an adapter for a real one is a change to this file and nothing else. That is
 * the entire point of the abstraction: no service imports an adapter, they inject
 * `EMAIL_PORT`, so business logic cannot acquire a dependency on a provider by accident.
 *
 * **Two are bound today and neither delivers mail.** `LoggingEmailAdapter` is the
 * default and drops the message; `OutboxEmailAdapter` writes it to a file so that a
 * development account can actually be activated (ruling of 2026-09-11). A real provider
 * joins this switch rather than replacing it, because the development transport stays
 * useful once one exists.
 *
 * **The choice is made here and the refusal lives in `configuration.ts`.** Selecting the
 * outbox in production stops the process before this factory runs, so this file never
 * has to ask which environment it is in — one rule, one home.
 */
@Module({
  providers: [
    LoggingEmailAdapter,
    OutboxEmailAdapter,
    {
      provide: EMAIL_PORT,
      inject: [APP_CONFIG, LoggingEmailAdapter, OutboxEmailAdapter],
      useFactory: (config: AppConfig, logging: LoggingEmailAdapter, outbox: OutboxEmailAdapter) =>
        config.emailTransport === 'outbox' ? outbox : logging,
    },
  ],
  exports: [EMAIL_PORT],
})
export class EmailModule {}
