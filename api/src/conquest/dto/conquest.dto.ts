import { IsIn, IsOptional, IsUUID } from 'class-validator';

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

/**
 * `GET /api/v1/conquest/branches`, the Senior Pastors' tables (decision 0494): one Network's
 * roots and their 12, or one leader's 12.
 */
export class ConquestBranchesDto {
  /** Which Network's roots; both where absent. Refused beside a leader, whose 12 have no Network. */
  @IsOptional()
  @IsIn(['MENS', 'WOMENS'])
  network?: 'MENS' | 'WOMENS';

  /** One leader's 12, the level a name opens. */
  @IsOptional()
  @IsUUID()
  leader_id?: string;
}
