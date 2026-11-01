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
 * **It writes an ACTIVATION token, and refuses to write a PASSWORD_RESET one** (ruling of
 * 2026-09-11). Section 6 makes the same trade for `bootstrap:admin`, which prints its
 * activation token, on terms an activation inherits: the token is single-use, short-lived,
 * and read by the person operating the machine. It reaches further in one direction only —
 * a file outlives scrollback — and less far in another, since nothing is addressed to
 * anybody and no inbox receives it.
 *
 * **A reset token does not inherit those terms.** An activation credential belongs to an
 * account nobody has used; a reset credential takes over an account somebody is using,
 * which is what Section 6 means by an administrator coming to know another user's
 * password. The bootstrap precedent does not carry either, because there the operator
 * *is* the holder.
 *
 * **The first version of this ruling reasoned the other way and was wrong on its facts.**
 * It held that refusing withheld nothing, since the operator could read `account_tokens`
 * or mint a token directly. Neither is true: that table stores a SHA-256 hash and the
 * schema says in terms that "the token itself is never stored", and no call site hands a
 * minted token to anybody but this transport. So the outbox is not a convenience that
 * saves a query — on a development machine it is the **only** source of a usable
 * credential for another person's account, which is the access Section 6 withholds.
 *
 * **The reset message is still written, without its token**, so a developer learns the
 * flow ran and why the token is absent rather than wondering whether delivery failed.
 * Nothing about the API changes: Section 6 requires the forgot-password response to be
 * identical whether or not the address matches, and this transport is downstream of that.
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
  // A notice to the Admin carries no token (decision 0414).
  if (message.kind === 'MANY_PAGES_OPENED') {
    return [
      `Kind:      ${message.kind}`,
      `To:        ${message.to.name} <${message.to.email}>`,
      `Viewer:    ${message.viewer}`,
      `Pages:     ${message.pages}`,
      '',
      'This message was not delivered. It was written by the development transport',
      '(SKILL.md section 6). Nothing was sent to the address above.',
      '',
    ].join('\n');
  }

  // A notice to the Admin carries no token (decision 0413).
  if (message.kind === 'SIGN_IN_PAUSED') {
    return [
      `Kind:      ${message.kind}`,
      `To:        ${message.to.name} <${message.to.email}>`,
      `Typed:     ${'email' in message.typed ? message.typed.email : message.typed.username}`,
      `Holder:    ${message.holder}`,
      `Until:     ${message.pausedUntil.toISOString()}`,
      '',
      'This message was not delivered. It was written by the development transport',
      '(SKILL.md section 6). Nothing was sent to the address above.',
      '',
    ].join('\n');
  }

  // A notice carries no token and no expiry (decision 0351).
  if (message.kind === 'EMAIL_CHANGED') {
    return [
      `Kind:      ${message.kind}`,
      `To:        ${message.to.name} <${message.to.email}>`,
      `Changed:   ${message.changedAt.toISOString()}`,
      `By admin:  ${message.byAdministrator ? 'yes' : 'no'}`,
      '',
      'This message was not delivered. It was written by the development transport',
      '(SKILL.md section 6). Nothing was sent to the address above.',
      '',
    ].join('\n');
  }

  if (message.kind === 'PASSWORD_CHANGED') {
    return [
      `Kind:      ${message.kind}`,
      `To:        ${message.to.name} <${message.to.email}>`,
      `Changed:   ${message.changedAt.toISOString()}`,
      '',
      'This message was not delivered. It was written by the development transport',
      '(SKILL.md section 6). Nothing was sent to the address above.',
      '',
    ].join('\n');
  }

  const head = [
    `Kind:      ${message.kind}`,
    `To:        ${message.to.name} <${message.to.email}>`,
    `Expires:   ${message.expiresAt.toISOString()}`,
    '',
  ];

  // **Activation carries its token; a reset and an email change do not** (decision 0415:
  // the second moves where an account in use is reset, so it reaches the same). The refusal is here rather than
  // in a caller because this is the only place a token would reach disk.
  const credential =
    message.kind === 'ACTIVATION'
      ? ['Token:', message.token, '']
      : [
          'Token:     withheld (SKILL.md section 6).',
          '',
          'A password-reset or email-change token takes over an account somebody is using, which',
          'is the access section 6 refuses an administrator. An activation token is',
          'written, because an account nobody has used cannot otherwise be reached.',
          '',
        ];

  return [
    ...head,
    ...credential,
    'This message was not delivered. It was written by the development transport',
    '(SKILL.md section 6). Nothing was sent to the address above.',
    '',
  ].join('\n');
}
