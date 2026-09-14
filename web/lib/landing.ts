import { getMe, holdsWholeChurch, type SessionDescription } from './me';

/**
 * Where a signed-in person lands, and which arrangement of the sidebar they see
 * (SKILL.md section 19, ruling of 2026-09-14).
 *
 * **Read off the reach of `reports.view_subtree`, never a role.** `/auth/me`
 * returns grants and no role, and section 7 makes the capability and its scope the
 * thing that decides. A whole-church reader starts on Reports; everyone else starts
 * on Record, which is the Dashboard.
 *
 * Nothing here authorizes anything. Landing somewhere is courtesy, and the screen
 * still shows only what the API returns (section 1, principle 4).
 */
export const RECORD_PATH = '/dashboard';
export const REPORTS_PATH = '/reports/cells';

export function readsWholeChurch(me: SessionDescription | undefined): boolean {
  return holdsWholeChurch(me, 'reports.view_subtree');
}

export function landingPath(me: SessionDescription | undefined): string {
  return readsWholeChurch(me) ? REPORTS_PATH : RECORD_PATH;
}

/**
 * The landing path for the account now signed in.
 *
 * **Falls back to Record when the account cannot be described**, rather than
 * holding the person on a waiting screen: Record is where every account may go,
 * and whatever went wrong is reported there by the screen that asks again.
 */
export async function resolveLanding(): Promise<string> {
  try {
    return landingPath(await getMe());
  } catch {
    return RECORD_PATH;
  }
}
