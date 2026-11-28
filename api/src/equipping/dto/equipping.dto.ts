import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import { CURSOR_MAX_LENGTH } from '../../common/cursor';
import { IsStorableText } from '../../common/text/is-storable-text';
import { IsManilaCalendarDate } from '../../common/time/is-manila-calendar-date';

import type { EquippingLevel } from '../../database/schema';

/** The levels the school runs (SKILL.md section 29, decisions 0499 and 0514). */
export const EQUIPPING_LEVELS: readonly EquippingLevel[] = [
  'LIFE_CLASS',
  'SOL_1',
  'SOL_2',
  'SOL_3',
];

/** A level alone, for a read that names one: the registration form, the Guide search. */
export class EquippingLevelDto {
  @IsOptional()
  @IsIn(EQUIPPING_LEVELS)
  level?: EquippingLevel;
}

/** At most fifty people enrolled in one request, a class's size and more. */
export const ENROLL_AT_ONCE = 50;

/** A level in a term, which every list and every class names (decision 0499, point 5). */
export class EquippingTermDto {
  @IsIn(EQUIPPING_LEVELS)
  level!: EquippingLevel;

  @Type(() => Number)
  @IsInt()
  @Min(2020)
  @Max(2100)
  term_year!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3)
  term_number!: number;
}

/** A term alone, for the counts the Level picker shows (decision 0514). */
export class EquippingTermOnlyDto {
  @Type(() => Number)
  @IsInt()
  @Min(2020)
  @Max(2100)
  term_year!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3)
  term_number!: number;
}

/** A term's registrations, a page at a time (section 22). */
export class ListRegistrationsDto extends EquippingTermDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @IsOptional()
  @IsString()
  @Length(1, CURSOR_MAX_LENGTH)
  cursor?: string;
}

/**
 * Registering a person (decision 0499, points 5 to 7). Life Class's two ticks must be ticked;
 * `exception_reason` is required where a record requirement is not met, and the service
 * decides that, since only it reads the records. **SOL 1 has no Bible tick, and its manual is a
 * requirement that warns** (decision 0514): left unticked, it is one the reason must cover.
 */
export class RegisterDto extends EquippingTermDto {
  @IsUUID()
  person_id!: string;

  /** Life Class only; a SOL 1 registration leaves it out. */
  @IsOptional()
  @IsBoolean()
  bible_confirmed?: boolean;

  @IsBoolean()
  manual_confirmed!: boolean;

  @IsOptional()
  @IsString()
  @IsStorableText()
  @MaxLength(500)
  exception_reason?: string;

  @IsOptional()
  @IsString()
  @IsStorableText()
  @MaxLength(500)
  note?: string;
}

/** A reason, for cancelling a registration or withdrawing from a class (point 9). */
export class ReasonDto {
  @IsString()
  // Trimmed, then required to be non-empty: the column refuses a blank, and two spaces
  // would otherwise reach it and answer 500 (section 22).
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsStorableText()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}

/** Opening a class (decision 0499, point 10). */
export class OpenClassDto extends EquippingTermDto {
  @IsString()
  // Trimmed, then required to be non-empty: the column refuses a blank, and two spaces
  // would otherwise reach it and answer 500 (section 22).
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsStorableText()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  /** ISO 8601: 1 is Monday, 7 is Sunday. */
  @IsInt()
  @Min(1)
  @Max(7)
  day_of_week!: number;

  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'time_of_day must be HH:MM, 24-hour' })
  time_of_day!: string;

  @IsOptional()
  @IsString()
  @IsStorableText()
  @MaxLength(80)
  place?: string;

  @IsManilaCalendarDate({ message: 'first_lesson_on must be a real calendar date, YYYY-MM-DD' })
  first_lesson_on!: string;

  /** Optional: a class may be opened before its Teacher is named (decision 0501). */
  @IsOptional()
  @IsUUID()
  teacher_person_id?: string;

  /** Life Class names its Encounter weekend; a SOL 1 class has none (decision 0514). */
  @IsOptional()
  @IsUUID()
  encounter_season_id?: string;
}

/**
 * Correcting a class's day, time, place and first lesson (decision 0510, point 1). Every field is
 * sent; a place left out or blank clears it.
 */
export class CorrectClassDto {
  /** ISO 8601: 1 is Monday, 7 is Sunday. */
  @IsInt()
  @Min(1)
  @Max(7)
  day_of_week!: number;

  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'time_of_day must be HH:MM, 24-hour' })
  time_of_day!: string;

  @IsOptional()
  @IsString()
  @IsStorableText()
  @MaxLength(80)
  place?: string | null;

  @IsManilaCalendarDate({ message: 'first_lesson_on must be a real calendar date, YYYY-MM-DD' })
  first_lesson_on!: string;
}

/** Naming or changing a class's Teacher (decision 0501, point 2). */
export class SetTeacherDto {
  @IsUUID()
  teacher_person_id!: string;
}

/** Naming a class's Guide (decision 0501, point 4). */
export class NameGuideDto {
  @IsUUID()
  person_id!: string;
}

/** *Swap Guide*: the class's Guide a student moves to (decision 0501, point 8). */
export class SwapGuideDto {
  @IsUUID()
  guide_id!: string;
}

/** Whose week a class is checked against (decision 0501, point 2). */
export class TeacherClashDto {
  @IsUUID()
  person_id!: string;
}

/** Enrolling several registered people in one class at once (point 11). */
export class EnrollDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(ENROLL_AT_ONCE)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  registration_ids!: string[];

  /**
   * Of those, the ones started from Lesson 1 although they could join at Lesson 6 (decision
   * 0512, point 3). Anybody else who can join at Lesson 6 does.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(ENROLL_AT_ONCE)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  start_from_lesson_1?: string[];
}

/** Moving an enrollment to another class of its level and term (point 11). */
export class MoveEnrollmentDto {
  @IsUUID()
  class_id!: string;
}

/** The person picker's search, church-wide and so bounded as section 8 bounds one. */
export class EquippingSearchDto {
  @IsString()
  @IsStorableText()
  @MaxLength(100)
  q!: string;
}

/** The Guide search names the level guided, one level ahead of it (decision 0514). */
export class GuideSearchDto extends EquippingSearchDto {
  @IsOptional()
  @IsIn(EQUIPPING_LEVELS)
  level?: EquippingLevel;
}

/**
 * A lesson saved by its Teacher (decisions 0501 and 0503): the day the class met, and who came.
 * Anyone enrolled and not listed is saved Absent.
 */
export class SaveLessonDto {
  @IsManilaCalendarDate({ message: 'held_on must be a real calendar date, YYYY-MM-DD' })
  held_on!: string;

  @IsArray()
  // A class holds 30, more with a reason (decision 0501, point 6); 200 bounds the body.
  @ArrayMaxSize(200)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  came!: string[];

  /** SOL: who recited the memory verse, among those who came (decision 0514, point 8). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  verse?: string[];

  /** SOL: who handed in the devotional, among those who came (decision 0514, point 8). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  devotional?: string[];

  /** The lesson's version when the page read it; required once the lesson has been saved. */
  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;

  /** Required of the Admin correcting a lesson whose week has closed, and refused otherwise. */
  @IsOptional()
  @IsString()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsStorableText()
  @MinLength(1)
  @MaxLength(500)
  correction_reason?: string;
}

/** A make-up of a missed lesson, recorded as M with its date (decision 0501, point 12). */
export class RecordMakeUpDto {
  @IsUUID()
  enrollment_id!: string;

  @IsInt()
  @Min(1)
  @Max(10)
  lesson!: number;

  @IsManilaCalendarDate({ message: 'made_up_on must be a real calendar date, YYYY-MM-DD' })
  made_up_on!: string;

  /** SOL: the memory verse recited at the make-up (decision 0514, point 9); refused for Life Class. */
  @IsOptional()
  @IsBoolean()
  verse?: boolean;

  /** SOL: the devotional handed in at the make-up (decision 0514, point 9); refused for Life Class. */
  @IsOptional()
  @IsBoolean()
  devotional?: boolean;
}

/** A SOL verse or devotional brought after its lesson (decision 0514, point 10). */
export class RecordItemsBroughtDto {
  @IsUUID()
  enrollment_id!: string;

  @IsInt()
  @Min(1)
  @Max(10)
  lesson!: number;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2)
  @ArrayUnique()
  @IsIn(['VERSE', 'DEVOTIONAL'], { each: true })
  items!: ('VERSE' | 'DEVOTIONAL')[];

  @IsManilaCalendarDate({ message: 'brought_on must be a real calendar date, YYYY-MM-DD' })
  brought_on!: string;
}

/** A late verse or devotional ticked by mistake, unticked (owner, 2026-11-26). */
export class UntickItemBroughtDto {
  @IsUUID()
  enrollment_id!: string;

  @IsInt()
  @Min(1)
  @Max(10)
  lesson!: number;

  @IsIn(['VERSE', 'DEVOTIONAL'])
  item!: 'VERSE' | 'DEVOTIONAL';
}

/** A SOL class's quiz: its number of items (decision 0501, point 18). */
export class SetQuizDto {
  @IsInt()
  @Min(1)
  @Max(500)
  items!: number;
}

/** One try's score (decision 0501, point 18; owner, 2026-11-26). */
export class RecordQuizTryDto {
  @IsUUID()
  enrollment_id!: string;

  @IsInt()
  @Min(1)
  @Max(3)
  try!: number;

  @IsInt()
  @Min(0)
  @Max(500)
  score!: number;
}

/** Whether a SOL student read the book (decision 0501, point 18; owner, 2026-11-26). */
export class RecordBookDto {
  @IsUUID()
  enrollment_id!: string;

  @IsBoolean()
  read!: boolean;
}

/** What a change after posting sets a lesson to (decision 0513). */
export const GRADE_CHANGE_TO = ['CAME', 'ABSENT', 'MADE_UP'] as const;
/** Why a lesson is changed after posting, chosen from two (decision 0513). */
export const GRADE_CHANGE_WHY = ['MADE_UP_AFTER_POSTING', 'RECORDED_WRONGLY'] as const;

/** What a SOL change reaches (decision 0514, point 12). */
export const GRADE_CHANGE_ITEMS = ['ATTENDANCE', 'VERSE', 'DEVOTIONAL', 'QUIZ', 'BOOK'] as const;

/** `GET /equipping/final-grades/grades/{id}/change-preview` (decision 0513). */
export class GradeChangePreviewDto {
  /** A lesson, for attendance, a verse or a devotional; Life Class's are 1 to 9, SOL's 1 to 10. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  lesson?: number;

  /** Attendance: what the lesson becomes. */
  @IsOptional()
  @IsIn(GRADE_CHANGE_TO)
  to?: (typeof GRADE_CHANGE_TO)[number];

  @IsOptional()
  @IsManilaCalendarDate({ message: 'made_up_on must be a real calendar date, YYYY-MM-DD' })
  made_up_on?: string;

  /**
   * What a SOL change reaches (decision 0514, point 12): a lesson's attendance, as a Life Class
   * change always does, a lesson's memory verse or devotional, a quiz try's score or *Book read*.
   */
  @IsOptional()
  @IsIn(GRADE_CHANGE_ITEMS)
  item?: (typeof GRADE_CHANGE_ITEMS)[number];

  /** A verse or devotional: handed in or not. */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  handed_in?: boolean;

  /** The day a verse or devotional was handed in, as it happened. */
  @IsOptional()
  @IsManilaCalendarDate({ message: 'brought_on must be a real calendar date, YYYY-MM-DD' })
  brought_on?: string;

  /** A quiz try and its score. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3)
  try?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(500)
  score?: number;

  /** *Book read*. */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  read?: boolean;
}

/** `POST /equipping/final-grades/grades/{id}/changes`: one lesson, with the reason (decision 0513). */
export class ChangeGradeDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  lesson?: number;

  @IsOptional()
  @IsIn(GRADE_CHANGE_TO)
  to?: (typeof GRADE_CHANGE_TO)[number];

  /**
   * What a SOL change reaches (decision 0514, point 12): a lesson's attendance, as a Life Class
   * change always does, a lesson's memory verse or devotional, a quiz try's score or *Book read*.
   */
  @IsOptional()
  @IsIn(GRADE_CHANGE_ITEMS)
  item?: (typeof GRADE_CHANGE_ITEMS)[number];

  /** A verse or devotional: handed in or not. */
  @IsOptional()
  @IsBoolean()
  handed_in?: boolean;

  /** The day a verse or devotional was handed in, as it happened. */
  @IsOptional()
  @IsManilaCalendarDate({ message: 'brought_on must be a real calendar date, YYYY-MM-DD' })
  brought_on?: string;

  /** A quiz try and its score. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3)
  try?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(500)
  score?: number;

  /** *Book read*. */
  @IsOptional()
  @IsBoolean()
  read?: boolean;

  @IsOptional()
  @IsManilaCalendarDate({ message: 'made_up_on must be a real calendar date, YYYY-MM-DD' })
  made_up_on?: string;

  @IsIn(GRADE_CHANGE_WHY)
  why!: (typeof GRADE_CHANGE_WHY)[number];

  @IsString()
  // Trimmed, then required to be non-empty: the column refuses a blank (section 22).
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsStorableText()
  @MinLength(1)
  @MaxLength(500)
  details!: string;

  /** How many changes the grade had when the dialog opened, so one made since is refused. */
  @IsInt()
  @Min(0)
  changes_seen!: number;
}

/** The two Encounter weekends of a season: the Men's for men, the Women's for women. */
export const ENCOUNTER_NETWORKS = ['MENS', 'WOMENS'] as const;

/** A weekend enrols every cleared student at once, so more than a class's fifty. */
export const ENCOUNTER_ENROLL_AT_ONCE = 300;

/** `GET /equipping/encounter`: one weekend's list (decision 0507). No season: the current one. */
export class EncounterQueryDto {
  @IsIn(ENCOUNTER_NETWORKS)
  network!: (typeof ENCOUNTER_NETWORKS)[number];

  @IsOptional()
  @IsUUID()
  season_id?: string;
}

/** Enrolling cleared students in one weekend (decision 0501, point 14). */
export class EnrollEncounterDto {
  @IsUUID()
  season_id!: string;

  @IsIn(ENCOUNTER_NETWORKS)
  network!: (typeof ENCOUNTER_NETWORKS)[number];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(ENCOUNTER_ENROLL_AT_ONCE)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  enrollment_ids!: string[];
}

/** Who came to one weekend: every enrolled student not named here is saved as not attended. */
export class EncounterAttendanceDto {
  @IsUUID()
  season_id!: string;

  @IsIn(ENCOUNTER_NETWORKS)
  network!: (typeof ENCOUNTER_NETWORKS)[number];

  @IsArray()
  @ArrayMaxSize(1000)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  came!: string[];
}

/** *Mark as checked*, naming the grades it read (decision 0508). */
export class CheckGradesDto {
  @IsString()
  @Matches(/^[0-9a-f]{64}$/)
  fingerprint!: string;
}
