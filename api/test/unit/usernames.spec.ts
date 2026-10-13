import { USERNAME_PATTERN, usernameBase } from '../../src/auth/usernames';

/** The suggestion's rules (SKILL.md section 6, decision 0337). Invented names. */
describe('usernameBase (decision 0337)', () => {
  const base = (firstName: string, middleName: string | null, lastName: string) =>
    usernameBase({ firstName, middleName, lastName });

  it.each([
    ['initials and surname', 'Rogelio', 'Bayani', 'Santiago', 'rbsantiago'],
    ['no middle name', 'Rogelio', null, 'Santiago', 'rsantiago'],
    ['a two-word surname', 'Juan', 'Santos', 'Dela Cruz', 'jsdelacruz'],
    ['marks removed', 'Niño', null, 'Peña', 'npena'],
    ['a suffix left out', 'Pedro', 'Santos', 'Reyes Jr.', 'psreyes'],
    ['a roman-numeral suffix left out', 'Pedro', null, 'Reyes III', 'preyes'],
    ['a two-word first name gives one letter', 'Maria Theresa', null, 'Lim', 'mlim'],
    ['a hyphen and an apostrophe dropped', 'Ana', null, "O'Neil-Cruz", 'aoneilcruz'],
    ['a letter with no plain form dropped', 'Søren', null, 'Ærø', 'sr'],
  ])('%s', (_label, first, middle, last, expected) => {
    expect(base(first, middle, last)).toBe(expected);
  });

  it('starts with a letter when the name has none a to z', () => {
    expect(base('李', null, '王')).toBe('user');
  });

  it('is cut to 30', () => {
    const long = base('Ana', null, 'Abcdefghijklmnopqrstuvwxyzabcdefghij');
    expect(long).toHaveLength(30);
  });

  it('a full suggestion fits the shape', () => {
    expect(USERNAME_PATTERN.test(base('Rogelio', 'Bayani', 'Santiago'))).toBe(true);
  });
});
