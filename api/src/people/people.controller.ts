import { Body, Controller, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';

import { CurrentActor } from '../auth/current-actor.decorator';
import { RequiresCapability } from '../auth/authorization/authorization.decorators';
import { Capability } from '../auth/authorization/capabilities';
import { type Actor } from '../auth/authorization/authorization.service';
import { InvariantViolationError, NotFoundError } from '../common/errors/api-error';
import { unresolvableCursor } from '../common/cursor';
import { HierarchyService } from '../hierarchy/hierarchy.service';
import {
  CurrentIdempotency,
  type CurrentClaim,
} from '../common/idempotency/current-idempotency.decorator';

import {
  CorrectSexDto,
  ReassignPastoralLeaderDto,
  CreatePersonDto,
  DuplicateCandidatesDto,
  EditPersonDto,
  SearchPeopleDto,
} from './dto/people.dto';
import { PeopleDuplicatesService } from './people.duplicates.service';
import { PeopleReadService } from './people.read.service';
import { PeopleReassignmentService } from './people.reassignment.service';
import { PeopleService } from './people.service';
import { PeopleSexCorrectionService } from './people.sex-correction.service';
import { fullProfile, normalizeMobile, type SearchCursor } from './people.shared';

/**
 * `/api/v1/people` (SKILL.md section 22).
 *
 * The interesting rule here is section 8, not section 7. A leader may search the
 * church-wide directory — that is what makes duplicate prevention possible at all
 * — but for a person outside their pastoral scope they see only enough to
 * recognise an existing record. Everything else is withheld, and `fullProfile`
 * and `minimalIdentity` are where that decision is made, so adding a field to
 * the full profile does not silently widen what the church can see.
 *
 * **One payload is assembled outside those two**, and it is worth naming rather
 * than leaving as an exception somebody discovers. A path node carries four
 * fields: the Member ID and the full name, which are two of the five section 8
 * permits church-wide; the identifier, which is a handle rather than a fact about
 * the person, exactly as `minimalIdentity` carries one; and `network_root`, which
 * section 8 declares for this endpoint because section 5 requires that
 * distinction be surfaced. A node is not a profile, which is why it has a shape
 * of its own rather than reusing a helper.
 *
 * What holds it to those four is a test asserting the exact key set, not this
 * paragraph — the same instrument the church-wide search uses one describe
 * below, and for the same reason: a field added later must not leak here
 * unnoticed.
 */
@Controller('people')
export class PeopleController {
  constructor(
    private readonly people: PeopleService,
    private readonly read: PeopleReadService,
    private readonly duplicates: PeopleDuplicatesService,
    private readonly sexCorrection: PeopleSexCorrectionService,
    private readonly reassignment: PeopleReassignmentService,
    // The path is a hierarchy question answered on a `people` route, so it is
    // taken from the owning module's service rather than re-walked here
    // (section 2). `PeopleModule` already imports `HierarchyModule`.
    private readonly hierarchy: HierarchyService,
  ) {}

  /**
   * Section 9 requires the pastoral leader at registration, and the guard's scope
   * resolves against them: a leader may place a new Person under themselves or
   * under someone in their subtree, and nowhere else.
   *
   * That also settles what a subtree-scoped actor cannot do — create a Person
   * under nobody. Section 5 permits an unassigned Person, but only the import
   * creates one, and the import runs as Admin at Whole Church through the service
   * rather than through this endpoint (section 2, Initial data load).
   */
  @Post()
  @RequiresCapability(Capability.PeopleCreate, {
    kind: 'person',
    from: 'body.pastoral_leader_id',
  })
  async create(
    @Body() body: CreatePersonDto,
    @CurrentActor() actor: Actor,
    @CurrentIdempotency() claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    return this.people.create(
      {
        firstName: body.first_name,
        middleName: body.middle_name ?? null,
        lastName: body.last_name,
        birthDate: body.birth_date ?? null,
        sex: body.sex,
        civilStatus: body.civil_status,
        mobileNumber: body.mobile_number ?? null,
        // Always `UNDER`. The endpoint requires a leader, and section 5 makes who
        // holds a Network root a Network-level decision rather than something an
        // encoder does — so no request body can ask for one.
        placement: { kind: 'UNDER', pastoralLeaderId: body.pastoral_leader_id },
        acknowledgedDuplicateIds: body.acknowledged_duplicate_ids ?? [],
      },
      actor,
      claim,
      // The same scope test the pre-flight lookup uses, so a refusal cannot
      // disclose what a read may not (section 8). Without it, a Tier 1 refusal
      // names the field that matched for a person the actor has no scope over —
      // and the refusal happens before the transaction opens, so probing costs
      // nothing and writes nothing.
      (candidateId) => this.read.isWithinViewScope(actor, candidateId),
    );
  }

  /**
   * Candidates who may already be the person about to be encoded (section 3).
   *
   * **This is where Tier 2 surfaces.** Section 3 says a Tier 1 candidate is
   * acknowledged before creation and a Tier 2 candidate is "presented in a
   * candidate list" — and creation can only ever refuse on Tier 1, so without a
   * pre-flight surface every Tier 2 match would be computed and discarded. Section
   * 9 makes this the first step of the VIP workflow: search existing People first.
   *
   * A read, so it takes no idempotency key and writes nothing. It is guarded by
   * `people.view_subtree` against the actor themselves, for the same reason the
   * church-wide search is: section 8 makes the directory searchable by everyone
   * precisely so that duplicates can be prevented, and scoping the rows here would
   * defeat the endpoint's only purpose.
   *
   * It answers with section 22's collection envelope. `next_cursor` is always
   * null: a candidate set is bounded by how many people share a name or a
   * birthday, and paging past the strongest matches is not something an encoder
   * does. The envelope is that shape regardless, because section 22 makes
   * `/api/v1` additive-only — a collection shipped without one can never grow a
   * cursor once a phone depends on it.
   *
   * **The `slice` below is a truncation and section 22 reads a null cursor as
   * “this is the last page”, which is an open question rather than a settled
   * rule** (CLAUDE.md, Open). Since section 3's ordering puts in-scope candidates
   * first, the withheld tail is what a truncation reaches first — and that tail
   * is the cross-branch duplicate this endpoint exists to catch. It is recorded
   * rather than worked around here, because either answer is a rule about what
   * the API promises and neither is derivable.
   */
  @Get('duplicate-candidates')
  @RequiresCapability(Capability.PeopleViewSubtree, { kind: 'actor' })
  async duplicateCandidates(
    @Query() query: DuplicateCandidatesDto,
    @CurrentActor() actor: Actor,
  ): Promise<{ data: Record<string, unknown>[]; next_cursor: string | null }> {
    const limit = query.limit ?? 50;

    // Membership and fields are both redacted inside the service, in one place
    // shared with the creation refusal so the two surfaces cannot answer
    // differently.
    const visible = await this.duplicates.visibleDuplicatesFor(
      {
        firstName: query.first_name,
        lastName: query.last_name,
        birthDate: query.birth_date ?? null,
        sex: query.sex,
        mobileNumberNormalized: normalizeMobile(query.mobile_number),
      },
      (personId) => this.read.isWithinViewScope(actor, personId),
    );

    return { data: visible.slice(0, limit), next_cursor: null };
  }

  /**
   * The person's pastoral path, root first (section 8).
   *
   * **Guarded on the target, and that is what makes returning the whole chain
   * safe.** Section 8 holds a person outside the viewer's scope to five fields,
   * of which the direct leader's name is one, so a chain of ancestors would
   * exceed it. Every scope a grant may carry keeps this inside that rule, and the
   * two that matter do it for different reasons.
   *
   * Under `OWN_SUBTREE` or `SUBTREE_EXCL_SELF`, resolved by `isWithinSubtree`,
   * which walks the same `ancestorsOf` this path is built from: the actor is
   * provably *on* the returned chain, so everything below them is their subtree
   * and everything above is their own upline. That depends on the guard and this
   * handler sharing one walk -- change either, and it has to be re-argued.
   *
   * Under `NETWORK` the actor need not be on the chain at all, so that argument
   * does not apply and is not what carries it. `people.view_subtree` is not in
   * `WHOLE_CHURCH_ONLY`, so a Network grant is legal, and `scopeCovers` resolves
   * it by comparing the target's Network rather than by walking anything. What
   * keeps it safe is section 5: a cross-Network edge is forbidden absolutely, so
   * every node of one chain is in one Network and the grant covers each of them
   * individually.
   *
   * `WHOLE_CHURCH` covers everything by construction.
   *
   * **`network_root` is section 5's distinction, not decoration.** A Network root
   * and a Person with no assignment both produce a one-element path, and section 5
   * says a Person with no row "is therefore never a root; surface them as such
   * rather than silently rendering them as a second root of the tree". Without
   * the flag the two payloads are identical and a client draws an unassigned
   * Person as the top of a tree. It is false on every node but the first, since
   * only the first can hold a null-leader row.
   *
   * Section 22's collection envelope, with a `next_cursor` that is always null. A
   * path is bounded by the depth of the tree and has no page after it -- but the
   * two collections on this resource should not answer in two shapes, and
   * `duplicate-candidates` next door already answers in this one.
   */
  @Get(':id/pastoral-path')
  @RequiresCapability(Capability.PeopleViewSubtree, { kind: 'person', from: 'params.id' })
  async pastoralPath(
    @Param('id') id: string,
  ): Promise<{ data: Record<string, unknown>[]; next_cursor: string | null }> {
    // Asked before the path, so an unknown identifier is a 404 rather than a
    // one-element path naming a person who does not exist. The guard resolved
    // scope against this id and does not establish that the row is there.
    const person = await this.read.findById(id);
    if (!person) {
      throw new NotFoundError('No such person.');
    }

    const { ids, topIsRoot } = await this.hierarchy.pastoralPathOf(id);
    const names = await this.read.namesOf(ids);

    return {
      data: ids.map((personId, index) => {
        const named = names.get(personId);

        if (named === undefined) {
          // **The same kind of defect `rejectCycle` handles in the walk this path
          // is built from, answered the same way.** A bare `Error` renders
          // `INTERNAL_ERROR`, which is the 500-instead-of-an-answer failure this
          // project records for the self-leader check and the duplicate-email
          // `23505`.
          //
          // Both foreign keys point at `persons` and `namesOf` filters nothing,
          // so no assignment row can reach here. The live route is an identifier
          // whose case this map lookup compares and the SQL beside it does not,
          // which the global canonicalizing pipe closes -- it fails closed either
          // way. Refused rather than skipped, because a gap in a path reads as a
          // shorter chain.
          throw new InvariantViolationError(
            'This pastoral path names a person who does not exist. Report it; retrying will not help.',
            { person_id: id, missing_person_id: personId },
          );
        }

        return {
          id: personId,
          member_id: named.memberId,
          full_name: named.fullName,
          network_root: index === 0 && topIsRoot,
        };
      }),
      next_cursor: null,
    };
  }

  @Get(':id')
  @RequiresCapability(Capability.PeopleViewSubtree, { kind: 'person', from: 'params.id' })
  async findOne(@Param('id') id: string): Promise<Record<string, unknown>> {
    const person = await this.read.findById(id);
    if (!person) {
      throw new NotFoundError('No such person.');
    }

    // The guard has already established this person is within the actor's scope,
    // so the full profile is what section 8 authorizes.
    return fullProfile(person);
  }

  /**
   * Church-wide search, by name (section 8).
   *
   * **Deliberately not guarded by a subtree scope on the result.** Section 8 says
   * a leader may search the whole directory precisely so that duplicate
   * prevention works, and narrowing the search to their own subtree would defeat
   * it — they would create a second record for somebody another leader already
   * has. What is scoped is the *fields*, not the rows.
   */
  @Get()
  @RequiresCapability(Capability.PeopleViewSubtree, { kind: 'actor' })
  async search(
    @Query() query: SearchPeopleDto,
    @CurrentActor() actor: Actor,
  ): Promise<{ data: Record<string, unknown>[]; next_cursor: string | null }> {
    const { rows, nextCursor } = await this.read.searchByName(
      query.q,
      query.limit ?? 50,
      decodeCursor(query.cursor),
    );

    const data = await Promise.all(
      rows.map(async (person) => {
        if (await this.read.isWithinViewScope(actor, person.id)) {
          return fullProfile(person);
        }

        return this.read.minimalIdentity(person);
      }),
    );

    return { data, next_cursor: encodeCursor(nextCursor) };
  }

  @Patch(':id')
  @RequiresCapability(Capability.PeopleEditBasic, { kind: 'person', from: 'params.id' })
  async editBasic(
    @Param('id') id: string,
    @Body() body: EditPersonDto,
    @CurrentActor() actor: Actor,
    @CurrentIdempotency() claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    // Returned unchanged. The service composed this body and recorded it inside
    // the write's transaction, and reshaping it here would make the sent response
    // differ from the stored one (section 22).
    return this.people.editBasic(
      id,
      {
        firstName: body.first_name,
        middleName: body.middle_name,
        lastName: body.last_name,
        birthDate: body.birth_date,
        civilStatus: body.civil_status,
        mobileNumber: body.mobile_number,
      },
      actor,
      claim,
    );
  }

  /**
   * The audited sex correction of SKILL.md section 4.
   *
   * `PUT /{id}/<attribute>`, matching the pastoral-leader route section 22 lists,
   * because that is what this is: a change to one governed attribute of a Person,
   * not a general edit.
   *
   * The guard checks `people.correct_sex` against the person. It is one half of
   * the authorization — section 7's guard evaluates one capability against one
   * target, and this operation carries two further checks that a capability and a
   * scope cannot express: that the grant is Whole Church, and that backdating
   * additionally requires `records.backdate_effective_date` (section 5). Both live
   * in the service, so they hold for every caller rather than for this route only.
   */
  @Put(':id/sex')
  @RequiresCapability(Capability.PeopleCorrectSex, { kind: 'person', from: 'params.id' })
  async correctSex(
    @Param('id') id: string,
    @Body() body: CorrectSexDto,
    @CurrentActor() actor: Actor,
    @CurrentIdempotency() claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    // Returned unchanged, for the reason the basic edit gives: the service
    // composed this body and recorded it inside the write's transaction, and
    // reshaping it here would make the sent response differ from the stored one
    // (section 22).
    return this.sexCorrection.correctSex(
      id,
      {
        sex: body.sex,
        reason: body.reason,
        pastoralLeaderId: body.pastoral_leader_id,
        effectiveDate: body.effective_date,
      },
      actor,
      claim,
    );
  }

  /**
   * Reassigning a person's pastoral leader (SKILL.md section 5).
   *
   * **The guard checks one of the three objects this touches.** Section 5 requires
   * the source leader and the destination leader both to be within the actor's
   * scope, and forbids the actor acting on themselves or on anyone upline of them.
   * That is three objects with three different rules and a grant carries one
   * scope, so the guard evaluates the person and the `people` and `hierarchy`
   * domain layers evaluate the rest. A developer who implements the guard and
   * believes the rule is implemented has built half of it.
   */
  @Put(':id/pastoral-leader')
  @RequiresCapability(Capability.PeopleManagePastoralAssignment, {
    kind: 'person',
    from: 'params.id',
  })
  async reassignPastoralLeader(
    @Param('id') id: string,
    @Body() body: ReassignPastoralLeaderDto,
    @CurrentActor() actor: Actor,
    @CurrentIdempotency() claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    // Returned unchanged: the service composed this body and recorded it inside
    // the write's transaction (section 22).
    return this.reassignment.reassignPastoralLeader(
      id,
      {
        leaderId: body.pastoral_leader_id,
        reason: body.reason,
        effectiveDate: body.effective_date,
      },
      actor,
      claim,
    );
  }
}

/**
 * The cursor is opaque: clients pass it back unmodified and never construct one
 * (section 22). Base64 of the keyset, so its shape can change without a client
 * having learned to read it.
 *
 * **A cursor this cannot resolve is refused**, on the ruling of 2026-08-31 now written
 * into section 22, through the shared refusal in `common/cursor.ts` so that this route
 * and the Cell roster answer identically. It was treated as absent until then, and the
 * roster was changed to match *this* file on a review pass, so the two agreed by
 * copying rather than by decision.
 *
 * The stranding argument that stood here does not survive: the recovery is a request
 * the client can already make — drop the cursor and start over — which is exactly what
 * the old behaviour did for it, silently, while it appended a page it already held. A
 * forged value is still harmless for the reason given before, that the worst it does is
 * start the page elsewhere in a directory section 8 makes readable church-wide; being
 * harmless is not a reason to accept one the server cannot read.
 */
function decodeCursor(value: string | undefined): SearchCursor | null {
  // An **absent** cursor is absent. The empty string is already refused by the DTO in
  // front of this; it is treated as absent here so the function is total for a caller
  // that has none.
  if (value === undefined || value === '') {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));

    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as SearchCursor).lastName === 'string' &&
      typeof (parsed as SearchCursor).firstName === 'string' &&
      typeof (parsed as SearchCursor).id === 'string'
    ) {
      return parsed as SearchCursor;
    }
  } catch {
    // Falls through to the refusal below: a value that is not base64url JSON and one
    // that is JSON of the wrong shape are equally unresolvable.
  }

  throw unresolvableCursor();
}

function encodeCursor(cursor: SearchCursor | null): string | null {
  return cursor === null ? null : Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}
