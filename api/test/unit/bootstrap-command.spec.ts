import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The two facts that decide whether the first Admin can be created **on a real
 * server**, neither of which any other test can reach.
 *
 * SKILL.md section 6 makes `bootstrap:admin` the sole path to a first Admin: no
 * endpoint, no seed, no fallback. So the ways it can be unrunnable are ways an
 * installation ends up with a migrated database, thirty leaders ready to import,
 * and nobody who can sign in — and both of them are one edit to `package.json`.
 *
 * Asserting on `package.json` is a weak kind of test and is deliberate. The
 * behaviour it stands for — Nest resolving providers under a given loader, on a
 * host installed without dev dependencies — cannot be exercised from a suite that
 * `ts-jest` compiles and that runs from a full checkout. What this does discriminate
 * is the edit: changing either fact turns it red with the reason attached, which is
 * more than the docblocks alone were doing.
 */
describe('the first-Admin command stays runnable (SKILL.md section 6)', () => {
  const manifest = JSON.parse(
    readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8'),
  ) as {
    scripts: Record<string, string>;
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  };

  it('runs under ts-node, because tsx leaves every injected dependency undefined', () => {
    // `tsx` compiles with esbuild, which does not implement `emitDecoratorMetadata`.
    // Without `design:paramtypes` Nest sees zero constructor parameters and injects
    // nothing — so the container is broadly hollow, not selectively so, and the
    // failure arrives as "Cannot read properties of undefined" from inside a
    // service with nothing wrong at build time.
    //
    // An earlier version of this command ran under `tsx` and appeared to work,
    // because the one method it called on the one service with an undecorated
    // dependency never dereferenced it. That is not a property anybody can check
    // by reading.
    expect(manifest.scripts['bootstrap:admin']).toMatch(/^ts-node /);
  });

  it('depends on ts-node in production, not only in development', () => {
    // A host built with `npm ci --omit=dev` has no devDependencies. Section 6 puts
    // the operator "running the command themselves on the server", and the command
    // is TypeScript under `scripts/` — so without this the only path to a first
    // Admin does not exist in the environment section 6 names for it.
    expect(manifest.dependencies['ts-node']).toBeDefined();
    expect(manifest.devDependencies['ts-node']).toBeUndefined();
  });
});
