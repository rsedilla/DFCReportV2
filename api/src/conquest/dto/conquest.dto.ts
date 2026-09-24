import { IsIn, IsOptional } from 'class-validator';

import { GrowthListDto } from '../../common/growth/growth-list.dto';

/** The four goals in ladder order (SKILL.md section 27). */
export const CONQUEST_GOALS = [
  'WIN_3',
  'OPEN_A_CELL',
  'COMPLETION_OF_12',
  'RAISE_12_LEADERS',
] as const;
export type ConquestGoalName = (typeof CONQUEST_GOALS)[number];

/** `GET /api/v1/conquest/people` (SKILL.md section 27). */
export class ConquestListDto extends GrowthListDto {
  /** A count card, narrowing the list to the people who reached that goal. */
  @IsOptional()
  @IsIn(CONQUEST_GOALS)
  goal?: ConquestGoalName;
}
