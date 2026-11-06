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

/** The church a message comes from, named in every subject that welcomes and every sign-off. */
const CHURCH = 'Doulos For Christ Church';

/** One piece of a message, written once and drawn both as plain text and as HTML. */
type Block =
  | { kind: 'p'; text: string }
  | { kind: 'verse'; text: string; reference: string }
  | { kind: 'button'; label: string; href: string }
  | { kind: 'small'; text: string };

/** The sign-off every message ends with, so each one says who sent it. */
const SIGN_OFF = ['In Christ,', 'The DREAMS team', CHURCH];

/** The accent the web application uses, so the button reads as the church's own. */
const ACCENT = '#007a39';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * The plain-text and HTML bodies of one message. The plain text is what a mail client
 * without HTML shows, and carries every link in full; the HTML puts a link behind a button,
 * which is what keeps a long token out of sight and the message from reading as spam.
 */
function render(greeting: string, blocks: Block[]): { text: string; html: string } {
  const text = [
    greeting,
    '',
    ...blocks.flatMap((block) => {
      switch (block.kind) {
        case 'verse':
          return [`"${block.text}" ${block.reference}`, ''];
        case 'button':
          return [`${block.label}: ${block.href}`, ''];
        default:
          return [block.text, ''];
      }
    }),
    ...SIGN_OFF,
    '',
  ].join('\n');

  const body = blocks
    .map((block) => {
      switch (block.kind) {
        case 'p':
          return `<p style="margin:0 0 16px">${escapeHtml(block.text)}</p>`;
        case 'verse':
          return (
            `<p style="margin:0 0 16px;padding:4px 0 4px 12px;border-left:3px solid ${ACCENT};` +
            `color:#444;font-style:italic">&ldquo;${escapeHtml(block.text)}&rdquo; ` +
            `<span style="font-style:normal">${escapeHtml(block.reference)}</span></p>`
          );
        case 'button':
          return (
            `<p style="margin:0 0 16px"><a href="${escapeHtml(block.href)}" ` +
            `style="display:inline-block;background:${ACCENT};color:#ffffff;` +
            `text-decoration:none;font-weight:bold;padding:10px 18px;border-radius:6px">` +
            `${escapeHtml(block.label)}</a></p>`
          );
        case 'small':
          return `<p style="margin:0 0 16px;font-size:13px;color:#555">${escapeHtml(block.text)}</p>`;
      }
    })
    .join('');

  const html =
    '<!doctype html><html><body style="margin:0;padding:24px;background:#ffffff;' +
    'font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#1a1a1a">' +
    `<div style="max-width:560px">` +
    `<p style="margin:0 0 16px">${escapeHtml(greeting)}</p>${body}` +
    `<p style="margin:0">${SIGN_OFF.map(escapeHtml).join('<br>')}</p>` +
    '</div></body></html>';

  return { text, html };
}

/** The subject and bodies a person reads, plain text and HTML. Exported for its test. */
export function compose(
  message: OutboundEmail,
  linkOrigin: string,
): { subject: string; text: string; html: string } {
  const greeting = message.to.name.trim() === '' ? 'Hello,' : `Hello ${message.to.name},`;
  const letter = (subject: string, blocks: Block[]) => ({
    subject,
    ...render(greeting, blocks),
  });
  const manila = (instant: Date) =>
    instant.toLocaleString('en-PH', {
      timeZone: 'Asia/Manila',
      dateStyle: 'medium',
      timeStyle: 'short',
    });

  if (message.kind === 'MANY_PAGES_OPENED') {
    return letter('DREAMS: many person records opened in an hour', [
      {
        kind: 'p',
        text: `${message.viewer} opened ${message.pages} different person records in the last hour. Leaders seldom need that many.`,
      },
      {
        kind: 'p',
        text: 'If it was not expected, check with them, and look at "Who opened this record" on the people concerned.',
      },
    ]);
  }

  if (message.kind === 'SECOND_STEP_PAUSED') {
    return letter('DREAMS: sign-in paused after 10 wrong second-step codes', [
      {
        kind: 'p',
        // Authenticator and recovery codes both count (decision 0441).
        text: `Sign-in to ${message.holder}'s account was paused after 10 wrong codes in 15 minutes, from the authenticator app or recovery codes. It opens again at ${manila(message.pausedUntil)} (Manila time).`,
      },
      {
        kind: 'p',
        text: `The code is asked only after the right password, so whoever typed them knows the password. If it was not ${message.holder}, ask them to change their password straight away.`,
      },
    ]);
  }

  // Somebody signed in typed them, so the session itself may be in other hands (decision 0448).
  if (message.kind === 'CURRENT_PASSWORD_PAUSED') {
    return letter('DREAMS: 10 wrong current passwords on My Account', [
      {
        kind: 'p',
        text: `Someone signed in to ${message.holder}'s account typed 10 wrong current passwords on My Account in 15 minutes. Sign-in with ${message.email} is paused until ${manila(message.pausedUntil)} (Manila time).`,
      },
      {
        kind: 'p',
        text: `If ${message.holder} was not changing the password or email address, someone else may be using a phone or computer still signed in to the account. Ask ${message.holder} to reset the password with "I have forgotten my password", which signs out every device.`,
      },
    ]);
  }

  if (message.kind === 'SIGN_IN_PAUSED') {
    const name =
      'email' in message.typed
        ? `the email address ${message.typed.email}`
        : `the username ${message.typed.username}`;

    return letter('DREAMS: sign-in paused after 10 wrong passwords', [
      {
        kind: 'p',
        text: `Sign-in with ${name}, which is ${message.holder}'s account, was paused after 10 wrong passwords in 15 minutes. It opens again at ${manila(message.pausedUntil)} (Manila time).`,
      },
      {
        kind: 'p',
        text: `If ${message.holder} was not trying to sign in, somebody may be guessing the password. Nothing needs doing to keep the account safe: they can still get in with "I have forgotten my password".`,
      },
    ]);
  }

  if (message.kind === 'PASSWORD_CHANGED') {
    return letter('Your DREAMS password was changed', [
      {
        kind: 'p',
        text: `The password for your account was changed on ${manila(message.changedAt)} (Manila time), and your other devices were signed out.`,
      },
      { kind: 'p', text: 'If you did not change it, ask for a reset link straight away:' },
      { kind: 'button', label: 'Ask for a reset link', href: `${linkOrigin}/forgot-password` },
    ]);
  }

  if (message.kind === 'EMAIL_CHANGED') {
    return letter('Your DREAMS email address was changed', [
      {
        kind: 'p',
        text: message.byAdministrator
          ? `An administrator changed the email address of your account on ${manila(message.changedAt)} (Manila time). Your account starts over at the new address: you were signed out, and your password no longer works.`
          : `The email address of your account was changed on ${manila(message.changedAt)} (Manila time). Reset links now go to the new address, not this one.`,
      },
      {
        kind: 'p',
        text: 'If you did not expect this, contact your church administrator straight away.',
      },
    ]);
  }

  const path =
    message.kind === 'ACTIVATION'
      ? '/activate'
      : message.kind === 'EMAIL_CHANGE'
        ? '/confirm-email'
        : '/reset-password';
  const link = `${linkOrigin}${path}?token=${encodeURIComponent(message.token)}`;
  const expires = `This link works once and expires on ${manila(message.expiresAt)} (Manila time).`;

  if (message.kind === 'EMAIL_CHANGE') {
    return letter('Confirm your new DREAMS email address', [
      {
        kind: 'p',
        text: 'You asked to use this address for your DREAMS account. Confirm it here:',
      },
      { kind: 'button', label: 'Confirm my email', href: link },
      {
        kind: 'small',
        text: `${expires} If you did not ask for this, ignore this email and nothing changes.`,
      },
    ]);
  }

  // The welcome the owner chose (2026-11-04): the church named, Matthew 25:21, one button.
  if (message.kind === 'ACTIVATION') {
    return letter(`Welcome to ${CHURCH}`, [
      {
        kind: 'p',
        text: "Welcome to DREAMS, our church's place for recording Cell Group and DCC attendance and caring for the people God has given us.",
      },
      {
        kind: 'verse',
        text: 'Well done, good and faithful servant! You have been faithful with a few things; I will put you in charge of many things.',
        reference: 'Matthew 25:21',
      },
      { kind: 'p', text: 'Your account is ready. Choose your password to get started:' },
      { kind: 'button', label: 'Set my password', href: link },
      {
        kind: 'small',
        text: `${expires} If you weren't expecting this, you can ignore this email.`,
      },
    ]);
  }

  return letter('Reset your DREAMS password', [
    {
      kind: 'p',
      text: 'Somebody asked to reset the password for your account. Choose a new one here:',
    },
    { kind: 'button', label: 'Choose a new password', href: link },
    {
      kind: 'small',
      text: `${expires} If you did not ask for this, ignore this email and your password stays as it is.`,
    },
  ]);
}
