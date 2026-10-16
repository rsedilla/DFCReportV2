import { Capability } from '../auth/authorization/capabilities';
import {
  CapabilityDeniedError,
  InvariantViolationError,
  ScopeDeniedError,
} from '../common/errors/api-error';

import type { CellsReadService } from './cells.read.service';
import type {
  Actor,
  ActorAuthority,
  AuthorizationService,
} from '../auth/authorization/authorization.service';
import type { Db } from '../database/database.module';

/**
 * Whether the actor may move a member out of each of these Cells, or into it (SKILL.md
 * section 10, *Managing Cell membership*; decision 0357): `cell.move_members` over every
 * one, each resolved through its leader as section 7 resolves a Cell.
 *
 * `'capability'` where the actor holds it nowhere, `'scope'` where some Cell is outside
 * what it reaches. Read through the caller's executor, so inside a transaction it answers
 * from the state the caller's locks hold.
 */
export async function moveMembersAnswer(
  executor: Db,
  authorization: AuthorizationService,
  cells: CellsReadService,
  actor: Actor,
  authority: ActorAuthority,
  cellIds: readonly string[],
): Promise<'ok' | 'capability' | 'scope'> {
  if (!authority.grants.some((grant) => grant.capability === Capability.CellMoveMembers)) {
    return 'capability';
  }

  for (const cellId of cellIds) {
    const leaderId = await cells.leaderForScopeWithin(executor, cellId);

    if (leaderId === null) {
      // Unreachable while a Cell holding a membership has a leadership row (migration 0009).
      throw new InvariantViolationError(
        'That change cannot be resolved to a Cell leader, so there is no authority to ' +
          'check against (SKILL.md section 11).',
      );
    }

    if (
      !(await authorization.coversWith(executor, actor, authority, Capability.CellMoveMembers, {
        kind: 'person',
        personId: leaderId,
      }))
    ) {
      return 'scope';
    }
  }

  return 'ok';
}

/**
 * Throws unless `moveMembersAnswer` is `'ok'`. **It names no Cell and says nothing of the
 * member's**, because section 8 forbids exposing Cell membership outside the actor's scope
 * and the source Cell is exactly what may lie outside it.
 */
export async function assertMayMoveMembersWithin(
  executor: Db,
  authorization: AuthorizationService,
  cells: CellsReadService,
  actor: Actor,
  authority: ActorAuthority,
  cellIds: readonly string[],
): Promise<void> {
  const answer = await moveMembersAnswer(executor, authorization, cells, actor, authority, cellIds);

  if (answer === 'capability') {
    throw new CapabilityDeniedError(
      'Moving somebody out of a Cell is done by the Primary of the branch or the Admin ' +
        '(SKILL.md section 10, decision 0357).',
      { capability: Capability.CellMoveMembers },
    );
  }

  if (answer === 'scope') {
    throw new ScopeDeniedError(
      'You move members only between Cells of your own branch. Other moves are made by the ' +
        'Admin (SKILL.md section 10, decision 0357).',
      { capability: Capability.CellMoveMembers },
    );
  }
}
