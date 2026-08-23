import { Body, Controller, Get, Inject, Param, Patch, Post, Put, Query } from '@nestjs/common';

import { CurrentActor } from '../auth/current-actor.decorator';
import { RequiresCapability } from '../auth/authorization/authorization.decorators';
import { Capability } from '../auth/authorization/capabilities';
import { type Actor } from '../auth/authorization/authorization.service';
import { NotFoundError } from '../common/errors/api-error';
import { CanonicalUuidPipe } from '../common/identifiers';
import { DATABASE, type Db } from '../database/database.module';
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
import { fullProfile, normalizeMobile, PeopleService, type SearchCursor } from './people.service';

/**
 * `/api/v1/people` (SKILL.md section 22).
 *
 * The interesting rule here is section 8, not section 7. A leader may search the
 * church-wide directory — that is what makes duplicate prevention possible at all
 * — but for a person outside their pastoral scope they see only enough to
 * recognise an existing record. Everything else is withheld, and the withholding
 * is done in one place so that adding a field to the full profile does not
 * silently widen what the church can see.
 */
@Controller('people')
export class PeopleController {
  constructor(
    private readonly people: PeopleService,
    // The connection is here for one reason: section 8's scope test reads the
    // tree, and the service method that performs it must be able to take a
    // caller's transaction (section 24, the bounded pool). A controller holding a
    // connection to hand on is the cost of that, and it does no data access of
    // its own.
    @Inject(DATABASE) private readonly db: Db,
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
        birthDate: body.birth_date,
        sex: body.sex,
        civilStatus: body.civil_status,
        mobileNumber: body.mobile_number ?? null,
        pastoralLeaderId: body.pastoral_leader_id,
        acknowledgedDuplicateIds: body.acknowledged_duplicate_ids ?? [],
      },
      actor,
      claim,
      // The same scope test the pre-flight lookup uses, so a refusal cannot
      // disclose what a read may not (section 8). Without it, a Tier 1 refusal
      // names the field that matched for a person the actor has no scope over —
      // and the refusal happens before the transaction opens, so probing costs
      // nothing and writes nothing.
      (candidateId) => this.people.isWithinViewScope(this.db, actor, candidateId),
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
    const visible = await this.people.visibleDuplicatesFor(
      {
        firstName: query.first_name,
        lastName: query.last_name,
        birthDate: query.birth_date ?? null,
        sex: query.sex,
        mobileNumberNormalized: normalizeMobile(query.mobile_number),
      },
      (personId) => this.people.isWithinViewScope(this.db, actor, personId),
    );

    return { data: visible.slice(0, limit), next_cursor: null };
  }

  @Get(':id')
  @RequiresCapability(Capability.PeopleViewSubtree, { kind: 'person', from: 'params.id' })
  async findOne(@Param('id', CanonicalUuidPipe) id: string): Promise<Record<string, unknown>> {
    const person = await this.people.findById(id);
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
    const { rows, nextCursor } = await this.people.searchByName(
      query.q,
      query.limit ?? 50,
      decodeCursor(query.cursor),
    );

    const data = await Promise.all(
      rows.map(async (person) => {
        if (await this.people.isWithinViewScope(this.db, actor, person.id)) {
          return fullProfile(person);
        }

        return this.people.minimalIdentity(person);
      }),
    );

    return { data, next_cursor: encodeCursor(nextCursor) };
  }

  @Patch(':id')
  @RequiresCapability(Capability.PeopleEditBasic, { kind: 'person', from: 'params.id' })
  async editBasic(
    @Param('id', CanonicalUuidPipe) id: string,
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
    @Param('id', CanonicalUuidPipe) id: string,
    @Body() body: CorrectSexDto,
    @CurrentActor() actor: Actor,
    @CurrentIdempotency() claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    // Returned unchanged, for the reason the basic edit gives: the service
    // composed this body and recorded it inside the write's transaction, and
    // reshaping it here would make the sent response differ from the stored one
    // (section 22).
    return this.people.correctSex(
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
    @Param('id', CanonicalUuidPipe) id: string,
    @Body() body: ReassignPastoralLeaderDto,
    @CurrentActor() actor: Actor,
    @CurrentIdempotency() claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    // Returned unchanged: the service composed this body and recorded it inside
    // the write's transaction (section 22).
    return this.people.reassignPastoralLeader(
      id,
      {
        leaderId: body.leader_id,
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
 * A cursor that does not decode is treated as absent rather than as an error. It
 * cannot be forged into anything dangerous — the worst a tampered value does is
 * start the page somewhere else in a directory section 8 already makes readable
 * church-wide — and refusing it would strand a client with no way back.
 */
function decodeCursor(value: string | undefined): SearchCursor | null {
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
    // Falls through to null.
  }

  return null;
}

function encodeCursor(cursor: SearchCursor | null): string | null {
  return cursor === null ? null : Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}
