import { IsString, Matches, MaxLength, ValidateIf } from 'class-validator';

import { IsStorableText } from '../../../common/text/is-storable-text';

/**
 * The verse an administrator sets for Record (decision 0425): its words and its reference,
 * both given, or both null to show no verse. One without the other is refused by the
 * service, which names the field.
 */
export class RecordVerseDto {
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @Matches(/\S/, { message: 'text must not be blank' })
  @MaxLength(600)
  @IsStorableText()
  text!: string | null;

  @ValidateIf((_, value) => value !== null)
  @IsString()
  @Matches(/\S/, { message: 'reference must not be blank' })
  @MaxLength(60)
  @IsStorableText()
  reference!: string | null;
}
