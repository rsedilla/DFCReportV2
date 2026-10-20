import { composeFullName, composeName, middleInitial } from '../../src/people/people.shared';

/**
 * How a name is shown (SKILL.md section 3, decisions 0271 and 0375): a list gives the middle
 * name's initial, and the person's own record gives it whole. Names are invented.
 */
describe('a displayed name (decision 0375)', () => {
  const person = (middle: string | null, title: string | null = null) => ({
    title,
    first_name: 'Juan',
    middle_name: middle,
    last_name: 'Dela Cruz',
  });

  it('shows the middle name as its initial in a list', () => {
    expect(composeName(person('Santos'))).toBe('Juan S. Dela Cruz');
  });

  it('keeps the middle name whole on the person’s own record', () => {
    expect(composeFullName(person('Santos'))).toBe('Juan Santos Dela Cruz');
  });

  it('puts a title first, as before', () => {
    expect(composeName(person('Santos', 'Pastor'))).toBe('Pastor Juan S. Dela Cruz');
  });

  it('leaves the initial out where there is no middle name', () => {
    expect(composeName(person(null))).toBe('Juan Dela Cruz');
    expect(composeName(person('   '))).toBe('Juan Dela Cruz');
  });

  it('gives one raised letter for a two-word or lower-case middle name', () => {
    expect(middleInitial('dela Rosa')).toBe('D.');
    expect(middleInitial('  ramos ')).toBe('R.');
  });

  it('keeps a middle name already entered as an initial as it is', () => {
    expect(middleInitial('S.')).toBe('S.');
    expect(middleInitial('S')).toBe('S.');
  });

  it('takes a whole character, not half of one', () => {
    expect(middleInitial('𝓐bad')).toBe('𝓐.');
  });
});
