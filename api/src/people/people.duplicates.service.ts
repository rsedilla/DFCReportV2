import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import { DATABASE, type Db } from '../database/database.module';

import {
  findCandidates,
  fullNameOf,
  normalizeName,
  type Candidate,
  type Match,
  type Subject,
} from './duplicate-matching';
import {
  ACCENTED,
  UNACCENTED,
  escapeLike,
  normalizeMobile,
  transpositionsOf,
} from './people.shared';

/**
 * Duplicate matching and what a viewer may be told about a candidate (SKILL.md
 * section 3, and section 8's redaction).
 *
 * Its own service because the section 8 rule is subtle enough to be got wrong
 * four times already, and because two surfaces answer a viewer whose scope may
 * be narrower than the church: the pre-flight lookup that shows Tier 2
 * candidates, and creation, which can only ever refuse on Tier 1. Both go
 * through `visibleDuplicatesFor`, so they cannot answer differently.
 *
 * Not "two surfaces return candidates" — the tree import returns them too, to
 * an administrator, and the paragraph below is what says why that is sound.
 *
 * **`findDuplicates` is the unredacted primitive and is public**, so that is a
 * guarantee about these two surfaces rather than about the class. Its callers
 * outside this class each owe their own answer to section 8, and neither borrows
 * this one:
 * the creation gate in `people.service.ts` pairs its tier test with
 * `canSeeReasons`, and the tree import returns unredacted candidates into its
 * dry-run report, which is sound only because the actor is Admin at Whole Church
 * (section 2) and the redaction would be a no-op — the argument is made where
 * it is relied on, in `tree-import.ts`.
 *
 * So this is not "everything returning candidates comes through here". It is that
 * every surface where the redaction could *bite* comes through here, and a third
 * one must either come through here or argue its exemption as the import does.
 */
@Injectable()
export class PeopleDuplicatesService {
  constructor(@Inject(DATABASE) private readonly db: Db) {}

  /**
   * Candidates that may already be the person described (section 3).
   *
   * The population is narrowed in SQL and scored in TypeScript, and **the
   * narrowing is the part that can silently defeat a rule**: a candidate the SQL
   * excludes is never scored, however well the tiers are written.
   *
   * So it is deliberately loose. A row qualifies on a shared birthday, a shared
   * normalized mobile number, or a surname whose *normalized* first letter
   * matches — normalized, because section 3 requires diacritics stripped for
   * comparison and `Ángeles` against `Angeles` would otherwise be excluded before
   * the matcher ever saw it.
   *
   * Two rules depend on more than the surname initial and are given their own
   * branch rather than left to it: a shared first name, which is what carries the
   * surname-change case section 3 names, and a birthday that is a digit
   * transposition away, which by construction is not an equal birthday.
   *
   * That is a small set in a church of this size (section 2, Scale) and keeps
   * every rule in one readable place.
   *
   * ---
   *
   * The candidates a viewer may be shown — membership, fields and order all
   * redacted (section 3, which states the rule in three parts).
   *
   * Runs the matcher twice: once on the subject as given, and once on a subject
   * stripped of everything section 8 protects. The second run decides which
   * out-of-scope candidates may appear at all, and which of them `only` keeps —
   * see `visibleCandidates`.
   *
   * Here rather than at the call sites so that the pre-flight lookup and the
   * creation refusal cannot answer differently, and so that a third surface
   * cannot be added that runs the matcher once and leaks.
   */
  async visibleDuplicatesFor(
    subject: Subject,
    inScope: (personId: string) => Promise<boolean>,
    /**
     * Which matches to describe. The lookup describes all of them; the creation
     * refusal describes only the ones it is refusing on, because section 3's
     * refusal asks the actor to acknowledge *those* — a payload also carrying
     * every Tier 2 near-miss is asking them to acknowledge something the refusal
     * is not about.
     *
     * The redaction is the same either way, which is the point of the filter
     * living here rather than at the call site.
     */
    only: (match: VisibleMatch) => boolean = () => true,
  ): Promise<Record<string, unknown>[]> {
    const [matches, publishable] = await Promise.all([
      this.findDuplicates(subject),
      this.findDuplicates({
        firstName: subject.firstName,
        middleName: subject.middleName,
        lastName: subject.lastName,
        sex: subject.sex,
        birthDate: null,
        mobileNumberNormalized: null,
      }),
    ]);

    // **`only` is not applied here, and that is the fix rather than a
    // refactor.** Applying it to `matches` — scored against the full subject —
    // decided *membership* from a tier the viewer may not be told. For the
    // creation refusal `only` is `tier === 1`, and every Tier 1 rule reads a
    // birthday or a mobile number, so an out-of-scope candidate appeared in the
    // payload exactly when their birthday equalled the one submitted. That is
    // the oracle section 3's three redaction rulings closed, reached a fourth
    // way: the fields were redacted and the membership was not.
    //
    // It is applied inside `visibleCandidates` instead, against the match the
    // viewer is entitled to — the full one in scope, the publishable one
    // otherwise.
    return visibleCandidates(
      matches,
      new Map(publishable.map((match) => [match.candidate.id, match])),
      inScope,
      only,
    );
  }

  async findDuplicates(subject: Subject): Promise<Match[]> {
    // The same guard the search path got, for the same reason and one function
    // away. `normalizeName` drops suffix tokens, so `last_name=Jr` normalizes to
    // empty and the surname-initial branch below becomes LIKE '%' -- which
    // selects the whole directory into memory to be scored, on every request.
    if (normalizeName(subject.lastName) === '' && normalizeName(subject.firstName) === '') {
      return [];
    }

    const mobile = subject.mobileNumberNormalized ?? normalizeMobile(null);

    let query = this.db
      .selectFrom('persons')
      .select([
        'id',
        'member_id',
        'first_name',
        'middle_name',
        'last_name',
        'birth_date',
        'sex',
        'mobile_number_normalized',
      ])
      // A Person absorbed by a merge is never a candidate: the survivor is the
      // only valid target of any later write (section 3, Person Merge).
      .where('merged_into_id', 'is', null);

    // Compared against the normalized stored value, not the raw one. `unaccent`
    // is an extension this schema does not install, so the normalization is done
    // with `translate` over the characters that actually occur in these names.
    const normalizedLastName = sql<string>`lower(translate(last_name, ${ACCENTED}, ${UNACCENTED}))`;
    const normalizedFirstName = sql<string>`lower(translate(first_name, ${ACCENTED}, ${UNACCENTED}))`;

    query = query.where((eb) =>
      eb.or([
        ...(subject.birthDate === null || subject.birthDate === undefined
          ? []
          : [eb('birth_date', '=', subject.birthDate)]),
        // Omitted entirely rather than degenerating to LIKE '%' when the surname
        // normalizes away.
        ...(normalizedFirstLetter(subject.lastName) === ''
          ? []
          : [
              eb(
                normalizedLastName,
                'like',
                `${escapeLike(normalizedFirstLetter(subject.lastName))}%`,
              ),
            ]),
        // The surname-change case: a woman's last name may change on marriage, so
        // a shared first name has to be able to reach her earlier record on its
        // own (section 3).
        eb(normalizedFirstName, '=', comparisonForm(subject.firstName)),
        ...(mobile === null ? [] : [eb('mobile_number_normalized', '=', mobile)]),
        // A birthday one digit-transposition away is not an equal birthday, so it
        // needs its own reach. Same length, same digits, different order.
        ...(subject.birthDate === null || subject.birthDate === undefined
          ? []
          : [eb('birth_date', 'in', transpositionsOf(subject.birthDate))]),
      ]),
    );

    const population = await query.execute();

    return findCandidates(
      subject,
      population.map((row): Candidate => ({
        id: row.id,
        memberId: row.member_id,
        firstName: row.first_name,
        middleName: row.middle_name,
        lastName: row.last_name,
        birthDate: row.birth_date,
        sex: row.sex,
        mobileNumberNormalized: row.mobile_number_normalized,
      })),
    );
  }
}

function normalizedFirstLetter(value: string): string {
  return (normalizeName(value)[0] ?? '').toLowerCase();
}

function comparisonForm(value: string): string {
  return normalizeName(value);
}

/**
 * What a predicate narrowing the list is allowed to see.
 *
 * **The tier and the identifier, and deliberately nothing else.** `Match` carries
 * the whole `Candidate`, birthday and mobile number included — the publishable
 * run strips those from the *subject*, never from the candidate — so a predicate
 * taking a `Match` could read a field section 8 protects and decide membership on
 * it, which is the defect this file exists to prevent, one caller out.
 *
 * Narrowed here rather than trusted to whoever writes the next predicate, on the
 * standard this project sets for `describeCandidate`'s required `inScope` and for
 * `completeWithin`'s transaction parameter: the one mistake available at the call
 * site is a compile error rather than an invisible one.
 */
interface VisibleMatch {
  tier: Match['tier'];
  candidateId: string;
}

/**
 * The candidates a caller may be shown — membership and order included.
 *
 * **Three separate redactions, and each was found only after the one before it
 * had been closed** (section 3). Every time by the same mistake: reasoning about
 * what the response contained rather than what it was a function of. The fields
 * were redacted and the tier still answered; the tier was withheld and membership
 * still answered; membership was scoped and the `only` filter and the ordering
 * still answered.
 *
 * *Which candidates appear.* A candidate outside the viewer's pastoral scope is
 * surfaced only if they would **still** have matched a subject carrying nothing
 * section 8 protects — no birthday, no mobile number. `publishableById` is that
 * second run of the matcher, keyed by candidate so the match itself is available
 * and not merely the fact of it — membership out of scope, and every later
 * decision about a withheld candidate, is therefore a function of the names and
 * sex alone.
 *
 * This is why **membership is itself the disclosure**: with a first name that
 * matches nothing, "this person is in the result" is exactly "their birthday
 * equals the value I submitted", answered 200 either way and writing nothing.
 * Redacting fields on a returned candidate cannot close that, which is what the
 * first two attempts did.
 *
 * It is a second run rather than a flag on the rule that fired, and that
 * distinction cost a CI round. A candidate matching on *both* the names and the
 * birthday is classified by the stronger rule, which reads a protected field — so
 * a flag hid people whose presence the names alone already explain, which is
 * backwards. What matters is not which rule won, but whether a publishable rule
 * would have matched at all.
 *
 * *What each candidate carries.* In scope, the tier and the reasons. Out of
 * scope, neither — the reasons name the field that matched, and the tier is
 * derived from which rule fired, so with an equal name Tier 1 means the birthday
 * matched and Tier 2 means it did not.
 *
 * The cost is real and is accepted (`SKILL.md` section 3): a cross-branch
 * duplicate whose surname changed on marriage is no longer surfaced to a leader
 * outside that branch, because that rule reads a birthday.
 *
 * *In what order they appear.* In scope first, strongest match first. Withheld
 * candidates follow in name order, because strongest-first is itself the tier and
 * a position beside a candidate whose tier is shown reads the withheld one back.
 *
 * One function, used by every surface that returns candidates, so the pre-flight
 * lookup and the creation refusal cannot answer differently — and `only` is
 * applied here rather than by a caller because a filter on the tier is a
 * membership decision, which section 3 requires be taken on the match the viewer
 * is entitled to. The predicate is handed a `VisibleMatch` so it cannot be
 * written against anything else.
 */
async function visibleCandidates(
  matches: readonly Match[],
  publishableById: ReadonlyMap<string, Match>,
  inScope: (personId: string) => Promise<boolean>,
  only: (match: VisibleMatch) => boolean,
): Promise<Record<string, unknown>[]> {
  const kept: { match: Match; withinScope: boolean }[] = [];

  for (const match of matches) {
    const withinScope = await inScope(match.candidate.id);
    const publishable = publishableById.get(match.candidate.id);

    if (!withinScope && !publishable) {
      continue;
    }

    // **The predicate reads what the caller may be told, not what the matcher
    // knows.** In scope that is the full match. Out of scope it is the
    // publishable one — scored without the birthday and the mobile number — so
    // no decision about whether this candidate appears can vary with a field
    // section 8 protects.
    //
    // A consequence worth stating rather than discovering: no publishable match
    // is ever Tier 1, because every Tier 1 rule reads one of those two fields. So
    // an out-of-scope candidate never appears in the creation refusal at all.
    //
    // That is a *new* rule rather than a restatement of the 2026-08-23 one.
    // Gating and appearing in the body are different decisions: the gate has
    // always been in-scope-only, because `people.service.ts` pairs its tier test
    // with `canSeeReasons`, and that ruling argues the status varying between 409
    // and 201. What leaked was the payload of a refusal that had already fired
    // correctly.
    if (!only(visibleForm(withinScope ? match : publishable!))) {
      continue;
    }

    kept.push({ match, withinScope });
  }

  // **Order discloses nothing.** `findCandidates` returns tier-sorted, and a
  // withheld candidate's tier is withheld precisely because it is derived from
  // which rule fired — so position beside a candidate whose tier *is* shown
  // reads the withheld one back. In-scope candidates keep their tier order,
  // which is what makes the strongest match easiest to see; out-of-scope ones
  // follow, in name order, which is a function of nothing section 8 protects.
  const inScopeFirst = kept.filter((entry) => entry.withinScope);
  const withheld = kept
    .filter((entry) => !entry.withinScope)
    .sort((a, b) => compareOrderKeys(orderKeyOf(a.match), orderKeyOf(b.match)));

  return [...inScopeFirst, ...withheld].map((entry) =>
    describeCandidate(entry.match, entry.withinScope),
  );
}

/**
 * The order key for a withheld candidate: their full name, then their Member ID.
 *
 * **Total, which is the property the rule needs and a name alone does not have.**
 * A withheld candidate is publishable, which requires an equal first *and* last
 * name — so every withheld candidate in one response already shares a name with
 * the others, and two carrying no middle name share the whole of it. A comparator
 * returning 0 there leaves `Array.prototype.sort`'s stability to decide, and what
 * it preserves is `findCandidates`'s tier order: position reads the withheld tier
 * back, which is exactly the channel the ordering rule closes. Section 3 states
 * the tie-break for that reason.
 *
 * Both components are things section 8 already publishes to a viewer outside the
 * scope — the full name and the Member ID are two of the five fields it lists —
 * so the order remains a function of nothing protected. The Member ID also
 * encodes nothing and is unique (section 3), which is what makes the key total.
 *
 * The name is `fullNameOf`, the same function `describeCandidate` composes the
 * returned `full_name` with, so the key cannot drift from the name the viewer is
 * actually shown — the argument for this ordering rests on their being the same
 * string.
 */
function orderKeyOf(match: Match): [string, string] {
  // `normalizeName`, which is the form section 3 defines for comparison:
  // casefolded, diacritics stripped, hyphens and apostrophes treated as
  // separators, spacing collapsed, and the suffixes Jr, Sr, II and III dropped.
  // Not `comparisonKey`, which removes spacing entirely — that one exists to
  // decide name *equality* for matching, and is a stronger collapse than an
  // ordering needs.
  //
  // Suffix stripping is a second tie generator beside a shared name with no
  // middle name: `Pedro Cruz Jr` and `Pedro Cruz Sr` are distinct published names
  // that collide here. Every such tie is resolved by the Member ID below, which
  // is why the key has to be total rather than merely usually distinct.
  //
  // Codepoint order rather than `localeCompare`, which with no locale resolves
  // against the host's default — so two API instances could order the same
  // two names differently, and section 22 makes this ordering client-visible and
  // `/api/v1` additive-only.
  return [normalizeName(fullNameOf(match.candidate)), match.candidate.memberId];
}

function compareOrderKeys(a: [string, string], b: [string, string]): number {
  if (a[0] !== b[0]) {
    return a[0] < b[0] ? -1 : 1;
  }

  if (a[1] === b[1]) {
    return 0;
  }

  return a[1] < b[1] ? -1 : 1;
}

function visibleForm(match: Match): VisibleMatch {
  return { tier: match.tier, candidateId: match.candidate.id };
}

/**
 * A candidate as the caller may see it.
 *
 * `inScope` is required rather than defaulting to true. A default that discloses
 * means a call site which forgets it leaks and still compiles — the wrong
 * direction for a rule about what the church may see, and the same argument this
 * project made for `completeWithin` taking a transaction rather than the pool.
 *
 * It is false for a candidate outside the viewer's pastoral scope, and
 * then **neither the tier nor the reasons travel**.
 *
 * Withholding only the reasons was not enough, and the reason it was not is worth
 * stating. The tier is derived from which rule matched: with the same first and
 * last name, Tier 1 means the birthday was equal and Tier 2 means it was not. So
 * a tier returned church-wide is a yes/no birthday oracle over a name section 8
 * already makes visible — enumerable, answered 200 every time, writing nothing.
 * The wording was hidden and the information kept.
 *
 * What an out-of-scope candidate carries instead is that they are a possible
 * match. That is what section 3 needs the encoder to know: somebody may already
 * be recorded, ask the leader who holds them. It is not what a caller can binary
 * search on.
 */
function describeCandidate(match: Match, inScope: boolean): Record<string, unknown> {
  const identity = {
    id: match.candidate.id,
    member_id: match.candidate.memberId,
    full_name: fullNameOf(match.candidate),
    sex: match.candidate.sex,
  };

  return inScope
    ? { ...identity, tier: match.tier, reasons: match.reasons }
    : { ...identity, possible_match: true };
}
