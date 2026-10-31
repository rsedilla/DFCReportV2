import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Optional,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ThrottlerException, ThrottlerStorage } from '@nestjs/throttler';

import { CurrentActor } from '../auth/current-actor.decorator';
import { RequiresCapability } from '../auth/authorization/authorization.decorators';
import { Capability } from '../auth/authorization/capabilities';
import { AuthorizationService, type Actor } from '../auth/authorization/authorization.service';
import {
  InvariantViolationError,
  NotFoundError,
  ScopeDeniedError,
  ValidationFailedError,
} from '../common/errors/api-error';
import { unresolvableCursor } from '../common/cursor';
import { canonicalId, isUuid, sameId } from '../common/identifiers';
import { HierarchyService } from '../hierarchy/hierarchy.service';
import {
  CurrentIdempotency,
  type CurrentClaim,
} from '../common/idempotency/current-idempotency.decorator';

import {
  AwaitingReassignmentDto,
  CHURCH_WIDE_PAGE_LIMIT,
  CHURCH_WIDE_SEARCH_MINIMUM,
  CHURCH_WIDE_SEARCHES_PER_MINUTE,
  CorrectSexDto,
  ReassignPastoralLeaderDto,
  CreatePersonDto,
  DuplicateCandidatesDto,
  EditPersonDto,
  SEARCH_MINIMUM,
  SearchPeopleDto,
} from './dto/people.dto';
import { ArchivePersonDto, LifecycleListDto } from './dto/lifecycle.dto';
import { MergePersonDto, MergePreviewDto } from './dto/merge.dto';
import { PeopleMergeService } from './people.merge.service';
import { APPLICATION_RULES, normalizeName } from './duplicate-matching';
import { ABSENT_PEOPLE_PORT, type AbsentPeoplePort } from './person-archive.ports';
import { PeopleLifecycleService } from './people.lifecycle.service';
import { PeopleDuplicatesService } from './people.duplicates.service';
import { PeopleReadService } from './people.read.service';
import { PeopleReassignmentService } from './people.reassignment.service';
import { PeopleService } from './people.service';
import { PeopleSexCorrectionService } from './people.sex-correction.service';
import { TreePagingQueryDto } from './dto/network.dto';
import { decodeViewsCursor, PersonViewsService, type PersonView } from './person-views.service';
import {
  composeName,
  fullProfile,
  listedProfile,
  normalizeMobile,
  type SearchCursor,
} from './people.shared';
import { isStorableText } from '../common/text/storable-text';

/**
 * `/api/v1/people` (SKILL.md section 22).
 *
 * The interesting rule here is section 8, not section 7. A leader may search the
 * directory — narrowed to their own pastoral scope, which only a Whole Church scope may
 * widen (decisions 0244 and 0389), and it is `duplicate-candidates` below rather than this search
 * that makes duplicate prevention possible — and for a person outside their
 * pastoral scope they see only enough to
 * recognise an existing record. Everything else is withheld, and `fullProfile`
 * and `identityOnly` are where that decision is made, so adding a field to
 * the full profile does not silently widen what the church can see.
 *
 * **One payload is assembled outside those two**, and it is worth naming rather
 * than leaving as an exception somebody discovers. A path node carries four
 * fields: the Member ID and the full name, which are two of the five section 8
 * permits church-wide; the identifier, which is a handle rather than a fact about
 * the person, exactly as `identityOnly` carries one; and `network_root`, which
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
    private readonly merges: PeopleMergeService,
    // The path is a hierarchy question answered on a `people` route, so it is
    // taken from the owning module's service rather than re-walked here
    // (section 2). `PeopleModule` already imports `HierarchyModule`.
    private readonly hierarchy: HierarchyService,
    private readonly views: PersonViewsService,
    // The attention list below narrows to the actor's own scope, and the scope set
    // is the authorization module's to compute rather than this controller's to
    // re-derive (section 2, and the seam decision 0106 made its own module).
    private readonly authorization: AuthorizationService,
    // The throttler's own store, so the church-wide count is cleared and bounded exactly
    // as the global limit is (decision 0303).
    @Inject(ThrottlerStorage) private readonly throttle: ThrottlerStorage,
    private readonly lifecycle: PeopleLifecycleService,
    // Bound by `AbsentPeopleBindingModule`; absent, the list refuses (decision 0397).
    @Optional() @Inject(ABSENT_PEOPLE_PORT) private readonly absent?: AbsentPeoplePort,
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
    // **Read before the add's transaction opens, never inside it** (decision 0401). The
    // duplicate gate now runs inside that transaction, under the last-name lock, and a
    // per-candidate `covers` there would take a second pool connection while holding
    // the first: ten adds at once would each wait on a connection none could release.
    // So the scope is read once here, as the pre-flight read does, and the gate tests
    // a set. As there, an actor whose own subtree holds a cycle is refused, here on every
    // add rather than only on a duplicate; section 5 refuses a cycle when it is written.
    const membership = await this.authorization.scopeMembership(
      actor,
      Capability.PeopleViewSubtree,
    );

    return this.people.create(
      {
        title: body.title ?? null,
        firstName: body.first_name,
        middleName: body.middle_name ?? null,
        lastName: body.last_name,
        // A ticked field may arrive as "" (decision 0328); it is stored as no value.
        birthDate: body.birth_date_not_given === true ? null : (body.birth_date ?? null),
        sex: body.sex,
        civilStatus: body.civil_status,
        mobileNumber: body.mobile_number_not_given === true ? null : (body.mobile_number ?? null),
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
      // and the refusal writes nothing, so probing would cost nothing. A candidate
      // added since the scope was read is in it where their leader is.
      (candidateId, leaderId) =>
        Promise.resolve(
          membership.kind === 'WHOLE_CHURCH' ||
            membership.personIds.has(canonicalId(candidateId)) ||
            (leaderId !== null && membership.personIds.has(canonicalId(leaderId))),
        ),
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
   * `people.view_subtree` against the actor themselves, and scoping the rows here
   * would defeat the endpoint's only purpose: the duplicate an actor cannot see is
   * exactly the one they are about to recreate.
   *
   * *This read "for the same reason the church-wide search is", which no longer
   * points anywhere true — since decision 0244 that route scopes its rows by
   * default. This endpoint is unchanged and is now the church-wide read of the two,
   * carrying duplicate prevention by itself.*
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

    // The scope is read once rather than per candidate (checklist row
    // perf-duplicate-check): the enumeration of the rule `covers` tests per target
    // (section 7). It differs only on a cycle: it refuses whenever the actor's own
    // subtree holds one, where `covers` refused only a candidate whose upline met it.
    const membership = await this.authorization.scopeMembership(
      actor,
      Capability.PeopleViewSubtree,
    );

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
      (personId) =>
        Promise.resolve(
          membership.kind === 'WHOLE_CHURCH' || membership.personIds.has(canonicalId(personId)),
        ),
      undefined,
      // The pre-flight list gives the reason the save will stop on (decision 0399).
      APPLICATION_RULES,
    );

    const shown = visible.slice(0, limit);

    // **A lookup that shows somebody outside the scope is recorded** (section 3,
    // decision 0304): the names typed and the people shown, never the birthday or the
    // mobile number. The response no longer names them (decision 0405); the entry does.
    const outside = shown.filter((row) => row.withheld).map((row) => row.personId);
    if (outside.length > 0) {
      await this.people.recordDuplicateCheck(
        actor.accountId,
        query.first_name,
        query.last_name,
        outside,
      );
    }

    return { data: shown.map((row) => row.body), next_cursor: null };
  }

  /**
   * People within the actor's scope whose own pastoral leader holds no open
   * pastoral assignment (SKILL.md sections 5, 19 and 20; decision 0232).
   *
   * **Section 20 requires this list and calls it required rather than advisable.**
   * The placement graph continues a chain past a leader who has left, so a report
   * still adds up — and that reconstruction is exactly what removes the pressure to
   * fix the gap. This is the surface that keeps the repair visible.
   *
   * **It keys on the condition rather than on the lifecycle flag** (decision 0232).
   * Section 20 named its subject "archived"; the reconstruction fires on a leader
   * holding no assignment, of which section 5 gives three legitimate causes, so the
   * narrower reading surfaced one and hid two. The service carries the query and the
   * one exclusion — a leader holding an `ADMIN` account, which is section 5's own
   * remedy one relationship over.
   *
   * **`people.view_subtree` against the actor**, with the narrowing done in the
   * service, which is the shape `GET /people/duplicate-candidates` above already
   * uses. It is the Read capability for this domain and is grantable `read_only`;
   * a management capability granted `read_only` is refused at creation, so guarding
   * an attention list with one would make it ungrantable to exactly the person
   * section 20 wants reading it. Not `reports.view_subtree`, which section 7 makes
   * **dated** — this route names no period, and a dated capability over a route with
   * no period is the error section 7 warns against in the paragraph defining the
   * phrase.
   *
   * **The scope is the actor's own, and the filter narrows rather than widens.**
   * `scopeMembership` returns Whole Church or a set of person identifiers, and the
   * set is applied to the *person* rather than to their leader: section 20 says the
   * list is shown to "the upline who can act", and the actor can act on somebody
   * inside their own subtree whether or not the departed leader still is.
   *
   * **Never ranked** (sections 13, 15, 17). Ordered by name in the service, with no
   * measure of how long a gap has stood and no colour grading. Each entry names the
   * leader who left, which is what a client needs in order to offer the reassignment
   * that resolves it (section 19).
   */
  @Get('awaiting-reassignment')
  @RequiresCapability(Capability.PeopleViewSubtree, { kind: 'actor' })
  async awaitingReassignment(
    @Query() query: AwaitingReassignmentDto,
    @CurrentActor() actor: Actor,
  ): Promise<{ data: Record<string, unknown>[]; next_cursor: string | null }> {
    const scope = await this.authorization.scopeMembership(actor, Capability.PeopleViewSubtree);

    const { rows, nextCursor } = await this.read.awaitingReassignment(
      scope,
      query.limit ?? 50,
      decodeCursor(query.cursor),
    );

    return {
      data: rows.map((row) => ({
        id: row.id,
        member_id: row.member_id,
        full_name: composeName(row),
        // Named rather than merely counted: section 19 asks each entry to carry the
        // action that resolves it, and reassigning somebody means knowing who they
        // are being moved away from.
        former_leader: {
          person_id: row.leader_id,
          member_id: row.leader_member_id,
          full_name: composeName({
            title: row.leader_title,
            first_name: row.leader_first_name,
            middle_name: row.leader_middle_name,
            last_name: row.leader_last_name,
          }),
        },
      })),
      next_cursor: encodeCursor(nextCursor),
    };
  }

  /**
   * People's *Absent 3+ Months* list (SKILL.md section 19, decision 0397): the current people
   * of the actor's scope with an Absent mark and no Present mark in each of the last three
   * finished months, on a roster or a checklist all month, and leading no Cell that met.
   *
   * **Read-only for whoever reads it.** A Full view leader reads their branch; the Admin's
   * Archive is a separate route under `people.manage_lifecycle`. Here, before `:id`, so the
   * literal segment is not taken for an identifier. Composed in `attendance` behind a port,
   * because the marks and the Cells belong to modules that import this one.
   */
  @Get('absent')
  @RequiresCapability(Capability.PeopleViewSubtree, { kind: 'actor' })
  async absentList(
    @Query() query: LifecycleListDto,
    @CurrentActor() actor: Actor,
  ): Promise<{ months: string[]; data: Record<string, unknown>[]; next_cursor: string | null }> {
    if (this.absent === undefined) {
      throw new InvariantViolationError(
        'This deployment cannot list people absent three months: a port it needs is not bound.',
        {},
      );
    }

    const scope = await this.authorization.scopeMembership(actor, Capability.PeopleViewSubtree);
    const page = await this.absent.absentPage(
      scope,
      query.limit ?? 50,
      decodeRosterLikeCursor(query.cursor),
    );

    return {
      months: page.months,
      data: page.rows as unknown as Record<string, unknown>[],
      next_cursor: encodeJsonCursor(page.nextCursor),
    };
  }

  /**
   * Everyone archived, newest first, for the Admin's *Archived* view (decision 0397, point 9).
   * Guarded by the capability that restores them, because the view exists to restore from.
   */
  @Get('archived')
  @RequiresCapability(Capability.PeopleManageLifecycle, { kind: 'actor' })
  async archivedList(
    @Query() query: LifecycleListDto,
  ): Promise<{ data: Record<string, unknown>[]; next_cursor: string | null }> {
    const page = await this.lifecycle.archivedPage(
      query.limit ?? 50,
      decodeArchivedCursor(query.cursor),
    );

    return { data: page.rows, next_cursor: encodeJsonCursor(page.nextCursor) };
  }

  /**
   * Archive a Person (SKILL.md sections 3 and 6, decision 0397). `people.manage_lifecycle`
   * is Admin-only at Whole Church; the account-access decision additionally needs
   * `accounts.manage`, which the service asks.
   */
  @Post(':id/archive')
  @HttpCode(200)
  @RequiresCapability(Capability.PeopleManageLifecycle, { kind: 'person', from: 'params.id' })
  async archive(
    @Param('id') id: string,
    @Body() body: ArchivePersonDto,
    @CurrentActor() actor: Actor,
    @CurrentIdempotency() claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    // Returned unchanged: the service composed this body and recorded it inside the write's
    // transaction (section 22).
    return this.lifecycle.archive(
      id,
      { reason: body.reason, note: body.note, accountAccess: body.account_access },
      actor,
      claim,
    );
  }

  /**
   * What merging `duplicate_id` into this record would be refused for, now (decision 0408).
   * The merge screen reads it before offering the button; the merge asks the same again
   * after locking both records. `people.merge` is Admin-only at Whole Church (section 3).
   */
  @Get(':id/merge-preview')
  @RequiresCapability(Capability.PeopleMerge, { kind: 'person', from: 'params.id' })
  async mergePreview(
    @Param('id') id: string,
    @Query() query: MergePreviewDto,
    @CurrentActor() actor: Actor,
  ): Promise<Record<string, unknown>> {
    return this.merges.preview(id, query.duplicate_id, actor);
  }

  /** Join `duplicate_id` into this record (SKILL.md section 3, decision 0408). */
  @Post(':id/merge')
  @HttpCode(200)
  @RequiresCapability(Capability.PeopleMerge, { kind: 'person', from: 'params.id' })
  async merge(
    @Param('id') id: string,
    @Body() body: MergePersonDto,
    @CurrentActor() actor: Actor,
    @CurrentIdempotency() claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    return this.merges.merge(
      id,
      { duplicateId: body.duplicate_id, reason: body.reason },
      actor,
      claim,
    );
  }

  /** Restore an archived Person to `CURRENT`, and nothing else (decision 0397, point 9). */
  @Post(':id/restore')
  @HttpCode(200)
  @RequiresCapability(Capability.PeopleManageLifecycle, { kind: 'person', from: 'params.id' })
  async restore(
    @Param('id') id: string,
    @CurrentActor() actor: Actor,
    @CurrentIdempotency() claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    return this.lifecycle.restore(id, actor, claim);
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
  async pastoralPath(@Param('id') id: string): Promise<{
    data: Record<string, unknown>[];
    next_cursor: string | null;
    no_leader_reason: 'ARCHIVED' | 'OUTSIDE_TREE' | null;
  }> {
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
      // Which of section 5's situations a person with no leader is in (decision 0270).
      // Null wherever the path has a leader or the person is a root.
      no_leader_reason: ids.length === 1 && !topIsRoot ? await this.read.noLeaderReason(id) : null,
    };
  }

  @Get(':id')
  @RequiresCapability(Capability.PeopleViewSubtree, { kind: 'person', from: 'params.id' })
  async findOne(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
  ): Promise<Record<string, unknown>> {
    const person = await this.read.findById(id);
    if (!person) {
      // A record merged away keeps its page, read only, naming where the person is now
      // (decision 0408, point 14): no leader, no Cell, no action.
      const merged = await this.merges.mergedLineOf(id);
      if (merged) {
        await this.views.record(canonicalId(id), actor.personId);
        return merged;
      }
      throw new NotFoundError('No such person.');
    }

    // Every read of a person's full record is recorded for the Admin, whichever screen asked
    // (decision 0414), once the record is known to exist. The record never fails the answer:
    // a failure to write it is logged.
    await this.views.record(person.id, actor.personId);

    // The guard has already established this person is within the actor's scope,
    // so the full profile is what section 8 authorizes. `archived` is the page's read-only
    // line for an archived person, null for a current one (decision 0397, point 10).
    return {
      ...fullProfile(person),
      archived: await this.lifecycle.archivedLineOf(person.id),
      // How many people they pastor now, so the page can say why Archive is not offered.
      pastors: await this.lifecycle.pastorsOf(person.id),
    };
  }

  /**
   * Who opened or looked up this person's record, newest first (SKILL.md sections 7, 8 and 21,
   * decision 0414).
   *
   * **The Admin's alone, under `accounts.manage`**, which by default only the Admin holds at
   * Whole Church and section 7 now says covers this read: the owner chose that the log is shown
   * to the Admin only, and `audit.view`, the other read of who did what, is also held by the two
   * Senior Pastors.
   */
  @Get(':id/views')
  @RequiresCapability(Capability.AccountsManage, { kind: 'person', from: 'params.id' })
  async openings(
    @Param('id') id: string,
    @Query() query: TreePagingQueryDto,
  ): Promise<{ data: PersonView[]; next_cursor: string | null }> {
    const after = query.cursor === undefined ? null : decodeViewsCursor(query.cursor);
    return this.views.listFor(canonicalId(id), query.limit ?? 50, after);
  }

  /**
   * List or search the searcher's scope, or search the church when asked (section 8,
   * decision 0259).
   *
   * **Both the rows and the fields are scoped, and they are scoped separately.**
   * The fields have always been: a person outside the actor's pastoral scope comes
   * back as `identityOnly`, five fields, and that is unchanged. The rows are new
   * (ruling of 2026-09-13, decision 0244) — absent `church_wide`, the query returns
   * only people the actor's `people.view_subtree` grant reaches.
   *
   * *This docblock previously said the route was "deliberately not guarded by a
   * subtree scope on the result", because narrowing it "would defeat" duplicate
   * prevention: a leader would create a second record for somebody another leader
   * already has. **That was false**, and the ruling records the refutation rather
   * than deleting the claim. Duplicate prevention is answered by
   * `GET /people/duplicate-candidates`, which the Add a Person screen calls as a
   * name is typed and which reaches the whole church whatever this route returns.
   * The argument had been written into the code as the design's reason, so a reader
   * checking the reasoning would have found it here and agreed with it.*
   *
   * **`church_wide` is a Whole Church searcher's alone** (decision 0389), and below that is
   * refused; `upline` adds the searcher's own leaders, as five fields each, for naming who
   * ran a Cell meeting. Neither widens a grant.
   *
   * The scope set is fetched once and handed to the query, rather than the page
   * being filtered after it returns — see `searchByName` for why that distinction
   * is not cosmetic.
   */
  @Get()
  @RequiresCapability(Capability.PeopleViewSubtree, { kind: 'actor' })
  async search(
    @Query() query: SearchPeopleDto,
    @CurrentActor() actor: Actor,
  ): Promise<{ data: Record<string, unknown>[]; next_cursor: string | null }> {
    // Read once, and used three times: to refuse a church-wide search below Whole Church, to
    // restrict the rows of a search of the searcher's own scope, and to decide each row's
    // fields. Whole Church is a sentinel, so the widest scope materialises nothing.
    const membership = await this.authorization.scopeMembership(
      actor,
      Capability.PeopleViewSubtree,
    );
    // **The church-wide directory is a Whole Church searcher's alone** (decision 0389): a
    // leader searches the people they oversee, in every picker and from outside the app.
    // Refused first in this handler, after only the request's own shape is checked, as a report
    // answers scope first (decision 0253), and before the rate limit, so it spends nothing.
    if (query.church_wide && membership.kind !== 'WHOLE_CHURCH') {
      throw new ScopeDeniedError(
        'You can search only the people you oversee (SKILL.md section 8).',
      );
    }
    // **The minimum is counted on the term as it is searched, not as it was typed.** The
    // DTO's bound reads the raw string, and `normalizeName` turns a hyphen or an apostrophe
    // into a separator and drops Jr, Sr, II and III. So `a-`, `a'` and ` a` each passed it
    // and searched for a single letter, across the church in church-wide mode, and `Jr`
    // passed it and was answered with an empty list. Refused here with the field named, which is the shape a client shows as
    // a sentence rather than as "some fields need correcting".
    // **No term lists the searcher's own scope** (decision 0259): section 8
    // makes the People screen that list. The church-wide directory is never listed whole,
    // so it still needs a term.
    // **Church-wide takes three characters, a page of at most 20, and 30 searches a minute
    // per account, and each one is audited** (section 8, decision 0303), whoever sends it.
    const tooShort = query.church_wide
      ? 'Enter at least three letters of a name.'
      : 'Enter at least two letters of a name.';
    if (query.q === undefined && query.church_wide) {
      throw new ValidationFailedError(tooShort, { field: 'q' });
    }
    if (
      query.q !== undefined &&
      normalizeName(query.q).replace(/\s+/g, '').length <
        (query.church_wide ? CHURCH_WIDE_SEARCH_MINIMUM : SEARCH_MINIMUM)
    ) {
      throw new ValidationFailedError(tooShort, { field: 'q' });
    }
    if (query.church_wide && query.limit !== undefined && query.limit > CHURCH_WIDE_PAGE_LIMIT) {
      throw new ValidationFailedError(
        `A church-wide search returns at most ${CHURCH_WIDE_PAGE_LIMIT} people at a time.`,
        { field: 'limit' },
      );
    }
    const cursor = decodeCursor(query.cursor);
    if (query.church_wide) {
      // Counted after the checks above and the cursor, so a refused request spends nothing.
      // **The throttler name is per account, not shared.** The stock storage keeps its
      // expiry timers per name and cancels every one under a name when any key's block
      // ends, so a shared name let one account's block freeze everybody else's count.
      const key = `church-wide-search:${actor.accountId}`;
      const spent = await this.throttle.increment(
        key,
        60_000,
        CHURCH_WIDE_SEARCHES_PER_MINUTE,
        60_000,
        key,
      );
      if (spent.isBlocked) {
        throw new ThrottlerException();
      }
    }

    // The leaders above the searcher join the rows when asked (decision 0389), for naming who
    // ran a Cell meeting; they are outside the scope, so `inView` below gives them five fields.
    const upline =
      query.upline && membership.kind !== 'WHOLE_CHURCH'
        ? (await this.hierarchy.pastoralPathOf(actor.personId)).ids.filter(
            (id) => !sameId(id, actor.personId),
          )
        : [];
    const scoped =
      query.church_wide || membership.kind === 'WHOLE_CHURCH'
        ? null
        : upline.length === 0
          ? membership.personIds
          : new Set([...membership.personIds, ...upline.map(canonicalId)]);
    // A Network narrows the rows in the query rather than the page (decision 0299), so a page
    // is never short of people who match.
    const inNetwork =
      query.network === undefined ? null : await this.read.whoseNetworkIsNow(query.network);
    const restrictTo =
      inNetwork === null
        ? scoped
        : scoped === null
          ? inNetwork
          : new Set([...scoped].filter((id) => inNetwork.has(id)));

    const { rows, nextCursor } = await this.read.searchByName(
      query.q ?? null,
      query.limit ?? (query.church_wide ? CHURCH_WIDE_PAGE_LIMIT : 50),
      cursor,
      restrictTo,
      // A Member ID matches only inside the searcher's own scope: church-wide, a prefix
      // such as `M-00` would page the directory the minimum exists to protect.
      { memberId: !query.church_wide },
    );

    // **The page is answered in a fixed number of queries** (checklist row
    // perf-people-search). Each row was checked one at a time, about four queries a row.
    // Its scope is now read from the membership above, which is the enumeration of the
    // same rule `covers` tests per target (section 7), and the leader names and Networks
    // are read for the whole page together. The two differ only on a cycle in the tree,
    // as `scopeMembership` records: the enumeration refuses where `covers` might answer.
    const inView = (personId: string) =>
      membership.kind === 'WHOLE_CHURCH' || membership.personIds.has(canonicalId(personId));
    const [leaderNames, networks] = await Promise.all([
      this.read.directLeaderNamesOf(rows.map((person) => person.id)),
      this.read.currentNetworksOf(
        rows.filter((person) => !inView(person.id)).map((person) => person.id),
      ),
    ]);
    const data = rows.map((person) =>
      inView(person.id)
        ? // The pastoral leader's name, as an out-of-scope row already carries it, for the
          // People list's leader column (decision 0259).
          // A list row's name has the middle name's initial (decision 0375); the person's own
          // record, `GET /people/{id}`, keeps it whole.
          {
            // Without birthday, civil status and mobile number (decision 0414).
            ...listedProfile(person),
            full_name: composeName(person),
            direct_leader_name: leaderNames.get(person.id) ?? null,
          }
        : this.read.identityOnly(
            person,
            networks.get(person.id) ?? null,
            leaderNames.get(person.id) ?? null,
          ),
    );

    if (query.church_wide) {
      await this.people.recordDirectorySearch(actor.accountId, query.q ?? '', rows.length);
    }

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
        title: body.title,
        firstName: body.first_name,
        middleName: body.middle_name,
        lastName: body.last_name,
        birthDate: body.birth_date,
        civilStatus: body.civil_status,
        mobileNumber: body.mobile_number,
        acknowledgedDuplicateIds: body.acknowledged_duplicate_ids ?? [],
      },
      actor,
      claim,
      // The same scope test creation uses, so a refusal discloses nothing a read may not.
      (candidateId) => this.read.isWithinViewScope(actor, candidateId),
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
 * into section 22, through the shared refusal in `common/cursor.ts` so that this route,
 * the Cell roster and the leadership-request queue answer identically. It was treated as
 * absent until then — the decision was made *here*, and never pinned here; the roster
 * was changed to match this file on a review pass and the queue then matched both, so
 * one choice read as three endpoints agreeing.
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
      isStorableText((parsed as SearchCursor).lastName) &&
      isStorableText((parsed as SearchCursor).firstName) &&
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

/** The first-name keyset the Absent 3+ Months list pages by, opaque like every cursor here. */
function decodeRosterLikeCursor(
  value: string | undefined,
): { firstName: string; lastName: string; memberId: string } | null {
  const parsed = decodeJsonCursor(value);

  if (parsed === null) {
    return null;
  }

  if (
    isStorableText(parsed.firstName) &&
    isStorableText(parsed.lastName) &&
    typeof parsed.memberId === 'string'
  ) {
    return parsed as { firstName: string; lastName: string; memberId: string };
  }

  throw unresolvableCursor();
}

/** The Archived view's keyset: the archive instant and the Person's identifier. */
function decodeArchivedCursor(
  value: string | undefined,
): { archivedAt: string; id: string } | null {
  const parsed = decodeJsonCursor(value);

  if (parsed === null) {
    return null;
  }

  if (
    typeof parsed.archivedAt === 'string' &&
    !Number.isNaN(Date.parse(parsed.archivedAt)) &&
    typeof parsed.id === 'string' &&
    isUuid(parsed.id)
  ) {
    return parsed as { archivedAt: string; id: string };
  }

  throw unresolvableCursor();
}

function decodeJsonCursor(value: string | undefined): Record<string, unknown> | null {
  if (value === undefined || value === '') {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));

    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Falls through to the refusal, as `decodeCursor` does.
  }

  throw unresolvableCursor();
}

function encodeJsonCursor(cursor: object | null): string | null {
  return cursor === null ? null : Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function encodeCursor(cursor: SearchCursor | null): string | null {
  return cursor === null ? null : Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}
