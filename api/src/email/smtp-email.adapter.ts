import { Inject, Injectable } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';

import { APP_CONFIG, type AppConfig, type SmtpConfig } from '../config/configuration';
import { type EmailPort, type OutboundEmail } from './email.port';

/** A hung provider must not hold a request open indefinitely. */
const TIMEOUT_MS = 15_000;

/**
 * The transport that delivers mail, over SMTP to whichever provider is configured
 * (SKILL.md section 2, Email; section 6).
 *
 * SMTP rather than one provider's HTTP API, so that choosing or changing a provider
 * is a change to four environment variables and nothing else.
 *
 * **The links point at the web client's two pages**, `/activate` and
 * `/reset-password`, which read the token from `?token=`. A native client that later
 * wants its own handling is a change here and in `EMAIL_LINK_ORIGIN`, not in a service.
 */
@Injectable()
export class SmtpEmailAdapter implements EmailPort {
  private readonly transporter: Transporter;
  private readonly smtp: SmtpConfig;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    // Non-null by construction: `loadConfig` builds it for `smtp`, and this adapter is
    // bound only for `smtp`. Asserted so a binding mistake fails at startup.
    if (config.smtp === null) {
      throw new Error('SMTP configuration is missing while the smtp transport is bound');
    }

    this.smtp = config.smtp;
    this.transporter = createTransport({
      host: this.smtp.host,
      port: this.smtp.port,
      secure: this.smtp.secure,
      requireTLS: !this.smtp.secure,
      auth: { user: this.smtp.user, pass: this.smtp.password },
      connectionTimeout: TIMEOUT_MS,
      greetingTimeout: TIMEOUT_MS,
      socketTimeout: TIMEOUT_MS,
    });
  }

  async send(message: OutboundEmail): Promise<void> {
    await this.transporter.sendMail({
      from: this.smtp.from,
      to: { name: message.to.name, address: message.to.email },
      ...compose(message, this.smtp.linkOrigin),
    });
  }
}

/** The subject and plain-text body a person reads. Exported for its test. */
export function compose(
  message: OutboundEmail,
  linkOrigin: string,
): { subject: string; text: string } {
  const greeting = message.to.name.trim() === '' ? 'Hello,' : `Hello ${message.to.name},`;

  if (message.kind === 'MANY_PAGES_OPENED') {
    return {
      subject: 'DREAMS: many person records opened in an hour',
      text: [
        greeting,
        '',
        `${message.viewer} opened ${message.pages} different person records in the last hour. Leaders seldom need that many.`,
        '',
        'If it was not expected, check with them, and look at "Who opened this record" on the people concerned.',
        '',
      ].join('\n'),
    };
  }

  if (message.kind === 'PASSWORD_CHANGED') {
    const changed = message.changedAt.toLocaleString('en-PH', {
      timeZone: 'Asia/Manila',
      dateStyle: 'medium',
      timeStyle: 'short',
    });

    return {
      subject: 'Your DREAMS password was changed',
      text: [
        greeting,
        '',
        `The password for your account was changed on ${changed} (Manila time), and your other devices were signed out.`,
        '',
        'If you did not change it, ask for a reset link straight away:',
        '',
        `${linkOrigin}/forgot-password`,
        '',
      ].join('\n'),
    };
  }

  const path = message.kind === 'ACTIVATION' ? '/activate' : '/reset-password';
  const link = `${linkOrigin}${path}?token=${encodeURIComponent(message.token)}`;
  const expires = message.expiresAt.toLocaleString('en-PH', {
    timeZone: 'Asia/Manila',
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  if (message.kind === 'ACTIVATION') {
    return {
      subject: 'Set your password for DREAMS',
      text: [
        greeting,
        '',
        'An account has been created for you. Open this link to choose your password:',
        '',
        link,
        '',
        `The link works once and expires ${expires} (Manila time).`,
        'If you did not expect this, you can ignore this message.',
        '',
      ].join('\n'),
    };
  }

  return {
    subject: 'Reset your DREAMS password',
    text: [
      greeting,
      '',
      'Somebody asked to reset the password for your account. Open this link to choose a new one:',
      '',
      link,
      '',
      `The link works once and expires ${expires} (Manila time).`,
      'If you did not ask for this, ignore this message and your password stays as it is.',
      '',
    ].join('\n'),
  };
}
