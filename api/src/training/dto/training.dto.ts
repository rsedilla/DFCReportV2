import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

import { GrowthListDto } from '../../common/growth/growth-list.dto';
import { IsStorableText } from '../../common/text/is-storable-text';
import { IsManilaCalendarDate } from '../../common/time/is-manila-calendar-date';

import type { TrainingProgram } from '../../database/schema';

/** The five graduations, the Encounter first (SKILL.md section 28). */
export const TRAINING_PROGRAMS: readonly TrainingProgram[] = [
  'ENCOUNTER',
  'LIFE_CLASS',
  'SOL_1',
  'SOL_2',
  'SOL_3',
];

/**
 * A card per school and one for people who have none yet (decision 0281), and the list's
 * opening view, everyone short of all five (decision 0287).
 */
export const TRAINING_STEPS = ['NOT_STARTED', ...TRAINING_PROGRAMS, 'STILL_TO_FINISH'] as const;
export type TrainingStep = 'NOT_STARTED' | TrainingProgram | 'STILL_TO_FINISH';

/** `GET /api/v1/training/people` (SKILL.md section 28). */
export class TrainingListDto extends GrowthListDto {
  /** A count card, narrowing the list to the people behind it (decision 0281). */
  @IsOptional()
  @IsIn(TRAINING_STEPS)
  step?: TrainingStep;
}

/**
 * One change in a Training save (SKILL.md section 28; decision 0282).
 *
 * `seen_id` is the graduation row the change was made against, null where the client
 * saw none, as on a SUYNL change.
 */
export class TrainingChangeDto {
  @IsUUID()
  person_id!: string;

  @IsIn(TRAINING_PROGRAMS)
  program!: TrainingProgram;

  /** True records the graduation, or changes its date; false withdraws it. */
  @IsBoolean()
  graduated!: boolean;

  /** The day the leader states, or absent where they do not know it (section 28). */
  @IsOptional()
  @IsManilaCalendarDate({
    message: 'graduated_on must be a YYYY-MM-DD date that exists (SKILL.md section 22).',
  })
  graduated_on?: string | null;

  @IsOptional()
  @IsUUID()
  seen_id?: string | null;

  /** Required to withdraw a graduation or change its date (section 28, *Correcting*). */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Matches(/\S/, { message: 'reason must not be blank.' })
  @IsStorableText()
  reason?: string;
}

/** `POST /api/v1/training/submit`: a tab's draft, saved whole or not at all (section 14). */
export class SubmitTrainingDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsObject({ each: true })
  @ValidateNested({ each: true })
  @Type(() => TrainingChangeDto)
  changes!: TrainingChangeDto[];
}
