import {
  checkDateStyle,
  DATE_STYLE,
  DATE_STYLE_OPTION,
  DateStyleError,
} from '../../src/database/date-style';

/**
 * The predicate on its own, which is worth separating from the connection cases: those
 * need a database, and this is the part that decides whether a deployment starts.
 *
 * No database server is needed, but the shared harness still throws without
 * `DATABASE_URL`, so a dummy value is enough — the same note `identifiers.spec.ts`
 * carries, for the same reason.
 */
describe('checkDateStyle (SKILL.md section 24)', () => {
  it('accepts exactly what the pool pins', () => {
    expect(() => checkDateStyle(DATE_STYLE)).not.toThrow();
  });

  it('refuses the three output styles that make the driver return null', () => {
    for (const style of ['German, DMY', 'SQL, MDY', 'Postgres, DMY']) {
      expect(() => checkDateStyle(style)).toThrow(DateStyleError);
    }
  });

  it('refuses an ISO style whose input half differs, because the pin sets both', () => {
    // Harmless in itself — every date this API sends is `YYYY-MM-DD` or a bound
    // parameter. It is refused because the pin sets both halves, so a difference in
    // either means the startup option did not arrive, and the next thing it would
    // silently not apply is the half that does matter.
    expect(() => checkDateStyle('ISO, DMY')).toThrow(DateStyleError);
  });

  it('names the reported value, so the message says what to look at', () => {
    expect(() => checkDateStyle('German, DMY')).toThrow(/German, DMY/);
  });

  it('pins both halves in the startup option it advertises', () => {
    // Weak by construction, and stated rather than left to look strong: it checks the
    // constant against itself. What makes the pin non-vacuous is the connection case
    // in `test/database/date-style.spec.ts`, which opens a real connection against a
    // hostile database default.
    expect(DATE_STYLE_OPTION).toBe(`-c DateStyle=${DATE_STYLE.replace(', ', ',')}`);
  });
});
