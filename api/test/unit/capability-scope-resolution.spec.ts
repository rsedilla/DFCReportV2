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
 * **So the rule that can fail is the narrow one**: no route declares a viewing capability
 * against a Cell-resolved target except the undated reads named in the allowlist below. The
 * next route to do so reddens this, and a red test naming the route is a better way to learn
 * that than a report quietly answering through the wrong leader.
 *
 * **The allowlist arrived with decision 0204**, which moved `GET /api/v1/cells/{id}/members`
 * onto `cell.view_subtree` and found this case refusing it. What the case is *for* is a read
 * that asks about a past period and would silently get the undated resolution; a read naming
 * no period is asking about now, which is what `leaderForScope` answers. The two were being
 * enforced as one.
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
 * **Two rules, not one, since 2026-09-03.** The cases above are about which *resolution* a
 * capability gets. The last case is about a declaration's *shape* — that two named routes
 * carry the identical one — which serves section 7's ordering rule rather than its
 * resolution rule. They share this file because both are properties of the declarations
 * Nest compiled and both are checked the same way, and the distinction is stated because
 * an earlier version of this docblock said "that is the gap this file closes", singular,
 * while the file had already grown a second one.
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

  /**
   * The one Cell-targeted viewing route, and the period it asks about (decision 0204).
   *
   * An allowlist rather than a blanket refusal, because the obligation this case names is
   * owed by a *dated* read and not by every route in the viewing class. Section 7 defines
   * the phrase under *An effective date does not move the scope decision*: "the period a
   * request under a viewing capability is asking about". A request naming no period is
   * asking about now, and `leaderForScope` — the current leader, falling back to the last
   * where the Cell is closed — is the resolution for now.
   *
   * So this route receives exactly the resolution section 7 prescribes for it, and the
   * earlier form of this case refused it on a trigger that conflated "declares a viewing
   * capability" with "asks about a past period".
   *
   * **The teeth are in the allowlist being exhaustive.** Any other Cell-targeted viewing
   * route reddens this and its author has to say which period it asks about — and if the
   * answer is a past month, the dated resolution it owes still does not exist.
   */
  const UNDATED_CELL_VIEWING: string[] = ['CellsController.members'];

  it('gives a Cell-resolved target no viewing capability but the undated reads named here', async () => {
    const offending = (await declaredRoutes()).filter(
      (route) =>
        VIEWING.includes(route.requirement.capability) &&
        CELL_RESOLVED.includes(route.requirement.target.kind) &&
        !UNDATED_CELL_VIEWING.includes(route.where),
    );

    // Named rather than counted: the failure this exists for is a route somebody adds,
    // and the useful message is which one.
    expect(offending.map((route) => `${route.where} (${route.requirement.capability})`)).toEqual(
      [],
    );
  });

  it('finds every route the allowlist names, so it cannot outlive one', async () => {
    // Without this the allowlist is a list of strings nothing checks. A renamed or deleted
    // handler would leave an entry permitting a route that no longer exists, and the next
    // route to take that name would be exempted silently.
    const routes = await declaredRoutes();

    for (const allowed of UNDATED_CELL_VIEWING) {
      const route = routes.find((candidate) => candidate.where === allowed);
      expect(route).toBeDefined();
      expect(VIEWING).toContain(route?.requirement.capability);
      expect(CELL_RESOLVED).toContain(route?.requirement.target.kind);
    }
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

  it('declares the roster read and the submit route identically, which section 7 depends on', async () => {
    // **Section 7's ordering rule rests on this, and rested on it silently until now.**
    // "Every other capability the write owes is decided before the record's *contents*
    // can change what the caller is told" permits the submit path to read the meeting row
    // and refuse a status change before the on-behalf check. That is safe only because the status, version and
    // submitter it exposes are already handed to the same actor by the roster read -- and
    // "the same actor" is true only while the two routes carry the identical capability
    // and target declaration.
    //
    // Give the roster its own viewing capability -- which `CLAUDE.md` records as open for
    // exactly these routes, and which the case above says does not yet exist -- and the
    // two stop admitting the same actors, at which point the submit path's early refusal
    // starts answering something no read answers. That is a disclosure appearing with no
    // line of the attendance code changed, so it is asserted here rather than left to a
    // reviewer noticing two decorators drifting apart.
    const routes = await declaredRoutes();
    const roster = routes.find((route) => route.where === 'CellMeetingsController.roster');
    const submit = routes.find((route) => route.where === 'CellMeetingsController.submit');

    // Named, not just compared. `find` returns undefined for a renamed handler, and two
    // undefineds are equal -- which would pass this case with neither route in the scan.
    expect(roster).toBeDefined();
    expect(submit).toBeDefined();

    expect(roster?.requirement).toEqual(submit?.requirement);
  });
});
