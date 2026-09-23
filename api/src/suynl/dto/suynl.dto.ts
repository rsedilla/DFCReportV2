import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { GrowthListDto } from '../../common/growth/growth-list.dto';
import { IsStorableText } from '../../common/text/is-storable-text';

/** The three SUYNL count cards, which add up to everyone listed (decision 0281). */
export const SUYNL_STEPS = ['NOT_STARTED', 'IN_PROGRESS', 'GRADUATED'] as const;
export type SuynlStep = (typeof SUYNL_STEPS)[number];

/** `GET /api/v1/suynl/people` (SKILL.md section 28). */
export class SuynlListDto extends GrowthListDto {
  /** A count card, narrowing the list to the people behind it (decision 0281). */
  @IsOptional()
  @IsIn(SUYNL_STEPS)
  step?: SuynlStep;
}

/**
 * One tick or untick in a SUYNL save (SKILL.md section 28; decision 0282).
 *
 * `seen_id` is the lesson row the change was made against, and null where the client
 * saw none. A row is never changed once it stands, so its identifier is what the
 * client saw; where it is no longer current, nothing is saved and the line is named.
 */
export class SuynlChangeDto {
  @IsUUID()
  person_id!: string;

  @IsInt()
  @Min(1)
  @Max(10)
  lesson!: number;

  /** True records the lesson as done; false withdraws it, with a reason. */
  @IsBoolean()
  done!: boolean;

  @IsOptional()
  @IsUUID()
  seen_id?: string | null;

  /** Required to withdraw a lesson, and refused on a tick (section 28, *Correcting*). */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Matches(/\S/, { message: 'reason must not be blank.' })
  @IsStorableText()
  reason?: string;
}

/** `POST /api/v1/suynl/submit`: a tab's draft, saved whole or not at all (section 14). */
export class SubmitSuynlDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsObject({ each: true })
  @ValidateNested({ each: true })
  @Type(() => SuynlChangeDto)
  changes!: SuynlChangeDto[];
}
