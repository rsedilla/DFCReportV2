import { ApiErrorCode } from '../../src/common/errors/api-error';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  assertPasswordIsAcceptable,
} from '../../src/auth/credentials.service';

/**
 * What a password must be (SKILL.md section 6).
 *
 * Unit-tested because the rule is a pure function guarding three endpoints, and
 * because two of its properties are invisible end to end: a composition rule
 * creeping in would still let every e2e fixture password through, and a length
 * counted in UTF-16 units answers differently only for input no fixture uses.
 */
describe('what a password must be (section 6)', () => {
  function refusal(
    password: string,
  ): { code?: string; details?: Record<string, unknown> } | undefined {
    try {
      assertPasswordIsAcceptable(password);
      return undefined;
    } catch (error) {
      return error as { code?: string; details?: Record<string, unknown> };
    }
  }

  describe('length is the whole rule', () => {
    it('refuses one character below the minimum and accepts the minimum', () => {
      // The boundary, not a number either side of it: `<` relaxed to `<=`, or the
      // constant moved by one, has to fail here.
      expect(refusal('a'.repeat(PASSWORD_MIN_LENGTH - 1))?.code).toBe(
        ApiErrorCode.VALIDATION_FAILED,
      );
      expect(refusal('a'.repeat(PASSWORD_MIN_LENGTH))).toBeUndefined();
    });

    it('accepts the maximum and refuses one character above it', () => {
      expect(refusal('a'.repeat(PASSWORD_MAX_LENGTH))).toBeUndefined();
      expect(refusal('a'.repeat(PASSWORD_MAX_LENGTH + 1))?.code).toBe(
        ApiErrorCode.VALIDATION_FAILED,
      );
    });

    it('names the minimum in the refusal, so a client need not hard-code it', () => {
      expect(refusal('short')?.details).toMatchObject({
        field: 'password',
        min_length: PASSWORD_MIN_LENGTH,
      });
    });
  });

  describe('no composition rule, which is the part that could quietly acquire one', () => {
    it('accepts a long passphrase of nothing but lowercase letters and spaces', () => {
      // **The mutation this fails against** is somebody adding a "must contain a
      // digit" or "must contain a symbol" check. Section 23's criterion 3.3.8
      // permits a password because password managers assist in completing it, and
      // a composition rule pushes people toward something short enough to retype
      // from memory — against the mechanism conformance rests on.
      expect(refusal('correct horse battery staple')).toBeUndefined();
    });

    it('accepts twelve identical characters, which no complexity rule would', () => {
      expect(refusal('aaaaaaaaaaaa')).toBeUndefined();
    });

    it('accepts a password that is entirely digits, or entirely symbols', () => {
      expect(refusal('123456789012')).toBeUndefined();
      expect(refusal('!!!!!!!!!!!!')).toBeUndefined();
    });
  });

  describe('counted in code points, not UTF-16 units', () => {
    it('refuses a short passphrase padded out by astral characters', () => {
      // **Eleven code points, twenty-one UTF-16 units.** `String.length` would
      // accept this while refusing a plainer eleven-character password of the same
      // visible length, which is arbitrary from the holder's side — and it is
      // generous in the wrong direction, since the emoji are one guess each.
      const eleven = 'a' + '\u{1F600}'.repeat(10);

      expect([...eleven].length).toBe(11);
      expect(eleven.length).toBeGreaterThan(PASSWORD_MIN_LENGTH);
      expect(refusal(eleven)?.code).toBe(ApiErrorCode.VALIDATION_FAILED);
    });

    it('accepts twelve code points of astral characters', () => {
      expect(refusal('\u{1F600}'.repeat(12))).toBeUndefined();
    });

    it('refuses a maximum-length check that would pass on UTF-16 units', () => {
      // The same asymmetry at the other end: 128 astral code points are 256 units,
      // and counting units would refuse a password the rule permits.
      expect(refusal('\u{1F600}'.repeat(PASSWORD_MAX_LENGTH))).toBeUndefined();
    });
  });
});
