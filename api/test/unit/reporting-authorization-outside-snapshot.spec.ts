import { CAPABILITY_METADATA } from '../../src/auth/authorization/authorization.decorators';
import { AuthorizationService } from '../../src/auth/authorization/authorization.service';
import { Capability } from '../../src/auth/authorization/capabilities';
import { ReportingController } from '../../src/reporting/reporting.controller';
import { ReportingService } from '../../src/reporting/reporting.service';

import type { CapabilityRequirement } from '../../src/auth/authorization/authorization.decorators';

/**
 * A report's authorization is decided **before** its transaction opens (SKILL.md section
 * 24, decision 0214).
 *
 * **Section 24 owes this test and said so.** Its isolation exception rests on three
 * clauses, and the third — that a reporting transaction "decides no authorization" — was
 * an observation about there being no reporting route. Decision 0214 turned it into a
 * rule, and a rule with nothing that can fail is a wish, which is the standard section 24
 * holds its neighbour to.
 *
 * **This is a structural test and says so rather than implying more.** It does not observe
 * an ordering at runtime; it pins the three shapes that would each have to change before
 * authorization could be decided inside the report's snapshot. Moving it there requires
 * handing the decision a transaction, and there is nowhere to put one:
 *
 * 1. the guard's entry point takes no executor, so it can only read on the pool;
 * 2. the report's service method takes no executor, so a caller cannot thread one in;
 * 3. the route declares a capability, so the guard resolves it before the handler runs —
 *    and the transaction is opened *inside* the handler.
 *
 * A spy on the service would be a stronger test and is deliberately not written:
 * `createTestApp` replaces exactly one provider and says in terms that everything else is
 * the deployed wiring, so a second override would buy this one test a weaker guarantee
 * than every other suite runs against.
 */
describe('a report authorizes outside its own transaction (section 24)', () => {
  it('gives the guard no way to read inside a transaction', () => {
    // `covers` is what `CapabilityGuard` calls. Its sibling `coversWith` takes an executor
    // precisely so a caller already inside a transaction can decide there — and `covers`
    // deliberately does not, which its own docblock gives as the reason a signature
    // accepting one "would invite exactly the call this method exists to make possible".
    const covers = Object.getOwnPropertyDescriptor(AuthorizationService.prototype, 'covers');

    expect(covers?.value).toBeDefined();
    expect((covers?.value as (...args: unknown[]) => unknown).length).toBe(3);
  });

  it('gives the report nothing to authorize with', () => {
    // **The load-bearing one.** Deciding scope inside the report's transaction means
    // asking the authorization service inside it, which means `reporting` depending on
    // it -- so this reddens on the injection rather than on a signature.
    //
    // An arity check on `dccMonthly` was written first and is not kept: an *optional*
    // trailing executor leaves `Function.length` at 2, so the mutation that matters would
    // have slipped past it. A dependency cannot be added optionally in the same way.
    const injected = (Reflect.getMetadata('design:paramtypes', ReportingService) ??
      []) as unknown[];

    expect(injected).not.toContain(AuthorizationService);
    // And the run reached something: a constructor whose metadata did not emit would
    // otherwise pass this vacuously.
    expect(injected.length).toBeGreaterThan(0);
  });

  it('declares a capability, so the guard runs before the handler opens anything', () => {
    const handler = Object.getOwnPropertyDescriptor(ReportingController.prototype, 'dccMonthly')
      ?.value as object;
    const requirement = Reflect.getMetadata(CAPABILITY_METADATA, handler) as
      CapabilityRequirement | undefined;

    expect(requirement).toBeDefined();
    expect(requirement?.capability).toBe(Capability.ReportsViewSubtree);
    // The target carries the instant rather than resolving one: section 7 makes the scope
    // selector the target, and decision 0214 fixes that the guard uses the same instant
    // the figures use.
    expect(requirement?.target.kind).toBe('report_scope');
  });
});
