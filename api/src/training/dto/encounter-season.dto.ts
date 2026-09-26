import { IsOptional } from 'class-validator';

import { IsManilaCalendarDate } from '../../common/time/is-manila-calendar-date';

/**
 * One Encounter season as an administrator records it (SKILL.md section 28, decision 0296):
 * the Men's and Women's weekends, each the day it starts, and the LC Party before each.
 *
 * **An LC Party left out is five weeks before its own weekend**, the earliest the rule
 * allows being that date itself. A party given must be at least five weeks before; the
 * service names the field it breaks, and a database constraint holds the same rule.
 */
export class EncounterSeasonDto {
  @IsManilaCalendarDate({ message: 'mens_encounter_on must be a real calendar date, YYYY-MM-DD' })
  mens_encounter_on!: string;

  @IsManilaCalendarDate({ message: 'womens_encounter_on must be a real calendar date, YYYY-MM-DD' })
  womens_encounter_on!: string;

  @IsOptional()
  @IsManilaCalendarDate({ message: 'mens_lc_party_on must be a real calendar date, YYYY-MM-DD' })
  mens_lc_party_on?: string;

  @IsOptional()
  @IsManilaCalendarDate({ message: 'womens_lc_party_on must be a real calendar date, YYYY-MM-DD' })
  womens_lc_party_on?: string;
}
