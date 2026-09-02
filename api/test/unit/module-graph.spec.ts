import { Test } from '@nestjs/testing';

import { AppModule } from '../../src/app.module';
import { AccessTokenGuard } from '../../src/auth/authorization/access-token.guard';
import { AuthorizationService } from '../../src/auth/authorization/authorization.service';
import { CapabilityGuard } from '../../src/auth/authorization/capability.guard';
import { CELL_MEETING_SCOPE_PORT } from '../../src/auth/authorization/cell-meeting-scope.port';
import { CELL_SCOPE_PORT } from '../../src/auth/authorization/cell-scope.port';
import { CredentialsService } from '../../src/auth/credentials.service';
import { CellMeetingsScopeService } from '../../src/attendance/cell-meetings.scope.service';
import { CellsReadService } from '../../src/cells/cells.read.service';
import { NetworksService } from '../../src/networks/networks.service';

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

  it('hands every port to the consumer that injects it', async () => {
    // **Every port reaches its consumer, and nothing asserted this until the ruling of
    // 2026-09-01.** Two of the three are injected `@Optional()`, which is what that
    // ruling settles: an inversion port is optional so a missing binding costs one
    // operation rather than the whole application, and the operation then refuses
    // rather than skipping its check.
    //
    // The cost of optional is that an unbound token cannot fail at startup, so a wiring
    // fault surfaces wherever the operation is exercised. Binding
    // `CELL_RELATIONSHIPS_PORT` in the wrong context — `AppModule`'s provider list
    // rather than a module registering `NetworksService` — turned **fifteen**
    // sex-correction cases red at once, in CI, with nothing local able to catch it.
    // This is what makes that one red case here instead.
    //
    // **It asserts the consumer's field, not `moduleRef.get(TOKEN)`, and the first
    // version did the latter.** `get` with `strict: false` searches the whole container,
    // so it finds a provider registered in a module that does not export it — and the
    // fault being guarded against is exactly a token that exists somewhere and does not
    // reach the class needing it. Removing `exports: [CELL_RELATIONSHIPS_PORT]` from the
    // binding module left that version green, which is a wiring test with nothing that
    // can fail on it, in the file whose whole purpose is to fail.
    //
    // Private fields, read through a cast. What is being checked is the shape Nest
    // built rather than the class's own API, and the alternative — calling a method
    // that refuses when unbound — needs a database and would move this out of the unit
    // suite, which is the one property this file has that CI-only tests do not.
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    const consumers: [string, unknown, string][] = [
      // `CELL_RELATIONSHIPS_PORT` — the Network-change precondition (SKILL.md section 4).
      // This is the pair the historical fault actually broke.
      ['CELL_RELATIONSHIPS_PORT', moduleRef.get(NetworksService, { strict: false }), 'cells'],
      // `EMAIL_PORT`, mandatory, and asserted with them anyway: mandatory injection
      // catches an unbound token only where something constructs the consumer, and a
      // partial graph may construct nothing — the same "no such graph exists yet" that
      // made mandatory look safe for the other two.
      ['EMAIL_PORT', moduleRef.get(CredentialsService, { strict: false }), 'email'],
    ];

    for (const [token, consumer, field] of consumers) {
      expect({ token, bound: (consumer as Record<string, unknown>)[field] !== undefined }).toEqual({
        token,
        bound: true,
      });
    }

    // **`CELL_SCOPE_PORT` is asserted on the token, and that is weaker on purpose.**
    // Its consumer is `CapabilityGuard`, registered as `{ provide: APP_GUARD, useClass:
    // CapabilityGuard }` — so the instance Nest runs is held under `APP_GUARD`, and
    // fetching the class token yields a *different* instance, constructed without the
    // optional dependency. Asserting a field on that one reports `cellScope` undefined
    // while the live guard has it, which is a false red; the first version of this case
    // did exactly that and failed on an application that is correctly wired.
    //
    // So this checks what it can check soundly: the token resolves, and to the same
    // `CellsReadService` the `useExisting` binding names. Whether the running guard
    // received it is covered behaviourally by `test/api/guard.e2e.spec.ts`, which
    // exercises Cell-scoped authorization end to end.
    expect(moduleRef.get(CELL_SCOPE_PORT, { strict: false })).toBe(
      moduleRef.get(CellsReadService, { strict: false }),
    );

    // **`CELL_MEETING_SCOPE_PORT`, on the same terms and for a sharper reason**
    // (decision 0188). This one is bound to a provider in `AttendanceModule`, while the
    // binding lives in `AppModule` — which is exactly the arrangement that broke
    // `CELL_RELATIONSHIPS_PORT` once, because Nest resolves a provider's dependencies
    // in the module that *registers* it. Dropping `CellMeetingsScopeService` from
    // `AttendanceModule`'s `exports` is the mutation this catches, and the guard's
    // optional injection means nothing else would: every Cell-meeting route would
    // answer `CAPABILITY_DENIED` with a message about the deployment, in CI, on an
    // application that compiles.
    expect(moduleRef.get(CELL_MEETING_SCOPE_PORT, { strict: false })).toBe(
      moduleRef.get(CellMeetingsScopeService, { strict: false }),
    );

    // The two ports are distinct objects as well as distinct tokens. Binding both to
    // one class would type-check — `CellsReadService` no longer declares
    // `leaderForMeetingScope`, but a future edit could give it one — and would put the
    // meeting resolution back in the module that does not own `cell_meetings`.
    expect(moduleRef.get(CELL_MEETING_SCOPE_PORT, { strict: false })).not.toBe(
      moduleRef.get(CELL_SCOPE_PORT, { strict: false }),
    );

    await moduleRef.close();
  });
});
