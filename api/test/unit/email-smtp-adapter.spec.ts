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
    databaseUrl: 'postgresql://x:y@127.0.0.1:5432/z',
    jwtSecret: '0123456789012345678901234567890123456789',
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

    expect(subject).toMatch(/Set your password/);
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

    expect(subject).toMatch(/Reset your/);
    expect(text).toContain('https://app.example.test/reset-password?token=tok');
    expect(text.startsWith('Hello,\n')).toBe(true);
  });
});
