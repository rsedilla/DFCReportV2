import type { AccountRole } from '../../database/schema';

/**
 * Which screens an account has (SKILL.md section 19, decisions 0323 and 0325), named by the
 * API so that a client never works it out from a role or from the capabilities (decision
 * 0323, point 5).
 *
 * - `FULL`: today's screens. An `ADMIN`, and a `LEADER` with Full view.
 * - `SENIOR_PASTOR`: an honoured `SENIOR_PASTOR` without `ADMIN` (decision 0325).
 * - `RECORDING`: a `LEADER` without Full view, and an account holding no honoured role.
 *
 * Read from the honoured roles, so a `SENIOR_PASTOR` row this system refuses to honour
 * gives what the rest of the account gives.
 */
export type Screens = 'FULL' | 'SENIOR_PASTOR' | 'RECORDING';

export function screensFor(roles: readonly AccountRole[], fullView: boolean): Screens {
  if (roles.includes('ADMIN')) {
    return 'FULL';
  }

  if (roles.includes('SENIOR_PASTOR')) {
    return 'SENIOR_PASTOR';
  }

  return roles.includes('LEADER') && fullView ? 'FULL' : 'RECORDING';
}
