import { Inject, Injectable } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import { AuthorizationService, type Actor } from '../auth/authorization/authorization.service';
import { Capability } from '../auth/authorization/capabilities';
import { ScopeType } from '../auth/authorization/scopes';
import { HierarchyService } from '../hierarchy/hierarchy.service';
import { NetworksService } from '../networks/networks.service';
import {
  InvariantViolationError,
  NotFoundError,
  ScopeDeniedError,
  ValidationFailedError,
} from '../common/errors/api-error';
import { IdempotencyService } from '../common/idempotency/idempotency.service';
import { sameId } from '../common/identifiers';
import { manilaDayOf, startOfManilaDay } from '../common/time/manila';
import { DATABASE, type Db } from '../database/database.module';
import { lockPersonsWithin } from '../database/person-lock';

import { assertLeaderIsAssignable } from './leader-assignability';
import { fullProfile } from './people.shared';

import type { CurrentClaim } from '../common/idempotency/current-idempotency.decorator';
import type { Sex } from '../database/schema';

/**
 * The audited correction of a person's recorded sex, and the Network change it
 * forces (SKILL.md section 4).
 *
 * Its own service because it is one section-numbered operation with the longest
 * precondition list in the system: Admin-only at Whole Church, section 5
 * invariant 4, the root refusal, the disciple refusal, the backdate floor, the
 * bound on the Network row, and the atomic pair sharing one instant. Reviewing it
 * beside anything else meant reviewing neither.
 */
@Injectable()
export class PeopleSexCorrectionService {
  constructor(
    @Inject(DATABASE) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly hierarchy: HierarchyService,
    private readonly networks: NetworksService,
    private readonly idempotency: IdempotencyService,
    private readonly authorization: AuthorizationService,
  ) {}

  /**
   * Corrects a person's recorded sex, and everything section 4 makes that mean.
   *
   * Sex determines Network, so this is never a field edit: it is a Network change,
   * carried out with the pastoral reassignment it forces, in one transaction, at
   * **one identical instant** written to all four rows. Section 4 is explicit that
   * the schema permits the operation at that instant and at no other — an edge
   * closed a microsecond later is open at the effective date, is compared with the
   * corrected Network on one end and the old one on the other, and is rejected. An
   * implementer meeting that as a constraint violation is tempted to move the
   * timestamps apart, which does not fix the write.
   *
   * The order below is not arbitrary. `changeWithin` carries section 4's two
   * preconditions — the refusal while the person leads anyone, and the backdate
   * floor — and it runs before the destination leader is validated so that those
   * refusals reach the administrator first. Reporting "that leader is in the wrong
   * Network" to somebody whose real problem is twelve disciples is unhelpful.
   *
   * The completion is last, because it takes the key's row lock and a concurrent
   * retry waits on that lock rather than being answered `REQUEST_IN_FLIGHT`
   * (section 22, and CLAUDE.md, Write endpoints).
   */
  async correctSex(
    personId: string,
    input: {
      sex: Sex;
      reason: string;
      pastoralLeaderId?: string;
      /** A `YYYY-MM-DD` Asia/Manila date. Its presence makes this a backdated correction. */
      effectiveDate?: string;
    },
    actor: Actor,
    claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    await this.assertCorrectSexIsHeldChurchWide(actor);

    // Section 5 invariant 4, which the Whole Church check above does **not** cover:
    // that one asks how far a grant reaches, this one asks who the actor is
    // relative to the target. Without it a non-Admin holding an explicit
    // Whole Church grant of `people.correct_sex` could correct their own record,
    // name any leader in the other Network, and detach themselves from their own
    // upline — the escalation section 7 gives as the reason this capability is
    // Admin-only, reached without ever holding `people.manage_pastoral_assignment`.
    //
    // Applied whether or not this particular correction forces a reassignment. The
    // capability moves a person between Networks either way, and a rule that
    // switched itself off depending on whether the target currently holds an edge
    // would be a rule nobody could reason about.
    const authority = await this.authorization.authorityFor(actor.accountId);

    const recordedAt = new Date();
    const backdated = input.effectiveDate !== undefined;
    let effectiveAt = recordedAt;

    if (input.effectiveDate !== undefined) {
      // A second capability, checked here rather than by the guard. Section 7's
      // guard evaluates one capability against one target; section 5 makes
      // backdating a separate grant, and both being Admin-only in the catalog is
      // not the same as one implying the other — an explicit grant of
      // `people.correct_sex` carries no power to date it in the past.
      await this.authorization.authorize(actor, Capability.RecordsBackdateEffectiveDate, {
        kind: 'person',
        personId,
      });

      effectiveAt = startOfManilaDay(input.effectiveDate);

      if (effectiveAt.getTime() > recordedAt.getTime()) {
        // Section 5 knows two cases: recording as of now, and Admin setting a date
        // **in the past**. A future date is neither, so nothing authorizes it, and
        // the fail-closed answer is to refuse rather than to invent forward-dating.
        throw new ValidationFailedError(
          'An effective date is a correction to the past. It cannot be in the future.',
          { field: 'effective_date', value: input.effectiveDate },
        );
      }
    }

    return this.db.transaction().execute(async (trx) => {
      // Both persons whose Networks decide the new edge's legality, in one call so
      // the ordering is decided by the helper rather than by the order that reads
      // best here. `changeWithin` and `reassignWithin` each take a subset again,
      // which is free: a session is always granted a lock it already holds.
      await lockPersonsWithin(
        trx,
        input.pastoralLeaderId === undefined ? [personId] : [personId, input.pastoralLeaderId],
      );

      // Section 5 invariant 4, inside the transaction, for the reason the
      // reassignment path gives: the walk is over the tree, and a decision taken
      // beforehand is taken against a tree a concurrent write may have changed.
      //
      // The lock does not close that window here and does not claim to. It covers
      // this person and the destination leader, while the walk is over the
      // **actor's** upline — so what would change the answer is a move of an
      // intermediate node, which nothing holds. Inside is narrower than outside;
      // it is not airtight.
      await this.hierarchy.assertMayReparent(
        trx,
        { personId: actor.personId, roles: authority.roles },
        personId,
      );

      // Read inside the transaction, as the basic edit does: outside it, a
      // concurrent write landing between the read and the update makes this
      // `before` a value that was never immediately prior — an audit entry
      // describing a change nobody made (section 21).
      const before = await trx
        .selectFrom('persons')
        .select([
          'id',
          'member_id',
          'first_name',
          'middle_name',
          'last_name',
          'birth_date',
          'sex',
          'civil_status',
          'mobile_number',
          'merged_into_id',
        ])
        .where('id', '=', personId)
        .executeTakeFirst();

      if (before === undefined) {
        throw new NotFoundError('No such person.');
      }

      if (before.merged_into_id !== null) {
        throw new InvariantViolationError(
          'That person was absorbed by a merge. Correct the surviving Person instead.',
          { person_id: personId, merged_into_id: before.merged_into_id },
        );
      }

      if (before.sex === input.sex) {
        // Section 4: the sex-to-Network mapping is total, so this is the only way
        // for a correction to change nothing. Refused rather than accepted
        // silently — the operation demands a reason and writes an audit trail, and
        // an audited correction that corrected nothing misleads whoever reads it.
        // A client that lost a real response retries with the same
        // `Idempotency-Key`, which is what that header is for.
        throw new ValidationFailedError('That person is already recorded as that sex.', {
          field: 'sex',
          value: input.sex,
        });
      }

      const toNetwork = this.networks.networkForSex(input.sex);
      const assignment = await this.hierarchy.openAssignmentOf(trx, personId);

      // An open row with a null `leader_id` is a Network root (section 5), which
      // has nothing above it to point elsewhere. What this asks is whether an
      // **edge** is open; whether the person is a *root* is a different question,
      // asked by `changeWithin`, and section 5 settled on 2026-08-23 that both are
      // answerable from the row.
      const requiresReassignment = assignment !== null && assignment.leaderId !== null;

      // A root holds an open row with no leader, so it satisfies neither branch
      // below honestly: the "no open pastoral assignment" refusal would state
      // something false about the record, and it would fire before `changeWithin`
      // could refuse the root for the reason section 4 gives. Left to fall through,
      // so the answer comes from the rule that applies.
      const isRoot = assignment !== null && assignment.leaderId === null;

      if (requiresReassignment && input.pastoralLeaderId === undefined) {
        throw new ValidationFailedError(
          'This person has a pastoral leader in their current Network, so the correction must name the leader they move to in the new one.',
          { field: 'pastoral_leader_id' },
        );
      }

      if (!requiresReassignment && !isRoot && input.pastoralLeaderId !== undefined) {
        // Refused rather than ignored. A client naming a leader expects a
        // reassignment, and silently dropping it would leave them believing one
        // happened.
        throw new ValidationFailedError(
          'This person has no open pastoral assignment, so there is no reassignment to perform and no leader to name.',
          { field: 'pastoral_leader_id' },
        );
      }

      if (input.pastoralLeaderId !== undefined && sameId(input.pastoralLeaderId, personId)) {
        // Section 5 invariant 2. With no open downline edge — which section 4 has
        // already required — this person's subtree is themselves alone, so a
        // one-node cycle is the only one reachable here. The `no_self` check
        // constraint would refuse it; this makes the refusal an answer.
        throw new InvariantViolationError('A person cannot be their own pastoral leader.', {
          field: 'pastoral_leader_id',
        });
      }

      if (requiresReassignment) {
        const lifecycle = await trx
          .selectFrom('person_lifecycle')
          .select('state')
          .where('person_id', '=', personId)
          .where('ended_at', 'is', null)
          .executeTakeFirst();

        if (lifecycle?.state === 'ARCHIVED') {
          // Section 5 forbids reassigning an archived Person, and the atomic pair
          // is a reassignment. Where they hold no open edge the correction is not
          // refused at all, which is why this sits inside the branch: a data
          // correction on an archived record is legitimate; re-parenting one is not.
          throw new InvariantViolationError(
            'That person is archived and still holds a pastoral assignment. Restore them first, then correct their sex.',
            { person_id: personId },
          );
        }
      }

      const { from } = await this.networks.changeWithin(trx, {
        personId,
        toNetwork,
        effectiveAt,
        backdated,
        actorId: actor.accountId,
        reason: input.reason,
      });

      let previousLeaderId: string | null = null;

      if (requiresReassignment && input.pastoralLeaderId !== undefined) {
        // Validated against the **new** Network and as of the effective instant,
        // which is what the constraint trigger compares. Section 4: the person
        // being corrected moves to a leader in their new Network, while a disciple
        // would move within their own unchanged one — two different rules, and this
        // is the first of them.
        await assertLeaderIsAssignable(
          trx,
          input.pastoralLeaderId,
          toNetwork,
          effectiveAt,
          this.networks,
        );

        ({ previousLeaderId } = await this.hierarchy.reassignWithin(trx, {
          personId,
          leaderId: input.pastoralLeaderId,
          effectiveAt,
        }));
      }

      const person = await trx
        .updateTable('persons')
        .set({ sex: input.sex })
        .where('id', '=', personId)
        .returning([
          'id',
          'member_id',
          'first_name',
          'middle_name',
          'last_name',
          'birth_date',
          'sex',
          'civil_status',
          'mobile_number',
        ])
        .executeTakeFirstOrThrow();

      // **One entry per action performed** (section 21), not one per request. Each
      // of these is separately named on section 21's list, and each is found by a
      // different search: a reader looking for pastoral transfers must find that
      // entry whether it arose from a reassignment or from a correction (section 5).
      await this.audit.writeWithin(trx, {
        actorId: actor.accountId,
        action: 'sex.corrected',
        targetType: 'person',
        targetId: personId,
        before: { sex: before.sex },
        after: { sex: person.sex },
        reason: input.reason,
      });

      await this.audit.writeWithin(trx, {
        actorId: actor.accountId,
        action: 'network.changed',
        targetType: 'person',
        targetId: personId,
        before: { network: from },
        after: { network: toNetwork, effective_at: effectiveAt.toISOString() },
        reason: input.reason,
      });

      if (requiresReassignment && input.pastoralLeaderId !== undefined) {
        await this.audit.writeWithin(trx, {
          actorId: actor.accountId,
          action: 'pastoral_assignment.transferred',
          targetType: 'person',
          targetId: personId,
          // Section 5 requires previous leader, new leader and timestamp.
          before: { leader_id: previousLeaderId },
          after: { leader_id: input.pastoralLeaderId, effective_at: effectiveAt.toISOString() },
          reason: input.reason,
        });
      }

      if (backdated) {
        await this.audit.writeWithin(trx, {
          actorId: actor.accountId,
          action: 'effective_date.backdated',
          targetType: 'person',
          targetId: personId,
          // Section 5: "audit logged with both the recorded date and the effective
          // date". Both, because the gap between them is the whole point of the
          // entry — it is what a later reader needs to explain a figure that moved.
          after: {
            operation: 'sex.corrected',
            recorded_at: recordedAt.toISOString(),
            effective_at: effectiveAt.toISOString(),
            effective_date: manilaDayOf(effectiveAt),
          },
          reason: input.reason,
        });
      }

      const response = {
        ...fullProfile(person),
        network: toNetwork,
        pastoral_leader_id: requiresReassignment ? (input.pastoralLeaderId ?? null) : null,
        // Both renderings, additively. `effective_at` is the instant the four rows
        // carry, rendered in UTC because that is unambiguous; `effective_date` is
        // the Asia/Manila day an administrator submitted and thinks in (section 20).
        effective_at: effectiveAt.toISOString(),
        effective_date: manilaDayOf(effectiveAt),
      };

      // Last, and recording exactly what the endpoint returns (section 22).
      await this.idempotency.completeWithin(trx, {
        ...claim,
        status: 200,
        body: response,
      });

      return response;
    });
  }

  /**
   * Refuses `people.correct_sex` held at anything narrower than Whole Church.
   *
   * Section 7 gives this capability one scope, and the guard alone cannot hold
   * that: the guard asks whether a grant covers the *target*, so a grant issued at
   * `OWN_SUBTREE` would pass for everyone inside that subtree. Held there it is
   * exactly the escalation the capability is Admin-only to close — moving a person
   * between Networks, and re-parenting them on the way, without ever holding
   * `people.manage_pastoral_assignment`.
   *
   * `SCOPE_DENIED` rather than `CAPABILITY_DENIED`: the actor does hold the
   * capability, and what fails is its reach (section 22).
   *
   * **Pre-empted by the guard since 2026-08-24, and kept as a second line.** The
   * rule generalised to every capability section 7 gives at one scope, and now
   * refuses in `AuthorizationService.authorize` before this runs — so through the
   * endpoint this is unreachable. Kept because it fails closed, costs one read,
   * and defends the one path the guard does not: a caller reaching this service
   * directly. It is not the enforcement, and `single-scope.spec.ts` is what pins
   * the rule.
   */
  private async assertCorrectSexIsHeldChurchWide(actor: Actor): Promise<void> {
    const churchWide = (await this.authorization.grantsFor(actor.accountId)).some(
      (grant) =>
        grant.capability === Capability.PeopleCorrectSex &&
        grant.scope.type === ScopeType.WholeChurch,
    );

    if (!churchWide) {
      throw new ScopeDeniedError(
        'Correcting a person’s sex is a Whole Church operation. A narrower grant of it covers nothing.',
        { capability: Capability.PeopleCorrectSex },
      );
    }
  }
}
