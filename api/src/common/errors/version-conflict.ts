import { ApiError, ApiErrorCode } from './api-error';

/**
 * `VERSION_CONFLICT` (SKILL.md section 14; section 22, Write conflicts).
 *
 * The same record is reachable from several surfaces at once (section 2), so a
 * concurrent write must conflict rather than overwrite. A conflict is resolved by
 * a person, never by the system: where two legitimately different facts are in
 * play, the system must not silently pick one.
 *
 * **The shape is the enforcement here.** Section 22 says a conflict response that
 * omits any of both values, both actors and both timestamps "cannot satisfy
 * Section 14, because the person resolving it cannot tell which record to keep".
 * Requiring them in the constructor is what makes an under-specified conflict
 * impossible to construct rather than merely discouraged — the same reasoning
 * section 2 gives for a guard that fails closed.
 *
 * The mechanism that raises this arrives with the first versioned record, which
 * is Cell attendance in Stage 4 (`docs/ROADMAP.md`). The envelope is built now
 * because section 23 puts version checks among the things required from the first
 * write endpoint rather than retrofitted, and because a client renders its
 * resolution dialog directly from this body — so the body has to be right before
 * a phone depends on it, not after.
 */

/** One side of the conflict: what was recorded, by whom, and when. */
export interface ConflictSide {
  /**
   * The record's own values as this side holds them — `{ present: 9 }` in section
   * 22's example. Rendered by the client beside the other side, so it carries
   * what a person needs to choose between them.
   */
  values: Record<string, unknown>;
  /** ISO 8601 with an offset (section 22, Dates and times). */
  recordedAt: string;
  actor: { id: string; name: string };
}

export class VersionConflictError extends ApiError {
  constructor(params: {
    submittedVersion: number;
    currentVersion: number;
    submitted: ConflictSide;
    current: ConflictSide;
    message?: string;
  }) {
    super(
      ApiErrorCode.VERSION_CONFLICT,
      params.message ?? 'This record changed after you opened it.',
      {
        submitted_version: params.submittedVersion,
        current_version: params.currentVersion,
        submitted: render(params.submitted, 'submitted'),
        current: render(params.current, 'current'),
      },
    );
  }
}

/**
 * Renders one side, refusing an incomplete one.
 *
 * The type already forbids this and that is the primary guard; this is the
 * backstop for a caller the compiler does not see -- JavaScript, a cast, a body
 * parsed from elsewhere. It is deliberate rather than incidental: without it the
 * omission still fails, but as a TypeError from a property access, which reads as
 * a bug in this file rather than as a caller that owes a complete conflict.
 */
function render(side: ConflictSide, which: 'submitted' | 'current'): Record<string, unknown> {
  if (!side || !side.actor || !side.recordedAt) {
    throw new Error(
      `A VERSION_CONFLICT needs a complete "${which}" side: values, recorded_at and actor. ` +
        'SKILL.md section 22 -- a conflict response omitting any of them cannot satisfy section 14, ' +
        'because the person resolving it cannot tell which record to keep.',
    );
  }

  return {
    ...side.values,
    recorded_at: side.recordedAt,
    actor: { id: side.actor.id, name: side.actor.name },
  };
}
