import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Logger } from '@nestjs/common';

import { type AppConfig } from '../../src/config/configuration';
import { EMAIL_PORT } from '../../src/email/email.port';
import { EmailModule } from '../../src/email/email.module';
import { LoggingEmailAdapter } from '../../src/email/logging-email.adapter';
import { OutboxEmailAdapter } from '../../src/email/outbox-email.adapter';

/**
 * The adapter and the one line that chooses it (SKILL.md section 6, ruling of
 * 2026-09-11).
 *
 * **Both of these existed with nothing that could fail on them.** `architecture-guardian`
 * inverted `email.module.ts`'s selection — binding the outbox wherever configuration says
 * `log` — and the whole suite stayed green, because `fixtures.ts` overrides `EMAIL_PORT`
 * for every application it builds, so no end-to-end case can reach either adapter. The
 * adapter itself had no test at all.
 *
 * These need no database server and no `NODE_ENV`: the module is built from a config
 * object directly, which is also what lets the outbox case run under the suite's own
 * `NODE_ENV=test`, where `loadConfig` would refuse it.
 */
describe('the development email transport (section 6)', () => {
  const config = (over: Partial<AppConfig>): AppConfig => ({
    nodeEnv: 'development',
    port: 3001,
    databaseUrl: 'postgresql://x:y@127.0.0.1:5432/z',
    jwtSecret: '0123456789012345678901234567890123456789',
    corsAllowedOrigins: [],
    seniorPastorPersonIds: [],
    emailTransport: 'log',
    emailOutboxDir: null,
    ...over,
  });

  function bind(over: Partial<AppConfig>): unknown {
    const factory = Reflect.getMetadata('providers', EmailModule) as {
      provide?: symbol;
      useFactory?: (...args: unknown[]) => unknown;
    }[];
    const port = factory.find((p) => p.provide === EMAIL_PORT);
    if (port?.useFactory === undefined) {
      throw new Error('EmailModule no longer provides EMAIL_PORT by factory');
    }
    return port.useFactory(config(over), new LoggingEmailAdapter(), {});
  }

  describe('which adapter the module binds', () => {
    it('binds the logging adapter for `log`', () => {
      expect(bind({ emailTransport: 'log' })).toBeInstanceOf(LoggingEmailAdapter);
    });

    it('binds the outbox adapter for `outbox`, and not the logging one', () => {
      expect(bind({ emailTransport: 'outbox', emailOutboxDir: '/tmp/x' })).not.toBeInstanceOf(
        LoggingEmailAdapter,
      );
    });
  });

  describe('what the adapter writes', () => {
    let dir: string;

    const message = {
      kind: 'ACTIVATION' as const,
      to: { email: 'leader@example.test', name: 'Invented Person' },
      token: 'a-token-nobody-else-uses',
      expiresAt: new Date('2026-09-17T16:23:07.618Z'),
    };

    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), 'dfc-outbox-'));
    });

    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    it('writes one file carrying the token, the recipient and the expiry', async () => {
      await new OutboxEmailAdapter(config({ emailTransport: 'outbox', emailOutboxDir: dir })).send(
        message,
      );

      const written = await readdir(dir);
      expect(written).toHaveLength(1);

      const contents = await readFile(join(dir, written[0]), 'utf8');
      expect(contents).toContain(message.token);
      expect(contents).toContain('leader@example.test');
      expect(contents).toContain('2026-09-17T16:23:07.618Z');
    });

    it('does not collide when one person is sent two messages', async () => {
      const adapter = new OutboxEmailAdapter(
        config({ emailTransport: 'outbox', emailOutboxDir: dir }),
      );

      await adapter.send(message);
      await adapter.send(message);

      expect(await readdir(dir)).toHaveLength(2);
    });

    /**
     * The docblock says "the path, never the contents", and a log is the one place
     * section 6 says a token must not reach. Asserted rather than described.
     */
    it('logs the path and never the token', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      await new OutboxEmailAdapter(config({ emailTransport: 'outbox', emailOutboxDir: dir })).send(
        message,
      );

      const logged = warn.mock.calls.map((call) => String(call[0])).join('\n');
      expect(logged).toContain(dir);
      expect(logged).not.toContain(message.token);

      warn.mockRestore();
    });

    it('refuses rather than writing a credential to a directory nobody chose', async () => {
      await expect(
        new OutboxEmailAdapter(config({ emailTransport: 'outbox', emailOutboxDir: null })).send(
          message,
        ),
      ).rejects.toThrow(/EMAIL_OUTBOX_DIR is unset/);
    });
  });
});
