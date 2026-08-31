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
 * The envelope was built before anything raised it, because section 23 puts
 * version checks among the things required from the first write endpoint rather
 * than retrofitted, and because a client renders its resolution dialog directly
 * from this body — so the body had to be right before a phone depended on it. The
 * first record to raise it is a DCC attendance row (section 9), not the Cell
 * attendance an earlier version of this paragraph predicted; Cell meetings follow
 * in the same stage.
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
    /**
     * The version the client read, or null where it read no record.
     *
     * **Null is a real case and there are exactly two** (section 22, *Write
     * conflicts*): a Cell meeting, which has no row until it is reported, and a
     * person's first DCC record for an event. In both, two writers create a record
     * that does not exist yet and neither holds a version to be stale, so the loser
     * meets a unique index instead. The response still carries both sides — what
     * this client tried to record, against what is now stored — because that is
     * what section 14 requires a person to choose between.
     */
    submittedVersion: number | null;
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

/** The envelope's own field names, which a record's values may not shadow. */
const RESERVED = ['recorded_at', 'actor'];

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
  // `Object.keys(...).length` and not merely a truthiness test: `{}` is truthy,
  // and a side carrying no values renders as a timestamp and an actor with no
  // figures to choose between -- which is the whole of what section 22 says makes
  // a conflict response useless to the person resolving it.
  if (!side || !side.actor || !side.recordedAt || Object.keys(side.values ?? {}).length === 0) {
    throw new Error(
      `A VERSION_CONFLICT needs a complete "${which}" side: values, recorded_at and actor. ` +
        'SKILL.md section 22 -- a conflict response omitting any of them cannot satisfy section 14, ' +
        'because the person resolving it cannot tell which record to keep.',
    );
  }

  // A record field named `recorded_at` or `actor` would be silently overwritten
  // by the envelope's, and the person resolving the conflict would be shown the
  // envelope's value as though it were the record's. Refused rather than
  // clobbered: the two would be indistinguishable in the response.
  const collision = RESERVED.find((name) => name in side.values);
  if (collision) {
    throw new Error(
      `A VERSION_CONFLICT side may not carry a value named "${collision}": the envelope uses ` +
        'that name, and one would silently replace the other in the response.',
    );
  }

  return {
    ...side.values,
    recorded_at: side.recordedAt,
    actor: { id: side.actor.id, name: side.actor.name },
  };
}
