import { Test } from '@nestjs/testing';
import { ModulesContainer } from '@nestjs/core';

import { AppModule } from '../../src/app.module';
import { CAPABILITY_METADATA } from '../../src/auth/authorization/authorization.decorators';
import { Capability } from '../../src/auth/authorization/capabilities';

import type { CapabilityRequirement } from '../../src/auth/authorization/authorization.decorators';

/**
 * Which of Section 7's two scope resolutions a route gets (SKILL.md section 7, decision
 * 0186).
 *
 * Section 7 settles that the **capability** decides and the HTTP method does not: exactly
 * three capabilities resolve "as of the period being viewed" — `cell.view_subtree`,
 * `reports.view_subtree` and `audit.view` — and every other capability resolves as a
 * write, through the Cell's current leader.
 *
 * **The guard cannot enforce that, because it branches on the target's `kind` and never
 * looks at the capability.** `{ kind: 'cell' }` takes `leaderForScope` and
 * `{ kind: 'cell_meeting' }` takes `leaderForMeetingScope`, whichever capability is
 * declared beside them. So a route declaring a viewing capability against a Cell-resolved
 * target would silently receive a resolution section 7 says it must not have, and nothing
 * in the application would notice.
 *
 * That is the gap this file closes, and it is here rather than as a guard branch for a
 * reason: **neither resolution the guard has is the viewing one.** `leaderForScope` is
 * the undated current-or-last leader and says so in its own docblock;
 * `leaderForMeetingScope` is the dated resolution serving a *recording* capability. A
 * resolution "as of the period being viewed" does not exist yet, and the first
 * Cell-targeted viewing route is what owes it.
 *
 * **So the rule that can fail today is the narrow one**: no route declares a viewing
 * capability against a Cell-resolved target. The first route that does reddens this, which
 * is the moment the dated read resolution is owed — and a red test naming the route is a
 * better way to learn that than a report quietly answering through the wrong leader.
 *
 * **That is a narrower trigger than "the first Stage 5 reporting read", which is what an
 * earlier version of this paragraph and of `cell-scope.port.ts` claimed.** Section 7 makes
 * a report's target a *scope selector* rather than a Cell, and section 22's reporting
 * routes are aggregate — so a Stage 5 report will most likely declare
 * `reports.view_subtree` against a scope selector, a `church` or an `actor` target, and
 * this file will stay green while the dated resolution goes on not existing. What
 * reddens it is the first **Cell-targeted** viewing route, which decision 0186 names
 * correctly and two paraphrases of it did not.
 *
 * Written against the compiled module graph rather than by grepping the source, on
 * `module-graph.spec.ts`'s reasoning: what is being checked is the shape Nest built. It
 * needs `DATABASE_URL` set and no database running (`test/setup/env.ts`).
 */
describe('which scope resolution a capability gets (section 7)', () => {
  /** Section 7's closed list of three. Everything else resolves as a write. */
  const VIEWING: Capability[] = [
    Capability.CellViewSubtree,
    Capability.ReportsViewSubtree,
    Capability.AuditView,
  ];

  /** The two target kinds the guard resolves through a Cell's leadership. */
  const CELL_RESOLVED = ['cell', 'cell_meeting'];

  interface DeclaredRoute {
    where: string;
    requirement: CapabilityRequirement;
  }

  async function declaredRoutes(): Promise<DeclaredRoute[]> {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const container = moduleRef.get(ModulesContainer, { strict: false });

    const found: DeclaredRoute[] = [];

    for (const module of container.values()) {
      for (const wrapper of module.controllers.values()) {
        const instance = wrapper.instance as object | undefined;
        if (instance === undefined || instance === null) {
          continue;
        }

        const prototype = Object.getPrototypeOf(instance) as object;

        for (const name of Object.getOwnPropertyNames(prototype)) {
          if (name === 'constructor') {
            continue;
          }

          const handler = (prototype as Record<string, unknown>)[name];
          if (typeof handler !== 'function') {
            continue;
          }

          // **Handler first, then the class, which is `getAllAndOverride`'s order.**
          // `CapabilityGuard` reads `[context.getHandler(), context.getClass()]`, so a
          // capability declared on a controller *class* governs every route in it — and a
          // scan reading only method metadata would not see one. Nothing declares one that
          // way today, which is exactly why it is the way a route could acquire a viewing
          // capability against a Cell-resolved target and pass this file.
          const requirement = (Reflect.getMetadata(CAPABILITY_METADATA, handler) ??
            Reflect.getMetadata(CAPABILITY_METADATA, prototype.constructor)) as
            CapabilityRequirement | undefined;

          if (requirement !== undefined) {
            found.push({ where: `${wrapper.name}.${name}`, requirement });
          }
        }
      }
    }

    await moduleRef.close();

    return found;
  }

  it('finds the routes it is meant to be checking', async () => {
    // **The vacuity guard, and this file is worthless without it.** Every assertion below
    // is over a filtered list, and a scan that silently found nothing would satisfy all of
    // them. The two meeting routes are named because they are the ones decision 0186 is
    // about, so a refactor that moves them out of this scan reddens this rather than
    // quietly emptying the checks beneath it.
    const routes = await declaredRoutes();

    expect(routes.length).toBeGreaterThan(20);
    expect(routes.map((route) => route.where)).toEqual(
      expect.arrayContaining([
        'CellMeetingsController.roster',
        'CellMeetingsController.submit',
        'CellMeetingsController.list',
      ]),
    );

    // And the two resolutions are both actually in use, so neither branch of the rule is
    // being asserted over an empty set.
    const kinds = new Set(routes.map((route) => route.requirement.target.kind));
    expect(kinds.has('cell')).toBe(true);
    expect(kinds.has('cell_meeting')).toBe(true);
  });

  it('gives no viewing capability a Cell-resolved target, because that resolution does not exist', async () => {
    const offending = (await declaredRoutes()).filter(
      (route) =>
        VIEWING.includes(route.requirement.capability) &&
        CELL_RESOLVED.includes(route.requirement.target.kind),
    );

    // Named rather than counted: the failure this exists for is a route somebody adds,
    // and the useful message is which one.
    expect(offending.map((route) => `${route.where} (${route.requirement.capability})`)).toEqual(
      [],
    );
  });

  it('gives every Cell meeting target a recording capability', async () => {
    // Section 7 places a Cell meeting per record and the guard's dated resolution is
    // written for the closed-Cell recording exception. `cell.take_attendance` guards the
    // first submission and `cell.correct_subtree` the correction, which is section 7's
    // own split -- so those two are what may name this target.
    //
    // Stricter than the rule above, deliberately. Section 7 forbids only a *viewing*
    // capability here; a management capability would be permitted by the letter and is
    // meaningless, since the dated resolution exists for recording. Slice 2c adds the
    // correction routes, and this is what tells their author which capability the target
    // expects.
    const recording: Capability[] = [Capability.CellTakeAttendance, Capability.CellCorrectSubtree];

    const offending = (await declaredRoutes()).filter(
      (route) =>
        route.requirement.target.kind === 'cell_meeting' &&
        !recording.includes(route.requirement.capability),
    );

    expect(offending.map((route) => `${route.where} (${route.requirement.capability})`)).toEqual(
      [],
    );
  });
});
