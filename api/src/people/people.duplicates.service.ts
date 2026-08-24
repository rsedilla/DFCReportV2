import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import { DATABASE, type Db } from '../database/database.module';

import {
  findCandidates,
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
 * three times already, and because two surfaces need it: the pre-flight lookup
 * that shows Tier 2 candidates, and creation, which can only ever refuse on Tier
 * 1. Both go through here so a third caller cannot be added that runs the matcher
 * once and leaks.
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
   * The candidates a viewer may be shown, membership and fields both redacted.
   *
   * Runs the matcher twice: once on the subject as given, and once on a subject
   * stripped of everything section 8 protects. The second run decides which
   * out-of-scope candidates may appear at all — see `visibleCandidates`.
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
    only: (match: Match) => boolean = () => true,
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

    return visibleCandidates(
      matches.filter(only),
      new Set(publishable.map((match) => match.candidate.id)),
      inScope,
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
 * The candidates a caller may be shown, membership included.
 *
 * **Two separate redactions, and the first is the one that took three attempts.**
 *
 * *Which candidates appear.* A candidate outside the viewer's pastoral scope is
 * surfaced only if they would **still** have matched a subject carrying nothing
 * section 8 protects — no birthday, no mobile number. `publishableIds` is that
 * second run of the matcher, and membership out of scope is therefore a function
 * of the names and sex alone.
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
 * One function, used by every surface that returns candidates, so the pre-flight
 * lookup and the creation refusal cannot answer differently.
 */
async function visibleCandidates(
  matches: readonly Match[],
  publishableIds: ReadonlySet<string>,
  inScope: (personId: string) => Promise<boolean>,
): Promise<Record<string, unknown>[]> {
  const visible: Record<string, unknown>[] = [];

  for (const match of matches) {
    const withinScope = await inScope(match.candidate.id);

    if (!withinScope && !publishableIds.has(match.candidate.id)) {
      continue;
    }

    visible.push(describeCandidate(match, withinScope));
  }

  return visible;
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
    full_name: [match.candidate.firstName, match.candidate.middleName, match.candidate.lastName]
      .filter((part) => part !== null && part !== '')
      .join(' '),
    sex: match.candidate.sex,
  };

  return inScope
    ? { ...identity, tier: match.tier, reasons: match.reasons }
    : { ...identity, possible_match: true };
}
