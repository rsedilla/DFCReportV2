import { holdsWholeChurch, type SessionDescription } from './me';

/**
 * Whether a page belongs to the screens the server names for this account (decision 0379).
 *
 * **A screen hidden from an account's menu does not open for it either.** Decisions 0360, 0364
 * and 0380 left pages reachable by address that no item or tab offers; an old link or a typed
 * address then opened a half-working page full of refusals. The rule here is the menu's own:
 * the pages an account's items and tabs reach, and the pages those open (a Cell's meetings from
 * Record, a person from People).
 *
 * **Nothing here authorizes anything** (section 1, principle 4). The API still decides what
 * every request may read or change; this only stops the screen offering a page that is not the
 * account's. Keyed on the screens the server names, never on a role (decision 0323, point 5).
 */
export function pageIsOffered(me: SessionDescription, pathname: string): boolean {
  const path = pathname.replace(/\/+$/, '') || '/';
  const at = (pattern: RegExp) => pattern.test(path);

  // Replaced by # of People and Family Tree (decision 0364), for every account.
  if (at(/^\/network(\/|$)/)) {
    return false;
  }
  // Every account has its own Account page and Record.
  if (at(/^\/(session|dashboard|dcc)(\/|$)/)) {
    return true;
  }

  // A Cell's meetings and members, opened from Record on every account's screens.
  const cellRecord = at(/^\/cells\/[^/]+\/(meetings|members)(\/|$)/) && !at(/^\/cells\/new(\/|$)/);
  // A person's own page and the pages it opens, reached from a name.
  const person =
    at(/^\/people\/[^/]+(\/|$)/) && !at(/^\/people\/(new|awaiting-leader|number-of-people)(\/|$)/);
  // The reports the Senior Pastors and a Full view leader have (decisions 0326 and 0380), and
  // their last twelve months (decision 0377). The address # of People had under People forwards.
  const fiveReports =
    at(/^\/reports\/(cells|dcc|number-of-cells|number-of-cell-leaders|number-of-people)(\/|$)/) ||
    at(/^\/trends(\/|$)/) ||
    at(/^\/people\/number-of-people(\/|$)/);

  if (me.screens === 'SENIOR_PASTOR') {
    // Record and Reports (decisions 0326 and 0377), and what they open: a Cell's meetings and
    // members, and a person (until the owner rules on their person pages).
    return fiveReports || cellRecord || person;
  }

  if (me.screens === 'RECORDING') {
    // Record, People, Cells as My Cell, and SUYNL (decision 0323): no Reports, no Cells list,
    // no Awaiting Leader Assignment or Family Tree.
    return (
      at(/^\/people(\/new)?$/) ||
      person ||
      at(/^\/my-cell(\/|$)/) ||
      cellRecord ||
      at(/^\/growth\/suynl(\/|$)/) ||
      at(/^\/growth\/training\/encounters(\/|$)/)
    );
  }

  // Full view: Record, Reports, People, Cells and Growth. My Cell is the recording screens'.
  if (at(/^\/my-cell(\/|$)/)) {
    return false;
  }
  // A Full view leader, reading their own branch, has the five reports and SUYNL alone
  // (decisions 0360, 0380 and 0383), though the Encounter seasons stay reachable from SUYNL.
  const branchReader =
    me.capabilities.some((grant) => grant.capability === 'reports.view_subtree') &&
    !holdsWholeChurch(me, 'reports.view_subtree');
  if (branchReader) {
    if (at(/^\/reports(\/|$)/) || at(/^\/trends(\/|$)/)) {
      return fiveReports;
    }
    return !at(/^\/growth\/(training|conquest)$/);
  }
  // The Admin's six reports have no twelve-month view (decision 0377).
  return !at(/^\/trends(\/|$)/);
}
