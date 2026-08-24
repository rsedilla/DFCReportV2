import { Test } from '@nestjs/testing';

import { AppModule } from '../../src/app.module';
import { AccessTokenGuard } from '../../src/auth/authorization/access-token.guard';
import { AuthorizationService } from '../../src/auth/authorization/authorization.service';
import { CapabilityGuard } from '../../src/auth/authorization/capability.guard';

/**
 * The application's dependency graph resolves (SKILL.md section 2).
 *
 * **This exists because a whole class of defect is invisible to everything else
 * that runs without a database.** `tsc` type-checks the imports and says nothing
 * about the injector; the unit suite never builds the application; and the e2e
 * suite, which does, only runs in CI. So a module wired wrongly compiles clean,
 * passes every local check, and fails on the first request of every endpoint.
 *
 * That is not hypothetical. Splitting the authorization seam out of `AuthModule`
 * left `AuthorizationModule` imported by `AuthModule` and not re-exported, while
 * `CapabilityGuard` is registered globally in `AppModule` — and Nest resolves a
 * provider's dependencies in the context of the module that *registers* it, not
 * the one the class lives in. Every authenticated request failed with "Nest can't
 * resolve dependencies of the CapabilityGuard". CI caught it; nothing local could.
 *
 * `compile()` builds the injector without opening a connection, so this needs a
 * `DATABASE_URL` to be set and no database to be running (`test/setup/env.ts`).
 */
describe('the application module graph (section 2)', () => {
  it('resolves every global guard from AppModule, where they are registered', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    // Resolved rather than merely compiled. A guard whose dependency is missing
    // throws here, which is the failure this file exists to move out of CI.
    expect(moduleRef.get(AccessTokenGuard, { strict: false })).toBeDefined();
    expect(moduleRef.get(CapabilityGuard, { strict: false })).toBeDefined();

    // The dependency that was actually unreachable, named so a regression says
    // which edge broke rather than only that something did.
    expect(moduleRef.get(AuthorizationService, { strict: false })).toBeDefined();

    await moduleRef.close();
  });
});
