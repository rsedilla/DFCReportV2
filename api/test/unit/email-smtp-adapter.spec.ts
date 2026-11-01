import { type AppConfig } from '../../src/config/configuration';
import { EMAIL_PORT } from '../../src/email/email.port';
import { EmailModule } from '../../src/email/email.module';
import { SmtpEmailAdapter, compose } from '../../src/email/smtp-email.adapter';

/**
 * The transport that delivers mail (SKILL.md section 6). No mail server is reached:
 * binding constructs a transport without connecting, and `compose` is pure.
 */
describe('the SMTP email transport (section 6)', () => {
  const smtp = {
    host: 'smtp.example.test',
    port: 587,
    secure: false,
    user: 'user',
    password: 'not-a-real-password',
    from: 'Church <no-reply@example.test>',
    linkOrigin: 'https://app.example.test',
  };

  const config = (over: Partial<AppConfig>): AppConfig => ({
    nodeEnv: 'production',
    port: 3001,
    host: '127.0.0.1',
    databaseUrl: 'postgresql://x:y@127.0.0.1:5432/z',
    jwtSecret: '0123456789012345678901234567890123456789',
    secondStepKey: Buffer.alloc(32),
    corsAllowedOrigins: [],
    seniorPastorPersonIds: [],
    emailTransport: 'smtp',
    emailOutboxDir: null,
    smtp,
    ...over,
  });

  function bind(over: Partial<AppConfig>): unknown {
    const providers = Reflect.getMetadata('providers', EmailModule) as {
      provide?: symbol;
      useFactory?: (...args: unknown[]) => unknown;
    }[];
    const port = providers.find((p) => p.provide === EMAIL_PORT);
    if (port?.useFactory === undefined) {
      throw new Error('EmailModule no longer provides EMAIL_PORT by factory');
    }
    return port.useFactory(config(over));
  }

  it('binds the SMTP adapter for `smtp`', () => {
    expect(bind({})).toBeInstanceOf(SmtpEmailAdapter);
  });

  it('refuses to bind without its configuration', () => {
    expect(() => bind({ smtp: null })).toThrow(/SMTP configuration is missing/);
  });

  const expiresAt = new Date('2026-09-22T16:00:00.000Z');

  it('links an activation to the web client, with the token encoded', () => {
    const { subject, text } = compose(
      {
        kind: 'ACTIVATION',
        to: { email: 'a@example.test', name: 'Invented Person' },
        token: 'a+b/c=',
        expiresAt,
      },
      smtp.linkOrigin,
    );

    expect(subject).toBe('Set your password for DREAMS');
    expect(text).toContain('https://app.example.test/activate?token=a%2Bb%2Fc%3D');
    expect(text).toContain('Hello Invented Person,');
    // 16:00 UTC is midnight in Manila, the next day.
    expect(text).toMatch(/Sept? 23, 2026/);
  });

  it('links a reset to the reset page', () => {
    const { subject, text } = compose(
      {
        kind: 'PASSWORD_RESET',
        to: { email: 'a@example.test', name: '' },
        token: 'tok',
        expiresAt,
      },
      smtp.linkOrigin,
    );

    expect(subject).toBe('Reset your DREAMS password');
    expect(text).toContain('https://app.example.test/reset-password?token=tok');
    expect(text.startsWith('Hello,\n')).toBe(true);
  });

  it('tells the holder a password changed, pointing at the reset page and carrying no token', () => {
    const { subject, text } = compose(
      {
        kind: 'PASSWORD_CHANGED',
        to: { email: 'a@example.test', name: 'Invented Person' },
        changedAt: expiresAt,
      },
      smtp.linkOrigin,
    );

    expect(subject).toBe('Your DREAMS password was changed');
    expect(text).toContain('https://app.example.test/forgot-password');
    expect(text).not.toContain('token=');
    expect(text).toMatch(/Sept? 23, 2026/);
  });

  it('tells the Admin which name was paused, whose account it is, and when it opens', () => {
    const { subject, text } = compose(
      {
        kind: 'SIGN_IN_PAUSED',
        to: { email: 'admin@example.test', name: 'Invented Admin' },
        typed: { username: 'inventedname' },
        holder: 'Invented Person',
        pausedUntil: expiresAt,
      },
      smtp.linkOrigin,
    );

    expect(subject).toBe('DREAMS: sign-in paused after 10 wrong passwords');
    expect(text).toContain('the username inventedname');
    expect(text).toContain("Invented Person's account");
    expect(text).toMatch(/Sept? 23, 2026/);
    expect(text).not.toContain('token=');
  });

  it('links an email change to the confirmation page, with the token encoded', () => {
    const { subject, text } = compose(
      {
        kind: 'EMAIL_CHANGE',
        to: { email: 'new@example.test', name: 'Invented Person' },
        token: 'abc+/=',
        expiresAt,
      },
      smtp.linkOrigin,
    );

    expect(subject).toBe('Confirm your new DREAMS email address');
    expect(text).toContain('https://app.example.test/confirm-email?token=abc%2B%2F%3D');
  });

  it('tells the old address its email changed, saying when an administrator started it over', () => {
    const own = compose(
      {
        kind: 'EMAIL_CHANGED',
        to: { email: 'old@example.test', name: 'Invented Person' },
        changedAt: expiresAt,
        byAdministrator: false,
      },
      smtp.linkOrigin,
    );
    const restarted = compose(
      {
        kind: 'EMAIL_CHANGED',
        to: { email: 'old@example.test', name: 'Invented Person' },
        changedAt: expiresAt,
        byAdministrator: true,
      },
      smtp.linkOrigin,
    );

    expect(own.subject).toBe('Your DREAMS email address was changed');
    expect(own.text).toContain('Reset links now go to the new address');
    expect(restarted.text).toContain('An administrator changed the email address');
    expect(restarted.text).toContain('you were signed out');
    expect(own.text).not.toContain('token=');
    expect(restarted.text).not.toContain('token=');
  });
});
