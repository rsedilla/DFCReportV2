import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

/**
 * The arithmetic of the second sign-in step (SKILL.md section 6, decision 0302), kept
 * apart from the service so that it can be tested without a database.
 *
 * Written against Node's own `crypto` rather than a library: RFC 6238 is thirty lines,
 * and a dependency here would be one more package with a say in who signs in.
 */

/** RFC 6238's defaults, which every authenticator app assumes: SHA-1, 30 s, 6 digits. */
export const TOTP_PERIOD_SECONDS = 30;
const TOTP_DIGITS = 6;

/**
 * One step either side of now. A phone's clock drifts and a person takes a few seconds
 * to type, so an exact match would refuse a correct code; wider would let a stale code in.
 */
const TOTP_WINDOW_STEPS = 1;

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** A new secret: 20 random bytes, the length RFC 4226 recommends for SHA-1. */
export function generateSecret(): string {
  return base32Encode(randomBytes(20));
}

/** The time step a moment falls in. */
export function stepAt(now: Date): number {
  return Math.floor(now.getTime() / 1000 / TOTP_PERIOD_SECONDS);
}

/** The code an app shows for a step (RFC 4226's HOTP over the step counter). */
export function codeForStep(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));

  const digest = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;

  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0');
}

/**
 * The step a code matches within the window, or null. The caller records the step, so
 * that a code already used is refused (section 6).
 *
 * Every step in the window is computed and compared, whatever matches first, so that
 * the time taken says nothing about which step matched.
 */
export function matchingStep(secret: string, code: string, now: Date): number | null {
  const typed = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(typed)) {
    return null;
  }

  const current = stepAt(now);
  let matched: number | null = null;

  for (let step = current - TOTP_WINDOW_STEPS; step <= current + TOTP_WINDOW_STEPS; step += 1) {
    if (constantTimeEqual(codeForStep(secret, step), typed) && matched === null) {
      matched = step;
    }
  }

  return matched;
}

/** What an authenticator app scans: `otpauth://totp/...` (Google's key-URI format). */
export function otpauthUri(secret: string, accountEmail: string): string {
  const issuer = 'DFC Report';
  const label = encodeURIComponent(`${issuer}:${accountEmail}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });

  return `otpauth://totp/${label}?${params.toString()}`;
}

/**
 * AES-256-GCM, as `v1.<iv>.<tag>.<ciphertext>` in base64url. The version names the
 * format so that a later key or cipher can be introduced beside this one.
 */
export function encryptSecret(secret: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);

  return ['v1', iv, cipher.getAuthTag(), ciphertext]
    .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
    .join('.');
}

/** Throws where the key is wrong or the value was altered: GCM authenticates it. */
export function decryptSecret(stored: string, key: Buffer): string {
  const [version, iv, tag, ciphertext] = stored.split('.');
  if (version !== 'v1' || !iv || !tag || !ciphertext) {
    throw new Error('Unrecognised second-step secret format.');
  }

  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

/**
 * Letters and digits a person can read back without confusing them: no 0/o, 1/l/i.
 */
const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export const RECOVERY_CODE_COUNT = 10;

/** Ten codes shaped `xxxx-xxxx`. */
export function generateRecoveryCodes(): string[] {
  return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    const bytes = randomBytes(8);
    const chars = [...bytes].map((byte) => RECOVERY_ALPHABET[byte % RECOVERY_ALPHABET.length]);
    return `${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`;
  });
}

/**
 * What a recovery code is stored and compared as. Case, spaces and the dash are
 * forgiven, since the code is read off paper and typed on a phone.
 *
 * **An HMAC under `SECOND_STEP_KEY`, not a bare hash.** Eight characters are few enough
 * that a plain SHA-256 is reversed from a copy of the database in minutes, which would
 * hand a backup the second factor the secret is encrypted to keep out of it.
 */
export function hashRecoveryCode(code: string, key: Buffer): string {
  const normalized = code.toLowerCase().replace(/[\s-]/g, '');
  return createHmac('sha256', key).update(normalized).digest('hex');
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) {
    difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return difference === 0;
}

function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=]/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error('Not a base32 secret.');
    }
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}
