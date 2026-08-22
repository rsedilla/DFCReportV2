import {
  findCandidates,
  normalizeName,
  type Candidate,
  type Subject,
} from '../../src/people/duplicate-matching';

/**
 * SKILL.md section 3, Matching rules.
 *
 * Two rules bound the rest and are asserted throughout: the system never merges
 * automatically, and never blocks creation. Everything here is about which
 * candidates are *surfaced*, and at which tier — nothing here refuses anything.
 *
 * Pure functions over fixed rows, so every rule in section 3 gets a case without
 * a database. Fixture names are invented (CLAUDE.md, Secrets).
 */

const BASE: Candidate = {
  id: 'candidate-1',
  memberId: 'M-000001',
  firstName: 'Juan',
  middleName: null,
  lastName: 'Dela Cruz',
  birthDate: '1985-06-15',
  sex: 'MALE',
  mobileNumberNormalized: null,
};

function subject(overrides: Partial<Subject> = {}): Subject {
  return {
    firstName: 'Juan',
    lastName: 'Dela Cruz',
    birthDate: '1985-06-15',
    sex: 'MALE',
    ...overrides,
  };
}

function tiersFor(s: Subject, population: Candidate[] = [BASE]): number[] {
  return findCandidates(s, population).map((match) => match.tier);
}

describe('normalizing for comparison (SKILL.md section 3)', () => {
  it('collapses the spacing that makes Dela Cruz and DelaCruz look different', () => {
    // Section 3 gives this unusual weight: it is "the most common way a duplicate
    // is created". All three spellings must meet.
    const spellings = ['Dela Cruz', 'DelaCruz', 'de la Cruz', 'DELA  CRUZ'];
    const matched = spellings.map((lastName) =>
      tiersFor(subject({ lastName }), [{ ...BASE, lastName: 'Dela Cruz' }]),
    );

    expect(matched).toEqual([[1], [1], [1], [1]]);
  });

  it('strips diacritics and casefolds', () => {
    expect(normalizeName('José')).toBe('jose');
    expect(normalizeName('  ÑOÑO  ')).toBe('nono');
  });

  it('treats hyphens and apostrophes as separators', () => {
    expect(normalizeName("O'Brien")).toBe('o brien');
    expect(normalizeName('Smith-Jones')).toBe('smith jones');
  });

  it('ignores the suffixes section 3 names', () => {
    expect(normalizeName('Juan Jr')).toBe('juan');
    expect(normalizeName('Jose III')).toBe('jose');
  });
});

describe('Tier 1 — very likely the same person', () => {
  it('matches on same birthday with first and last names equal', () => {
    expect(tiersFor(subject())).toEqual([1]);
  });

  it('matches a known nickname variant on the same birthday and last name', () => {
    expect(tiersFor(subject({ firstName: 'Johnny' }))).toEqual([1]);
  });

  it('matches a first name within a small edit distance', () => {
    expect(tiersFor(subject({ firstName: 'Jaun' }))).toEqual([1]);
  });

  it('matches a mobile number with first and last names equal', () => {
    // A number is a strong signal. Never sufficient alone — see below.
    expect(
      tiersFor(subject({ birthDate: '1990-01-01', mobileNumberNormalized: '09171234567' }), [
        { ...BASE, mobileNumberNormalized: '09171234567' },
      ]),
    ).toEqual([1]);
  });
});

describe('Tier 2 — possible', () => {
  it('surfaces same birthday and last name where the first name differs', () => {
    expect(tiersFor(subject({ firstName: 'Pedro' }))).toEqual([2]);
  });

  it('surfaces first and last names equal where the birthday differs', () => {
    expect(tiersFor(subject({ birthDate: '1990-01-01' }))).toEqual([2]);
  });

  it('surfaces first and last names equal where the birthday is absent', () => {
    expect(tiersFor(subject({ birthDate: null }))).toEqual([2]);
  });

  it('surfaces a birthday differing by a transposition of digits', () => {
    // The names must be similar but *unequal*. With equal names the earlier rule
    // -- "first and last names equal, birthday differs or is absent" -- fires
    // first and returns tier 2 on its own, so the case would pass with the
    // transposition rule deleted entirely. It did, until this was rewritten.
    const matches = findCandidates(subject({ firstName: 'Jaun', birthDate: '1985-06-51' }), [
      { ...BASE, firstName: 'Juan', birthDate: '1985-06-15' },
    ]);

    expect(matches.map((match) => match.tier)).toEqual([2]);
    expect(matches[0].reasons.join(' ')).toMatch(/transposition of digits/);
  });

  it('keeps birthday and first name as a signal when the surname changed', () => {
    // "A woman's last name may change on marriage… Do not require surname
    // equality." A married woman must still meet her own earlier record.
    const maidenName: Candidate = {
      ...BASE,
      firstName: 'Maria',
      lastName: 'Santos',
      sex: 'FEMALE',
    };

    expect(
      tiersFor(subject({ firstName: 'Maria', lastName: 'Reyes', sex: 'FEMALE' }), [maidenName]),
    ).toEqual([2]);
  });
});

describe('what never matches on its own (SKILL.md section 3)', () => {
  it('does not match a common surname alone', () => {
    expect(tiersFor(subject({ firstName: 'Pedro', birthDate: '1990-01-01' }))).toEqual([]);
  });

  it('does not match a first name alone', () => {
    expect(tiersFor(subject({ lastName: 'Santos', birthDate: '1990-01-01' }))).toEqual([]);
  });

  it('does not match a mobile number alone', () => {
    // Households share numbers, and a minor is commonly recorded with a parent's.
    expect(
      tiersFor(
        subject({
          firstName: 'Pedro',
          lastName: 'Santos',
          birthDate: '1990-01-01',
          mobileNumberNormalized: '09171234567',
        }),
        [{ ...BASE, mobileNumberNormalized: '09171234567' }],
      ),
    ).toEqual([]);
  });

  it('does not match on sex alone', () => {
    expect(
      tiersFor(subject({ firstName: 'Pedro', lastName: 'Santos', birthDate: '1990-01-01' }), [
        BASE,
      ]),
    ).toEqual([]);
  });
});

describe('signals that weaken without excluding', () => {
  it('lowers a sex mismatch a tier rather than dropping the candidate', () => {
    // Section 3: sex "is a frequently mis-keyed field", so a mismatch lowers
    // confidence and never excludes.
    const matches = findCandidates(subject({ sex: 'FEMALE' }), [BASE]);

    expect(matches).toHaveLength(1);
    expect(matches[0].tier).toBe(2);
    expect(matches[0].reasons.join(' ')).toMatch(/sex differs/);
  });

  it('lowers a suffix mismatch a tier rather than dropping the candidate', () => {
    const matches = findCandidates(subject({ firstName: 'Juan Jr' }), [
      { ...BASE, firstName: 'Juan Sr' },
    ]);

    expect(matches).toHaveLength(1);
    expect(matches[0].tier).toBe(2);
    expect(matches[0].reasons.join(' ')).toMatch(/suffixes differ/);
  });

  it('never counts an absent middle name against a match', () => {
    // It is optional and frequently left blank (section 3).
    const withMiddle = findCandidates(subject(), [{ ...BASE, middleName: 'Santos' }]);
    const withoutMiddle = findCandidates(subject(), [{ ...BASE, middleName: null }]);

    expect(withMiddle.map((m) => m.tier)).toEqual(withoutMiddle.map((m) => m.tier));
  });
});

describe('what the caller is told', () => {
  it('gives a reason for every candidate, which section 3 asks be logged', () => {
    const matches = findCandidates(subject(), [BASE]);

    expect(matches[0].reasons.length).toBeGreaterThan(0);
  });

  it('orders the strongest candidates first', () => {
    const alsoTier2: Candidate = {
      ...BASE,
      id: 'candidate-2',
      firstName: 'Pedro',
      memberId: 'M-000002',
    };

    expect(tiersFor(subject(), [alsoTier2, BASE])).toEqual([1, 2]);
  });
});
