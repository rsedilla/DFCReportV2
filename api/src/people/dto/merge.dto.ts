import { IsString, IsUUID, Length } from 'class-validator';

import { IsStorableText } from '../../common/text/is-storable-text';

/** `POST /api/v1/people/{id}/merge`: join `duplicate_id` into the record `{id}` (decision 0407). */
export class MergePersonDto {
  /** The record joined in and retired. */
  @IsUUID()
  duplicate_id!: string;

  /** Why the two are the same person, required (SKILL.md section 3). */
  @IsString()
  @Length(1, 500)
  @IsStorableText()
  reason!: string;
}

/** `GET /api/v1/people/{id}/merge-preview?duplicate_id=`: what a merge would be refused for. */
export class MergePreviewDto {
  @IsUUID()
  duplicate_id!: string;
}
