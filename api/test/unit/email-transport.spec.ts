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
    it('carries the directory it was given', () => {
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

    // The load-bearing half of the ruling. Not "does not deliver" — refuses to start.
    it('stops the process in production, even with a directory configured', () => {
      set('NODE_ENV', 'production');
      set('EMAIL_TRANSPORT', 'outbox');
      set('EMAIL_OUTBOX_DIR', '/tmp/outbox');

      expect(() => loadConfig()).toThrow(/must never run in production/);
    });

    // The refusal is about the environment, so it must not be escapable by omitting the
    // directory and getting the other error instead.
    it('stops the process in production even with no directory configured', () => {
      set('NODE_ENV', 'production');
      set('EMAIL_TRANSPORT', 'outbox');
      set('EMAIL_OUTBOX_DIR', undefined);

      expect(() => loadConfig()).toThrow(/must never run in production/);
    });
  });

  it('refuses a transport nobody implements, rather than falling back to the default', () => {
    set('EMAIL_TRANSPORT', 'ses');

    expect(() => loadConfig()).toThrow(/EMAIL_TRANSPORT must be one of/);
  });
});
