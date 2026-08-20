import { Injectable } from '@nestjs/common';
import { Algorithm, hash, verify } from '@node-rs/argon2';

/**
 * Argon2id, as SKILL.md section 24 requires.
 *
 * Verification is deliberately constant in shape: a sign-in against an account
 * that does not exist, or one that has no password yet, still performs a hash
 * comparison, so response timing does not disclose which accounts exist.
 */
@Injectable()
export class PasswordService {
  /** A hash of a value nothing will ever match, used to keep timing even. */
  private readonly decoyHash = hash('a value no password equals', OPTIONS);

  async hash(password: string): Promise<string> {
    return hash(password, OPTIONS);
  }

  async verify(passwordHash: string | null, password: string): Promise<boolean> {
    if (passwordHash === null) {
      await verify(await this.decoyHash, password, OPTIONS).catch(() => false);
      return false;
    }

    try {
      return await verify(passwordHash, password, OPTIONS);
    } catch {
      return false;
    }
  }
}

/**
 * OWASP's Argon2id baseline: 19 MiB of memory, two iterations, one degree of
 * parallelism.
 */
const OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;
