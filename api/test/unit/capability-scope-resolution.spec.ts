import { Test } from '@nestjs/testing';
import { ModulesContainer } from '@nestjs/core';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { getMetadataStorage } from 'class-validator';

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
    /** The handler's parameter classes, for the DTO check the allowlist owes. */
    paramTypes: unknown[];
    /** The keys named by `@Param('x')` / `@Query('x')`, which carry no DTO. */
    argumentKeys: string[];
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
            const paramTypes = (Reflect.getMetadata('design:paramtypes', prototype, name) ??
              []) as unknown[];

            // Nest keys this `<paramtype>:<index>`, and `data` is the string a decorator
            // named — `id` for `@Param('id')`, absent for a whole-DTO `@Query()`.
            const args = (Reflect.getMetadata(ROUTE_ARGS_METADATA, prototype.constructor, name) ??
              {}) as Record<string, { data?: unknown }>;
            const argumentKeys = Object.values(args)
              .map((argument) => argument.data)
              .filter((data): data is string => typeof data === 'string');

            found.push({
              where: `${wrapper.name}.${name}`,
              requirement,
              paramTypes,
              argumentKeys,
            });
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

  /**
   * The converse, for the third resolution decision 0214 added.
   *
   * **`report_scope` is dated by construction** — it carries the instant the figures use,
   * and `reportScopeCovers` walks the tree as of it. So a route declaring a *recording*
   * capability against one would silently receive a resolution as of a past period, which
   * is the mirror of the defect this file was written for: section 7 names three viewing
   * capabilities and the guard branches on the target's kind, never on the capability.
   *
   * The existing case above cannot catch it — it asks which capability a Cell-resolved
   * target carries, and this kind is not Cell-resolved. Written when the third resolution
   * landed rather than after something used it wrongly.
   */
  it('gives a report scope selector only a viewing capability (section 7)', async () => {
    const offending = (await declaredRoutes()).filter(
      (route) =>
        route.requirement.target.kind === 'report_scope' &&
        !VIEWING.includes(route.requirement.capability),
    );

    expect(offending.map((route) => `${route.where} (${route.requirement.capability})`)).toEqual(
      [],
    );

    // And the run reached something: a filter matching no route at all would pass this
    // vacuously, which is the shape this whole file refuses.
    const selectors = (await declaredRoutes()).filter(
      (route) => route.requirement.target.kind === 'report_scope',
    );
    expect(selectors.length).toBeGreaterThan(0);
  });

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

  /**
   * Names that would make a request ask about a period other than now.
   *
   * **Matched as tokens of a normalised name rather than as whole names.** A hand-written
   * list of whole names missed `actual_date`, which is a property name this repository
   * already uses (`SubmitCellMeetingDto`), and would go on missing `start_date`,
   * `date_from`, `week` and the rest of the family.
   *
   * Two passes, because one does not reach both families. The long tokens are looked for
   * inside the name normalised to lowercase alphanumerics, which is what catches `as_of`
   * and `reporting_month` after their separators are gone. The short names are compared
   * against the name's *tokens*, split on separators and camel-case boundaries, which is
   * what catches `started_at` and `ended_at` -- this repository's own effective-dating
   * pair, and a family a single normalised-string pass misses entirely, because
   * `startedat` neither equals `start` nor contains a long token. *A first version of this
   * docblock claimed the one pass "catches all of them" and it did not.*
   *
   * A false positive is the fail-safe direction: it is a red test somebody has to argue
   * about, which is the outcome this file exists to force. The three the allowlisted route
   * actually takes -- the `id` it binds by `@Param`, and `limit` and `cursor` off its DTO
   * -- match nothing here. *Written as "the two" in the batch that made it three.*
   */
  const PERIOD_TOKENS = [
    'date',
    'month',
    'year',
    'week',
    'quarter',
    'period',
    'asof',
    'since',
    'until',
    'effective',
    'reporting',
  ];

  /** Whole names that are period-bearing but too short to look for inside another word. */
  const PERIOD_NAMES = new Set(['from', 'to', 'day', 'before', 'after', 'at', 'start', 'end']);

  function namesAPeriod(property: string): boolean {
    const normalised = property.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (PERIOD_TOKENS.some((token) => normalised.includes(token))) {
      return true;
    }

    // Split on separators and camel-case boundaries, so `started_at` and `startedAt` both
    // yield an `at` token. Compared exactly, never as a substring: `at` inside `category`
    // is not a period and refusing it would make the check useless.
    const tokens = property
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token !== '');

    return tokens.some((token) => PERIOD_NAMES.has(token));
  }

  it('lets no allowlisted route take a period, which is the property it is exempt for', async () => {
    // **The allowlist's exemption rests on the route naming no period, and this is what
    // checks that.** Section 7: "A viewing request that names no period is asking about
    // now", so `leaderForScope` answers correctly for it. The case beside this one asserts
    // the route exists and is viewing-against-a-Cell; neither of those is the property the
    // exemption is *for*, and without this case a `month` parameter added later would be
    // exempted silently -- the failure the tripwire exists to catch, reached through the one
    // route it no longer watches.
    //
    // **Both ways Nest takes a parameter *by name* are read**, because covering one of
    // them is how this kind of check ships looking complete. A third shape contributes
    // nothing and is stated rather than implied: a whole-object binding whose metatype
    // carries no class-validator metadata (`@Query() q: Record<string, string>`, `@Req()`)
    // yields `Object`, returns no metadata, and is not refused by `ValidationPipe` either.
    // Nothing binds that way today. A `@Query()` DTO contributes its validated
    // property names, derived from class-validator's own metadata on
    // `storable-text-coverage.spec.ts`'s reasoning -- a property added next year is inside
    // the check without its author knowing it exists. A `@Param('month')` or
    // `@Query('month')` contributes the key it names, which carries no DTO and would
    // otherwise be invisible.
    const routes = await declaredRoutes();

    const offending: string[] = [];

    for (const allowed of UNDATED_CELL_VIEWING) {
      const route = routes.find((candidate) => candidate.where === allowed);
      expect(route).toBeDefined();

      const accepted: string[] = [];

      for (const paramType of route?.paramTypes ?? []) {
        if (typeof paramType !== 'function') {
          continue;
        }

        const metadatas = getMetadataStorage().getTargetValidationMetadatas(
          paramType,
          '',
          false,
          false,
        );

        for (const property of new Set(metadatas.map((metadata) => metadata.propertyName))) {
          accepted.push(`${(paramType as { name: string }).name}.${property}`);
        }
      }

      for (const key of route?.argumentKeys ?? []) {
        accepted.push(key);
      }

      // **Counted per route rather than once for the whole loop.** An aggregate counter is
      // satisfied by the first route that has a DTO, so a second allowlisted route taking
      // its period some other way would be inspected zero times and pass -- which is the
      // one-rule-one-path shape `CLAUDE.md` records as this project's recurring fix-batch
      // defect, and the first version of this case had it.
      expect(accepted.length).toBeGreaterThan(0);

      // **And per *source*, which is that shape one level down.** The line above is
      // satisfied by the DTO alone, so if the `ROUTE_ARGS_METADATA` read ever stopped
      // resolving -- a Nest upgrade moving where it writes, a controller shape it does not
      // reach -- the `@Query('month')` blind spot would reopen and nothing would go red. A
      // mutation proves that read works today; it does not keep proving it. Every route on
      // this allowlist binds at least its Cell id by name, so requiring one key is a
      // property of the allowlist rather than of this one route.
      expect(route?.argumentKeys ?? []).not.toHaveLength(0);

      for (const name of accepted) {
        const property = name.slice(name.indexOf('.') + 1);
        if (namesAPeriod(property)) {
          offending.push(`${allowed} takes ${name}`);
        }
      }
    }

    expect(offending).toEqual([]);
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
    // Give the roster its own viewing capability -- which decision 0204 did for
    // `GET /cells/{id}/members` while leaving these two deliberately untouched -- and the
    // two stop being *guaranteed* to admit the same actors, at which point the submit
    // path's early refusal can start answering something no read answers. *Guaranteed
    // rather than flatly: `role-defaults.ts` gives `cell.take_attendance` and
    // `cell.view_subtree` the identical scope at all three roles, so an account holding
    // only role defaults would go on reaching both. What breaks the pairing is an
    // explicit grant -- including a `read_only` one, which is expressible on the viewing
    // capability and rejected at creation on the recording one. This comment made the
    // roles-to-accounts step flatly in the same batch that corrected it three lines
    // away in decision 0204.* That is a disclosure appearing with no
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
