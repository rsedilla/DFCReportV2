/**
 * The proof a completed password reset answers with (SKILL.md section 6, decision 0413): for
 * fifteen minutes it lets this browser sign in even if somebody pauses the name again. Kept
 * in this browser alone, so no other device carries it. Storage that is refused or missing
 * keeps nothing, and sign-in then works as it always does.
 */

const KEY = 'dfc.reset_proof';
const LIFETIME_MS = 15 * 60 * 1000;

export function keepResetProof(proof: string, now: number = Date.now()): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ proof, until: now + LIFETIME_MS }));
  } catch {
    // Nothing kept: the browser waits out a pause like any other.
  }
}

/** The kept proof while its fifteen minutes run, else null. */
export function resetProof(now: number = Date.now()): string | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw === null) return null;
    const kept = JSON.parse(raw) as { proof?: unknown; until?: unknown };
    if (typeof kept.proof === 'string' && typeof kept.until === 'number' && kept.until > now) {
      return kept.proof;
    }
    window.localStorage.removeItem(KEY);
  } catch {
    // Unreadable or refused: no proof.
  }
  return null;
}
