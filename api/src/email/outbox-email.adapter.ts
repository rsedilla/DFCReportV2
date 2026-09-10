import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { Inject, Injectable, Logger } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from '../config/configuration';
import { EmailPort, OutboundEmail } from './email.port';

/**
 * A development transport: it writes each message to a file instead of sending it
 * (SKILL.md section 6, ruling of 2026-09-11).
 *
 * **It exists because without it a provisioned account cannot be activated at all.**
 * `LoggingEmailAdapter` delivers nothing and deliberately does not log the token,
 * `account_tokens` stores only a hash, and `bootstrap:admin` refuses to run twice — so
 * an account created through the ordinary flow had no path to a password.
 *
 * **It writes the token, and that is the point rather than an oversight.** Section 6
 * makes the same trade for `bootstrap:admin`, which prints its activation token, on
 * terms this inherits: the token is single-use, short-lived, and read by the person
 * operating the machine. It reaches further in one direction only — a file outlives
 * scrollback — and less far in another, since nothing is addressed to anybody and no
 * inbox receives it.
 *
 * **What keeps it safe is in `configuration.ts`, not here**: the process refuses to
 * start with this transport selected in production. This class deliberately carries no
 * environment check of its own, because two places deciding one rule is how the two come
 * to disagree.
 *
 * **A file rather than the application log.** A log is shipped, aggregated and searched
 * by things that should never hold a credential; a directory is one place to read and
 * one place to delete.
 */
@Injectable()
export class OutboxEmailAdapter implements EmailPort {
  private readonly logger = new Logger(OutboxEmailAdapter.name);

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async send(message: OutboundEmail): Promise<void> {
    // Non-null by construction: `loadConfig` refuses `outbox` without a directory, and
    // this adapter is bound only for `outbox`. Asserted rather than defaulted, so a
    // future binding mistake fails loudly instead of writing credentials to `.`.
    const dir = this.config.emailOutboxDir;
    if (dir === null) {
      throw new Error('EMAIL_OUTBOX_DIR is unset while the outbox transport is bound');
    }

    await mkdir(dir, { recursive: true });

    // The identifier rather than the recipient or a timestamp: an address is not a
    // filename, and two messages to one person in the same second must not collide.
    const path = join(dir, `${message.kind}-${randomUUID()}.txt`);

    await writeFile(path, render(message), { encoding: 'utf8' });

    // The path, never the contents. This line reaches the application log, which is the
    // one place the docblock above says a token must not go.
    this.logger.warn(`No email provider is configured. ${message.kind} written to ${path}`);
  }
}

/**
 * What a developer needs in order to finish the flow, in the order they need it.
 *
 * The token is on its own line and unlabelled by anything a reader has to parse,
 * because the next step is copying it into a form.
 */
function render(message: OutboundEmail): string {
  return [
    `Kind:      ${message.kind}`,
    `To:        ${message.to.name} <${message.to.email}>`,
    `Expires:   ${message.expiresAt.toISOString()}`,
    '',
    'Token:',
    message.token,
    '',
    'This message was not delivered. It was written by the development transport',
    '(SKILL.md section 6). Nothing was sent to the address above.',
    '',
  ].join('\n');
}
