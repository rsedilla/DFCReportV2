import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { CURSOR_MAX_LENGTH } from '../../common/cursor';

/**
 * `GET /api/v1/dcc/events/{id}/roster` (SKILL.md section 22, *Pagination*).
 *
 * **Bound because section 22 makes pagination cursor-based on every collection
 * endpoint**, and because Section 9 puts no bound on a checklist: it is a leader's
 * direct pastoral children *plus* the children of every account-less leader below
 * them, and Section 9 says that covering arrangement can persist. A first version of
 * this route returned the whole list under `next_cursor: null` (decision 0174).
 */
export class DccRosterDto {
  /** Section 22: defaults to 50, maximum 200. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  /**
   * The `next_cursor` of the previous page, passed back unmodified (section 22).
   *
   * Bounded rather than merely typed: an unbounded string here is a request-size hole
   * on a route that decodes it. `CURSOR_MAX_LENGTH` is the shared guard, and an empty
   * value is refused rather than treated as absent — an absent cursor is absent, and
   * this is about one that was sent.
   */
  @IsOptional()
  @IsString()
  @Length(1, CURSOR_MAX_LENGTH)
  cursor?: string;
}

/**
 * One person's line on a DCC checklist (SKILL.md sections 9 and 14).
 *
 * `version` is what section 14 requires a client to send back: "A client submits
 * the version it read. If the stored version has since moved, the server rejects
 * the write with a conflict and does not apply it." For DCC the unit is the
 * person, because a DCC event is church-wide and two leaders recording different
 * people must never conflict.
 */
export class DccAttendanceRecordDto {
  @IsUUID()
  person_id!: string;

  @IsBoolean()
  present!: boolean;

  /**
   * The version the client read, or null where it read no record.
   *
   * Null asserts "there was nothing recorded when I looked", which is a claim the
   * server checks: a first record created by somebody else in the meantime conflicts
   * on it (section 22, *Write conflicts*, the second of the two cases carrying a null
   * `submitted_version`).
   *
   * **An omitted field means the same thing, and that is deliberate here.** An earlier
   * version of this paragraph claimed the opposite — that `@IsOptional()` would
   * conflate the two and was therefore avoided — while `@IsOptional()` sat on the line
   * below it. The claim was wrong twice over: it described the decorator that is
   * applied, and the conflation it warned against is correct for this field. Omission
   * and null both say the client read no record, so they are one claim; the defect
   * this repository shipped from `@IsOptional()` was on `birth_date`, where omission
   * meant "take the default" and null meant "no birthday", which are two.
   *
   * An omitted version against a record that exists **and disagrees** is a stale claim
   * and conflicts. Where it agrees, the line is unchanged and takes no part in the
   * version check at all (section 9), so it succeeds and writes nothing — which is the
   * intended outcome rather than a hole, and is why this paragraph no longer says the
   * field "fails safe" flatly. It said so for one commit, added beside the rule that
   * had just made it false.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  version!: number | null;

  /**
   * Why a recorded value is being changed (section 14).
   *
   * Optional, matching `dcc_attendance.correction_reason`, which section 9 declares
   * nullable. Section 14 asks for a reason "as appropriate" rather than always, and
   * a submission is a whole checklist — requiring one per changed line would put a
   * dialog in front of a leader who noticed one mistake in twenty names. It is
   * meaningless on a line that creates a record and is refused there, so it cannot
   * be read as a reason for the original.
   */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  correction_reason?: string;
}

/**
 * A DCC submission (SKILL.md section 9; section 22).
 *
 * **All or nothing** (section 14): a submission carrying several people can
 * conflict on several at once, and it applies none of them and names the first.
 * "A partial result is a third outcome, and a leader reading the response could
 * not tell what had been recorded without fetching the roster again."
 */
export class SubmitDccAttendanceDto {
  /**
   * At most 500, which is the bound `POST /cells/{id}/closure` already takes for a
   * decision list. A checklist is one leader's direct pastoral children plus those
   * of the account-less leaders below them (section 9), so a request approaching
   * this is a leader covering a branch nobody could work through in one sitting —
   * the bound is a request-size guard rather than a claim about the domain.
   */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => DccAttendanceRecordDto)
  records!: DccAttendanceRecordDto[];
}
