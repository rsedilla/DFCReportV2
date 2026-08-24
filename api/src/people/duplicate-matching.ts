/**
 * Duplicate candidate matching (SKILL.md section 3, Matching rules).
 *
 * Two rules bound everything here, and both are about restraint rather than
 * accuracy. **The system never merges automatically, and never blocks creation.**
 * It surfaces candidates and a person decides. A matcher that blocks gets worked
 * around by staff inventing spellings, which produces the duplicates it was meant
 * to prevent.
 *
 * Pure functions over already-fetched rows, deliberately. The scoring is the part
 * worth testing exhaustively, and it needs no database to do it.
 */

/** Section 3: Tier 1 is acknowledged before creation; Tier 2 is shown in a list. */
export type Tier = 1 | 2;

export interface Candidate {
  id: string;
  memberId: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  birthDate: string | null;
  sex: 'MALE' | 'FEMALE';
  mobileNumberNormalized: string | null;
}

export interface Subject {
  firstName: string;
  middleName?: string | null;
  lastName: string;
  birthDate?: string | null;
  sex?: 'MALE' | 'FEMALE';
  mobileNumberNormalized?: string | null;
}

export interface Match {
  candidate: Candidate;
  tier: Tier;
  /** Why this candidate surfaced, for the log section 3 asks be kept. */
  reasons: string[];
}

/**
 * A note on what is deliberately *not* here.
 *
 * A `restsOnProtectedField` flag lived on `Match` for one commit, set by whichever
 * rule fired, to decide which out-of-scope candidates section 8 permits
 * surfacing. It was wrong: a candidate matching on both their names and their
 * birthday is classified by the stronger rule, which reads the birthday, so the
 * flag hid people whose presence the names alone already explained.
 *
 * That question is answered by running this matcher a second time against a
 * subject carrying nothing section 8 protects, and asking whether the candidate
 * still appears — see `PeopleDuplicatesService.visibleDuplicatesFor`. The property is
 * "would a publishable rule have matched", not "which rule won", and only the
 * second run expresses it.
 */

/**
 * Section 3 closes with: "Thresholds and edit distances must be calibrated
 * against real data rather than fixed here."
 *
 * So they are settings rather than constants, and these are starting values, not
 * findings. The real leadership tree arrives with the Stage 2 import
 * (`docs/ROADMAP.md`), and section 3 asks that the candidates shown and what the
 * user chose be logged so the rules can be revisited against what the matcher is
 * missing and what it is over-reporting.
 */
export interface MatchingThresholds {
  /** Edit distance within which two first names are "a small edit distance" apart. */
  firstNameEditDistance: number;
  /** Whole-name similarity, 0 to 1, at which a Tier 2 candidate surfaces. */
  wholeNameSimilarity: number;
}

export const DEFAULT_THRESHOLDS: MatchingThresholds = {
  firstNameEditDistance: 1,
  wholeNameSimilarity: 0.85,
};

/**
 * Nickname variants, which section 3 names as a Tier 1 signal beside edit
 * distance. Deliberately short and local: a general nickname corpus imported
 * wholesale would surface candidates nobody in this church would recognise as
 * related, and section 3 warns against over-reporting as much as under-.
 *
 * Each line is a set of names that refer to one another in either direction.
 */
const NICKNAMES: readonly (readonly string[])[] = [
  ['jose', 'joseph', 'joey', 'pepe'],
  ['juan', 'john', 'johnny'],
  ['maria', 'mary', 'marie'],
  ['jesus', 'jess'],
  ['francisco', 'frank', 'kiko'],
  ['antonio', 'tony'],
  ['ricardo', 'ric', 'rick'],
  ['roberto', 'bert', 'bobby'],
  ['eduardo', 'ed', 'eddie'],
  ['manuel', 'manny'],
  ['raymond', 'ray'],
  ['margarita', 'margie'],
  ['teresa', 'tess'],
  ['catherine', 'cathy', 'kate'],
  ['elizabeth', 'beth', 'liza'],
];

/**
 * The suffixes section 3 names, and only those: "Ignore the suffixes Jr, Sr, II,
 * III when comparing, and compare them separately as a weak distinguishing
 * signal." `IV` was here and is not on that list — a closed list in the
 * specification is not a starting point to extend.
 */
const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii']);

/**
 * **Normalize for comparison only. Never alter the stored values** (section 3).
 *
 * Casefold, trim, collapse internal whitespace, strip diacritics, and treat
 * hyphens and apostrophes as separators. Whitespace carries unusual weight:
 * `Dela Cruz`, `DelaCruz` and `de la Cruz` are one surname, and treating them as
 * three is the commonest way a duplicate gets created — so the comparison form
 * removes spacing entirely rather than merely collapsing it.
 */
export function normalizeName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[-'’]/g, ' ')
    .split(/\s+/)
    .filter((part) => part !== '' && !SUFFIXES.has(part))
    .join(' ')
    .trim();
}

/** The same, with spacing removed, which is what makes `Dela Cruz` meet `DelaCruz`. */
function comparisonKey(value: string): string {
  return normalizeName(value).replace(/\s+/g, '');
}

function suffixOf(value: string): string | null {
  const parts = value.toLowerCase().replace(/[.,]/g, '').split(/\s+/);
  return parts.find((part) => SUFFIXES.has(part)) ?? null;
}

function areNicknames(a: string, b: string): boolean {
  return NICKNAMES.some((set) => set.includes(a) && set.includes(b));
}

/**
 * Edit distance counting a transposition as one edit, not two.
 *
 * Damerau-Levenshtein (the optimal string alignment form), chosen deliberately
 * over plain Levenshtein. `Jaun` for `Juan` is the commonest way a name is
 * mistyped, and under Levenshtein it is two substitutions — far enough away to
 * fall out of Tier 1 and be shown as merely possible, which is the wrong answer
 * for the most likely typo there is.
 *
 * Section 3 does not name a metric, but it does treat transposition as a signal
 * worth catching: it lists "birthdays differing by a transposition of digits" as
 * Tier 2. Applying the same idea to names follows the specification's own concern
 * rather than departing from it.
 *
 * The names here are short, so the quadratic cost is irrelevant.
 */
export function editDistance(a: string, b: string): number {
  if (a === b) {
    return 0;
  }

  const rows: number[][] = [Array.from({ length: b.length + 1 }, (_, j) => j)];

  for (let i = 1; i <= a.length; i += 1) {
    rows[i] = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;

      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);

      // The transposition case: the two characters are swapped.
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
      }
    }
  }

  return rows[a.length][b.length];
}

/** 0 to 1, from edit distance over the longer string. */
function similarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  return longest === 0 ? 1 : 1 - editDistance(a, b) / longest;
}

/** Whether two birthdays differ only by a transposition of digits (section 3). */
function isDigitTransposition(a: string, b: string): boolean {
  if (a === b || a.length !== b.length) {
    return false;
  }

  const differing: number[] = [];
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      differing.push(i);
    }
  }

  return (
    differing.length === 2 &&
    a[differing[0]] === b[differing[1]] &&
    a[differing[1]] === b[differing[0]]
  );
}

/**
 * Candidates for a subject, strongest first.
 *
 * Section 3's rules, in the order it gives them. Nothing here excludes a
 * candidate on sex alone or on a mobile number alone, both of which it forbids.
 */
export function findCandidates(
  subject: Subject,
  population: readonly Candidate[],
  thresholds: MatchingThresholds = DEFAULT_THRESHOLDS,
): Match[] {
  const first = comparisonKey(subject.firstName);
  const last = comparisonKey(subject.lastName);
  const firstWords = normalizeName(subject.firstName);
  const whole = comparisonKey(`${subject.firstName} ${subject.lastName}`);
  const birth = subject.birthDate ?? null;
  const mobile = subject.mobileNumberNormalized ?? null;
  const suffix = suffixOf(subject.firstName) ?? suffixOf(subject.lastName);

  const matches: Match[] = [];

  for (const candidate of population) {
    const cFirst = comparisonKey(candidate.firstName);
    const cLast = comparisonKey(candidate.lastName);
    const cFirstWords = normalizeName(candidate.firstName);
    const cWhole = comparisonKey(`${candidate.firstName} ${candidate.lastName}`);
    const cBirth = candidate.birthDate;

    const sameBirth = birth !== null && cBirth !== null && birth === cBirth;
    const sameFirst = first === cFirst;
    const sameLast = last === cLast;
    const nickname = areNicknames(firstWords, cFirstWords);
    const closeFirst = editDistance(first, cFirst) <= thresholds.firstNameEditDistance;
    const sameMobile = mobile !== null && candidate.mobileNumberNormalized === mobile;

    const reasons: string[] = [];
    let tier: Tier | null = null;

    // --- Tier 1 -----------------------------------------------------------
    if (sameBirth && sameLast && sameFirst) {
      tier = 1;
      reasons.push('same birthday, and first and last names equal');
    } else if (sameBirth && sameLast && (nickname || closeFirst)) {
      tier = 1;
      reasons.push(
        nickname
          ? 'same birthday, last name equal, first name a known nickname variant'
          : 'same birthday, last name equal, first name within a small edit distance',
      );
    } else if (sameMobile && sameFirst && sameLast) {
      // A number is a strong signal and never sufficient alone (section 3).
      tier = 1;
      reasons.push('same mobile number, and first and last names equal');
    }

    // --- Tier 2 -----------------------------------------------------------
    if (tier === null) {
      if (sameBirth && sameLast) {
        tier = 2;
        reasons.push('same birthday and last name equal');
      } else if (sameFirst && sameLast) {
        // Birthday differs or is absent. Section 3 lists this as Tier 2 rather
        // than excluding it, because a birthday is frequently mis-keyed.
        tier = 2;
        reasons.push('first and last names equal, birthday differs or is absent');
      } else if (
        birth !== null &&
        cBirth !== null &&
        isDigitTransposition(birth, cBirth) &&
        similarity(whole, cWhole) >= thresholds.wholeNameSimilarity
      ) {
        tier = 2;
        reasons.push('names closely similar, birthdays differing by a transposition of digits');
      } else if (sameBirth && sameFirst) {
        // "A woman's last name may change on marriage… Do not require surname
        // equality" (section 3).
        tier = 2;
        reasons.push('same birthday and first name equal, last name differs');
      } else if (sameMobile && sameLast) {
        tier = 2;
        reasons.push('same mobile number and last name equal');
      }
    }

    if (tier === null) {
      continue;
    }

    // Sex is a supporting signal: a mismatch lowers confidence and never
    // excludes, because it is a frequently mis-keyed field (section 3).
    //
    // **It annotates and does not demote.** Section 3's Tier 1 conditions carry
    // no sex term, and demoting on a mismatch would remove the acknowledgement
    // gate from exactly the candidates most likely to be the same person with a
    // typo -- someone with the same name and the same birthday whose sex was
    // mis-keyed. The reason travels with the candidate so the person deciding
    // sees the discrepancy and weighs it.
    if (subject.sex !== undefined && subject.sex !== candidate.sex) {
      reasons.push('sex differs, which lowers confidence but does not exclude');
    }

    // A suffix is a weak distinguishing signal, compared separately (section 3).
    // Annotated rather than demoted, for the same reason as sex: `Jr` against
    // `Sr` is a real distinction, but a suffix is also frequently omitted or
    // mistyped, and the person deciding is better placed to weigh it than a tier
    // boundary is.
    const candidateSuffix = suffixOf(candidate.firstName) ?? suffixOf(candidate.lastName);
    if (suffix !== null && candidateSuffix !== null && suffix !== candidateSuffix) {
      reasons.push(`suffixes differ (${suffix} against ${candidateSuffix})`);
    }

    matches.push({ candidate, tier, reasons });
  }

  return matches.sort((a, b) => a.tier - b.tier);
}
