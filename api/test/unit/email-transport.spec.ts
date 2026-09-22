import { loadConfig } from '../../src/config/configuration';

/**
 * Which transport is bound, and the refusal that makes the outbox safe to ship
 * (SKILL.md section 6, ruling of 2026-09-11).
 *
 * **The production refusal is the case that matters.** The outbox writes an activation
 * token to a file; section 6 admits that on the terms it already admits `bootstrap:admin`
 * printing one, and none of those terms holds on a production host. A rule stated in the
 * specification with nothing that can fail on it is what this repository keeps refusing
 * to ship, so it is asserted here rather than described in a docblock.
 *
 * These read configuration and touch no database server, but `loadConfig` requires
 * `DATABASE_URL` and the shared harness requires it earlier still — a dummy satisfies
 * both, as `senior-pastors.spec.ts` already notes.
 */
describe('the email transport (section 6)', () => {
  const originalTransport = process.env.EMAIL_TRANSPORT;
  const originalDir = process.env.EMAIL_OUTBOX_DIR;
  const originalNodeEnv = process.env.NODE_ENV;

  function set(name: string, value: string | undefined): void {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }

  afterEach(() => {
    set('EMAIL_TRANSPORT', originalTransport);
    set('EMAIL_OUTBOX_DIR', originalDir);
    set('NODE_ENV', originalNodeEnv);
  });

  describe('the default', () => {
    it('is `log` when the variable is unset, so no deployment changes by taking this', () => {
      set('EMAIL_TRANSPORT', undefined);

      expect(loadConfig().emailTransport).toBe('log');
      expect(loadConfig().emailOutboxDir).toBeNull();
    });

    it('is `log` when the variable is present and blank, which is what a template renders', () => {
      set('EMAIL_TRANSPORT', '');

      expect(loadConfig().emailTransport).toBe('log');
    });
  });

  describe('the outbox', () => {
    it('binds where NODE_ENV is explicitly development, and carries its directory', () => {
      set('NODE_ENV', 'development');
      set('EMAIL_TRANSPORT', 'outbox');
      set('EMAIL_OUTBOX_DIR', '/tmp/outbox');

      const config = loadConfig();

      expect(config.emailTransport).toBe('outbox');
      expect(config.emailOutboxDir).toBe('/tmp/outbox');
    });

    it('refuses without a directory rather than defaulting one', () => {
      set('NODE_ENV', 'development');
      set('EMAIL_TRANSPORT', 'outbox');
      set('EMAIL_OUTBOX_DIR', undefined);

      expect(() => loadConfig()).toThrow(/EMAIL_OUTBOX_DIR is required/);
    });

    /**
     * The load-bearing half of the ruling, and the case a first version got wrong.
     *
     * `NODE_ENV` is optional and the resolved value *defaults* to `development`, so a
     * refusal written against that value treats an absent variable as a developer's
     * laptop. `npm run start:prod` sets nothing and `dotenv` is loaded in every
     * environment, so a production host with `EMAIL_TRANSPORT=outbox` in its `.env` and
     * no exported `NODE_ENV` wrote credentials to disk. Every row below except the last
     * must refuse.
     */
    it.each([
      ['test', 'test'],
      ['production', 'production'],
    ])('refuses to start when NODE_ENV is %s, even with a directory configured', (_l, value) => {
      set('NODE_ENV', value);
      set('EMAIL_TRANSPORT', 'outbox');
      set('EMAIL_OUTBOX_DIR', '/tmp/outbox');

      expect(() => loadConfig()).toThrow(/binds only where NODE_ENV is explicitly "development"/);
    });

    /**
     * These refuse too, and it is an **earlier** guard that catches them — `NODE_ENV` is
     * required and then validated against the three names, before any transport is
     * chosen. The property that matters is that the process stops, and both rows are
     * asserted rather than one being written as though it were the other.
     *
     * **`unset` sits here since the ruling of 2026-09-11** and sat in the group above
     * before it. That is the whole of what requiring the variable changed: the case that
     * silently meant `development` now refuses, and refuses one guard earlier.
     */
    it.each([
      ['the wrong case', 'Development'],
      ['padded', ' development '],
    ])('refuses to start when NODE_ENV is %s, at the NODE_ENV guard', (_l, value) => {
      set('NODE_ENV', value);
      set('EMAIL_TRANSPORT', 'outbox');
      set('EMAIL_OUTBOX_DIR', '/tmp/outbox');

      expect(() => loadConfig()).toThrow(/NODE_ENV must be development, test or production/);
    });

    it.each([
      ['unset', undefined],
      ['blank', ''],
    ])('refuses to start when NODE_ENV is %s, because it is required', (_l, value) => {
      set('NODE_ENV', value);
      set('EMAIL_TRANSPORT', 'outbox');
      set('EMAIL_OUTBOX_DIR', '/tmp/outbox');

      expect(() => loadConfig()).toThrow(/NODE_ENV is required/);
    });

    // The refusal is about the environment, so it must not be escapable by omitting the
    // directory and collecting the other error instead.
    it('refuses on the environment before it asks about the directory', () => {
      set('NODE_ENV', 'production');
      set('EMAIL_TRANSPORT', 'outbox');
      set('EMAIL_OUTBOX_DIR', undefined);

      expect(() => loadConfig()).toThrow(/binds only where NODE_ENV is explicitly "development"/);
    });
  });

  describe('smtp', () => {
    const SMTP_VARS = [
      'SMTP_HOST',
      'SMTP_PORT',
      'SMTP_USER',
      'SMTP_PASSWORD',
      'EMAIL_FROM',
      'EMAIL_LINK_ORIGIN',
    ] as const;
    const saved = Object.fromEntries(SMTP_VARS.map((name) => [name, process.env[name]]));

    beforeEach(() => {
      set('NODE_ENV', 'production');
      set('EMAIL_TRANSPORT', 'smtp');
      set('SMTP_HOST', 'smtp.example.test');
      set('SMTP_PORT', '587');
      set('SMTP_USER', 'user');
      set('SMTP_PASSWORD', 'not-a-real-password');
      set('EMAIL_FROM', 'Church <no-reply@example.test>');
      set('EMAIL_LINK_ORIGIN', 'https://app.example.test');
    });

    afterEach(() => {
      for (const name of SMTP_VARS) {
        set(name, saved[name]);
      }
    });

    it('binds in production, requiring STARTTLS on 587 and implicit TLS on 465', () => {
      const config = loadConfig();

      expect(config.emailTransport).toBe('smtp');
      expect(config.smtp).toMatchObject({
        port: 587,
        secure: false,
        linkOrigin: 'https://app.example.test',
      });

      set('SMTP_PORT', '465');
      expect(loadConfig().smtp?.secure).toBe(true);
    });

    it('accepts an origin with a trailing slash, and stores it without one', () => {
      set('EMAIL_LINK_ORIGIN', 'https://app.example.test/');

      expect(loadConfig().smtp?.linkOrigin).toBe('https://app.example.test');
    });

    it.each(SMTP_VARS)('refuses to start without %s', (name) => {
      set(name, undefined);

      expect(() => loadConfig()).toThrow(new RegExp(`${name} is required`));
    });

    it.each([
      ['a path', 'https://app.example.test/activate'],
      ['a query', 'https://app.example.test/?x=1'],
      ['plain http outside development', 'http://app.example.test'],
      ['not a URL', 'app.example.test'],
    ])('refuses a link origin with %s', (_l, value) => {
      set('EMAIL_LINK_ORIGIN', value);

      expect(() => loadConfig()).toThrow(/EMAIL_LINK_ORIGIN must/);
    });

    it('refuses a From header carrying a line break', () => {
      set('EMAIL_FROM', 'no-reply@example.test\r\nBcc: x@example.test');

      expect(() => loadConfig()).toThrow(/EMAIL_FROM must be an address/);
    });
  });

  it('refuses a transport nobody implements, rather than falling back to the default', () => {
    set('EMAIL_TRANSPORT', 'ses');

    expect(() => loadConfig()).toThrow(/EMAIL_TRANSPORT must be one of/);
  });
});
