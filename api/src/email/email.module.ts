import { Module } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from '../config/configuration';
import { EMAIL_PORT } from './email.port';
import { LoggingEmailAdapter } from './logging-email.adapter';
import { OutboxEmailAdapter } from './outbox-email.adapter';
import { SmtpEmailAdapter } from './smtp-email.adapter';

/**
 * The one place a provider is named (SKILL.md section 2, Chosen stack).
 *
 * Swapping an adapter for a real one is a change to this file and nothing else. That is
 * the entire point of the abstraction: no service imports an adapter, they inject
 * `EMAIL_PORT`, so business logic cannot acquire a dependency on a provider by accident.
 *
 * **Three can be bound.** `LoggingEmailAdapter` is the default and drops the message;
 * `OutboxEmailAdapter` writes it to a file so that a development account can actually be
 * activated (ruling of 2026-09-11); `SmtpEmailAdapter` delivers it. Only the chosen one
 * is constructed, so the SMTP adapter's refusal of a missing configuration never fires
 * on a deployment that did not select it.
 *
 * **The choice is made here and the refusal lives in `configuration.ts`.** Selecting the
 * outbox in production stops the process before this factory runs, so this file never
 * has to ask which environment it is in — one rule, one home.
 */
@Module({
  providers: [
    {
      provide: EMAIL_PORT,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => {
        switch (config.emailTransport) {
          case 'smtp':
            return new SmtpEmailAdapter(config);
          case 'outbox':
            return new OutboxEmailAdapter(config);
          case 'log':
            return new LoggingEmailAdapter();
        }
      },
    },
  ],
  exports: [EMAIL_PORT],
})
export class EmailModule {}
