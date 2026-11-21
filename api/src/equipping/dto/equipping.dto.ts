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

/** The levels open for registration (SKILL.md section 29, decision 0499): Life Class first. */
export const EQUIPPING_LEVELS: readonly EquippingLevel[] = ['LIFE_CLASS'];

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
 * Registering a person (decision 0499, points 5 to 7). The two ticks must be ticked;
 * `exception_reason` is required where a record requirement is not met, and the service
 * decides that, since only it reads the records.
 */
export class RegisterDto extends EquippingTermDto {
  @IsUUID()
  person_id!: string;

  @IsBoolean()
  bible_confirmed!: boolean;

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

  @IsUUID()
  encounter_season_id!: string;
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
  @Max(9)
  lesson!: number;

  @IsManilaCalendarDate({ message: 'made_up_on must be a real calendar date, YYYY-MM-DD' })
  made_up_on!: string;
}
