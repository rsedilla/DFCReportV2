import { VersionConflictError } from '../../src/common/errors/version-conflict';

/**
 * SKILL.md section 22, Write conflicts: a `VERSION_CONFLICT` body carries both
 * values, both actors and both timestamps, because "a conflict response that
 * omits any of them cannot satisfy Section 14 — the person resolving it cannot
 * tell which record to keep".
 *
 * Section 14 is the rule these hold: a conflict is resolved by a person, never by
 * the system, and the client renders its resolution dialog directly from this
 * body.
 */
describe('VERSION_CONFLICT (SKILL.md sections 14 and 22)', () => {
  const conflict = new VersionConflictError({
    submittedVersion: 3,
    currentVersion: 4,
    submitted: {
      values: { present: 9 },
      recordedAt: '2026-10-17T18:02:11+08:00',
      actor: { id: 'a1', name: 'Manuel' },
    },
    current: {
      values: { present: 8 },
      recordedAt: '2026-10-17T18:15:40+08:00',
      actor: { id: 'a2', name: 'Raymond' },
    },
  });

  it('answers 409 with the stable code clients branch on', () => {
    expect(conflict.status).toBe(409);
    expect(conflict.code).toBe('VERSION_CONFLICT');
  });

  it('carries both values, both actors and both timestamps', () => {
    // The example section 22 gives, reproduced exactly. A leader recorded nine on
    // a phone and lost signal; an upline leader recorded eight on behalf from a
    // laptop meanwhile. Last write wins would discard one without trace.
    expect(conflict.toBody()).toEqual({
      error: {
        code: 'VERSION_CONFLICT',
        message: 'This record changed after you opened it.',
        details: {
          submitted_version: 3,
          current_version: 4,
          submitted: {
            present: 9,
            recorded_at: '2026-10-17T18:02:11+08:00',
            actor: { id: 'a1', name: 'Manuel' },
          },
          current: {
            present: 8,
            recorded_at: '2026-10-17T18:15:40+08:00',
            actor: { id: 'a2', name: 'Raymond' },
          },
        },
      },
    });
  });

  it('cannot be constructed without either side', () => {
    // The shape is the enforcement: section 22 says an under-specified conflict
    // cannot satisfy section 14, so it is unconstructible rather than merely
    // discouraged. This case exists so that relaxing the constructor to make some
    // future call site easier fails here first.
    const underSpecified = {
      submittedVersion: 3,
      currentVersion: 4,
      submitted: {
        values: { present: 9 },
        recordedAt: '2026-10-17T18:02:11+08:00',
        actor: { id: 'a1', name: 'Manuel' },
      },
    };

    // @ts-expect-error `current` is required, and omitting it must not compile.
    const built = new VersionConflictError(underSpecified);

    // The compile-time guard is the real mechanism; this shows what it is
    // protecting against. At runtime the omission is silent -- the body renders
    // with `current: undefined`, which is precisely the response section 22 says
    // cannot satisfy section 14, sent with a 409 and looking well-formed.
    expect(built.toBody().error.details.current).toBeUndefined();
  });

  it('never lets a side omit its actor', () => {
    // Both actors are what let a person tell whose record is whose. A side
    // carrying values and a timestamp but no actor is the omission section 22
    // rules out by name.
    const sideWithoutActor = {
      values: { present: 9 },
      recordedAt: '2026-10-17T18:02:11+08:00',
    };

    const built = new VersionConflictError({
      submittedVersion: 3,
      currentVersion: 4,
      // @ts-expect-error a side without an actor must not compile.
      submitted: sideWithoutActor,
      current: {
        values: { present: 8 },
        recordedAt: '2026-10-17T18:15:40+08:00',
        actor: { id: 'a2', name: 'Raymond' },
      },
    });

    // Again: silent at runtime, and a person shown this dialog cannot tell whose
    // figure is whose. That is why the type refuses it.
    const submitted = built.toBody().error.details.submitted as Record<string, unknown>;
    expect(submitted.actor).toEqual({ id: undefined, name: undefined });
  });
});
