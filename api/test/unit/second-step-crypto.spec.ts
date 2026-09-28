import { randomBytes } from 'node:crypto';

import {
  codeForStep,
  decryptSecret,
  encryptSecret,
  generateRecoveryCodes,
  generateSecret,
  hashRecoveryCode,
  matchingStep,
  otpauthUri,
  stepAt,
} from '../../src/auth/second-step.crypto';

/**
 * The arithmetic of the second sign-in step (SKILL.md section 6, decision 0302), checked
 * against RFC 6238's own test vectors, so that a code an authenticator app shows is the
 * code this server accepts.
 */
describe('second sign-in step arithmetic', () => {
  // RFC 6238 appendix B: the ASCII secret "12345678901234567890" (SHA-1), in base32.
  const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

  it.each([
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
  ])('matches RFC 6238 at T=%i', (seconds, code) => {
    // The RFC lists eight digits; an app shows the last six.
    expect(codeForStep(RFC_SECRET, stepAt(new Date(seconds * 1000)))).toBe(code);
  });

  it('accepts one step either side of now and nothing wider', () => {
    const now = new Date('2026-09-28T04:00:10Z');
    const current = stepAt(now);

    for (const offset of [-1, 0, 1]) {
      expect(matchingStep(RFC_SECRET, codeForStep(RFC_SECRET, current + offset), now)).toBe(
        current + offset,
      );
    }
    for (const offset of [-2, 2]) {
      expect(matchingStep(RFC_SECRET, codeForStep(RFC_SECRET, current + offset), now)).toBeNull();
    }
  });

  it('refuses anything that is not six digits, and forgives spaces', () => {
    const now = new Date();
    const code = codeForStep(RFC_SECRET, stepAt(now));

    expect(matchingStep(RFC_SECRET, `${code.slice(0, 3)} ${code.slice(3)}`, now)).toBe(stepAt(now));
    expect(matchingStep(RFC_SECRET, '12345', now)).toBeNull();
    expect(matchingStep(RFC_SECRET, 'abcdef', now)).toBeNull();
  });

  it('encrypts the secret so the stored value neither contains nor yields it without the key', () => {
    const key = randomBytes(32);
    const secret = generateSecret();
    const stored = encryptSecret(secret, key);

    expect(stored.startsWith('v1.')).toBe(true);
    expect(stored).not.toContain(secret);
    expect(decryptSecret(stored, key)).toBe(secret);
    expect(() => decryptSecret(stored, randomBytes(32))).toThrow();
  });

  it('issues ten distinct recovery codes, compared without case, spaces or the dash', () => {
    const codes = generateRecoveryCodes();
    const key = randomBytes(32);

    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) {
      expect(code).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}$/);
      expect(hashRecoveryCode(code.toUpperCase().replace('-', ' '), key)).toBe(
        hashRecoveryCode(code, key),
      );
      // Keyed: without the key, the stored value cannot be matched by hashing guesses.
      expect(hashRecoveryCode(code, randomBytes(32))).not.toBe(hashRecoveryCode(code, key));
    }
  });

  it('names the account and the church in what an app scans', () => {
    const uri = otpauthUri('JBSWY3DPEHPK3PXP', 'someone@example.test');

    expect(uri.startsWith('otpauth://totp/DFC%20Report%3Asomeone%40example.test?')).toBe(true);
    expect(new URL(uri).searchParams.get('secret')).toBe('JBSWY3DPEHPK3PXP');
  });
});
