import { Injectable, type PipeTransform } from '@nestjs/common';

import { ValidationFailedError } from './errors/api-error';
import { isUuid } from './identifiers';

/**
 * Validates a path parameter the capability guard does not resolve against
 * (SKILL.md section 7).
 *
 * Section 7: "a route with a path parameter the guard does not resolve against must
 * validate it itself… reaching a `uuid` comparison with one produces a database
 * error rather than an answer." The guard validates the one target it resolves and
 * nothing else; `ValidationPipe` skips a `String` metatype; and
 * `CanonicalIdentifierPipe` canonicalizes without ever throwing. So a second
 * identifier in a route path is validated by nobody unless the route does it.
 *
 * **Nest's `ParseUUIDPipe` was tried first and withdrawn, for one reason and not
 * the two an earlier version of this paragraph gave.** The reason that holds:
 * section 22 fixes one error envelope with stable machine-readable codes, and that
 * pipe raises `BadRequestException` — a 400 carrying a body no client of this API is
 * written against.
 *
 * *The reason that does not hold, recorded because it was asserted here and in
 * CLAUDE.md and was checked by neither: it said `ParseUUIDPipe` "carries `validator`'s
 * own predicate", which pins the version and variant nibbles, and would therefore
 * refuse `01234567-89ab-cdef-0123-456789abcdef`. Executed against the installed
 * package, it does not. With no `version` option it uses a table of its own whose
 * `all` entry is the same loose pattern as `isUuid`, and it accepts that value. The
 * 422 the entry claimed had happened never happened.*
 *
 * `isUuid` is still what this uses, because `identifiers.ts` exists to be the single
 * copy of that question and a pipe with a table of its own is a second one whether or
 * not the two currently agree.
 *
 * **What the check did surface is a real split, and it is escalated rather than
 * settled here.** The predicate that *does* pin the nibbles is `class-validator`'s
 * `@IsUUID()`, which every DTO in this API uses — including `AddCellMemberDto` on the
 * body of the route beside this one. So an identifier in a **body** is validated
 * strictly and one in a **path** loosely, and `POST /cells/{id}/members` would refuse
 * as `person_id` a value `DELETE /cells/{id}/members/{person_id}` accepts. Nothing in
 * the database distinguishes them and every identifier in it is a v4, so this is a
 * consistency question rather than a defect.
 */
@Injectable()
export class UuidParamPipe implements PipeTransform<unknown, string> {
  constructor(private readonly field: string) {}

  transform(value: unknown): string {
    if (typeof value !== 'string' || !isUuid(value)) {
      throw new ValidationFailedError(`${this.field} must be a UUID.`, { field: this.field });
    }

    return value;
  }
}
