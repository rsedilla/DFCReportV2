import { IsInt, Max, Min } from 'class-validator';

/**
 * The attention threshold an administrator sets (SKILL.md section 15, decision 0425): how
 * many whole months without a meeting put a Cell on *Inactive N+ Months*. Two to six, three
 * the usual: one would flag a Cell that skipped a holiday month, and past six a quiet Cell
 * is told to nobody for half a year.
 */
export class CellAttentionMonthsDto {
  @IsInt({ message: 'months must be a whole number' })
  @Min(2, { message: 'months must be at least 2' })
  @Max(6, { message: 'months must be at most 6' })
  months!: number;
}
