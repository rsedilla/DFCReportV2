import { getMe, holdsWide, type SessionDescription } from './me';

/**
 * Where a signed-in person lands (SKILL.md section 19, ruling of 2026-10-19, decision 0372).
 *
 * **Read off the screens the server names, never a role** (decision 0323, point 5), and, for the
 * Admin item alone, one capability at Whole Church, as `Conquest` is drawn (decision 0419): the
 * Senior Pastors' screens start on Reports, a holder of `accounts.manage` at Whole Church or
 * across one Network on the Admin area's Home (decisions 0419 and 0469), and every other account
 * on Record, which is the Dashboard.
 * Reading the whole church is not enough to land on Reports: the Admin reads it too.
 *
 * Nothing here authorizes anything. Landing somewhere is courtesy, and the screen
 * still shows only what the API returns (section 1, principle 4).
 */
export const RECORD_PATH = '/dashboard';

/**
 * **Reports opens on the DCC figures, because that is where the scope selector is.**
 * Section 19 gives a Senior Pastor Whole Church, Men's and Women's; the DCC report
 * offers a Network scope and the Cell report refuses one, so landing a whole-church
 * reader on the Cell figures would open on the one screen that cannot show them a
 * Network.
 */
export const REPORTS_PATH = '/reports/dcc';

/**
 * **The Senior Pastors open on *Services*** (decision 0488, owner, 2026-11-14): DCC Attendance,
 * which is what they follow each week. The same page as Reports opened on before.
 */
export const SERVICES_PATH = '/reports/dcc';

/** The Admin area's Home (decision 0419). */
export const ADMIN_PATH = '/admin';

export function landingPath(me: SessionDescription | undefined): string {
  if (me !== undefined && holdsWide(me, 'accounts.manage')) {
    return ADMIN_PATH;
  }
  return me?.screens === 'SENIOR_PASTOR' ? SERVICES_PATH : RECORD_PATH;
}

/**
 * The landing path for the account now signed in.
 *
 * **Falls back to Record when the account cannot be described**, rather than
 * holding the person on a waiting screen: Record is where every account may go,
 * and whatever went wrong is reported there by the screen that asks again.
 */
export async function resolveLanding(
  describe: () => Promise<SessionDescription> = getMe,
): Promise<string> {
  try {
    return landingPath(await describe());
  } catch {
    return RECORD_PATH;
  }
}
