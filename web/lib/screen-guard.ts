import { useQuery } from '@tanstack/react-query';

import { getMe, holdsWholeChurch, type SessionDescription } from './me';

/**
 * Whether a link may be drawn: a page that does not open for this account is not offered as a
 * link either (decision 0379), so no page of an account's screens leads to the note. Until the
 * server names the screens, every link is drawn, as the page itself is.
 */
export function useOffered(): (href: string) => boolean {
  const me = useQuery({ queryKey: ['me'], queryFn: ({ signal }) => getMe(signal) });
  return (href) => me.data === undefined || pageIsOffered(me.data, href.split(/[?#]/)[0]);
}

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
  // The DCC month page, hidden on 23 Oct and closed with the others (owner, 27 Oct).
  if (at(/^\/dcc$/)) {
    return false;
  }
  // Every account has its own Account page and Record, and a Sunday's checklist from Record.
  if (at(/^\/(session|dashboard|dcc)(\/|$)/)) {
    return true;
  }

  // A Cell's meetings and members, opened from Record on every account's screens.
  const cellRecord = at(/^\/cells\/[^/]+\/(meetings|members)(\/|$)/) && !at(/^\/cells\/new(\/|$)/);
  // A person's own page and the pages it opens, reached from a name.
  const person =
    at(/^\/people\/[^/]+(\/|$)/) &&
    !at(/^\/people\/(new|awaiting-leader|number-of-people|absent)(\/|$)/);
  // The reports the Senior Pastors and a Full view leader have (decisions 0326 and 0380), and
  // their last twelve months (decision 0377). The address # of People had under People forwards.
  const fiveReports =
    at(/^\/reports\/(cells|dcc|number-of-cells|number-of-cell-leaders|number-of-people)(\/|$)/) ||
    at(/^\/trends(\/|$)/) ||
    at(/^\/people\/number-of-people(\/|$)/);

  if (me.screens === 'SENIOR_PASTOR') {
    // Record and Reports (decisions 0326 and 0377), and what they open: a Cell's meetings and
    // members, and a person (until the owner rules on their person pages).
    // and Conquest, an item of their own since decision 0407.
    return fiveReports || cellRecord || person || at(/^\/conquest(\/|$)/);
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
      // Kept for the SUYNL readers decision 0360 marks it for, though nothing links to it now.
      at(/^\/growth\/training\/encounters(\/|$)/)
    );
  }

  // Full view: Record, Reports, People, Cells and SUYNL, and Conquest for the Admin. My Cell is the recording screens'.
  if (at(/^\/my-cell(\/|$)/)) {
    return false;
  }
  // New Cell is offered from the Cells list to a Whole Church holder of
  // `cell.approve_leadership` alone (sections 2 and 10).
  if (at(/^\/cells\/new(\/|$)/)) {
    return holdsWholeChurch(me, 'cell.approve_leadership');
  }
  // A Full view leader, reading their own branch, has the five reports and SUYNL alone
  // (decisions 0360, 0380 and 0383). The Encounter seasons page stays open: decision 0360 marks
  // SUYNL on it for them, though nothing on their screens links to it now.
  const branchReader =
    me.capabilities.some((grant) => grant.capability === 'reports.view_subtree') &&
    !holdsWholeChurch(me, 'reports.view_subtree');
  if (branchReader) {
    if (at(/^\/reports(\/|$)/) || at(/^\/trends(\/|$)/)) {
      return fiveReports;
    }
    return !at(/^\/growth\/(training|conquest)$/) && !at(/^\/conquest(\/|$)/);
  }
  // The Admin's six reports have no twelve-month view (decision 0377).
  return !at(/^\/trends(\/|$)/);
}
