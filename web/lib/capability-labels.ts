import { networkLabel, type Network } from './people';

import type { GrantSummary } from './me';

/**
 * Each capability in the words of the Account page (SKILL.md section 7): what it lets the
 * holder do, never the code. The order is the order the page lists them in.
 */
const CAPABILITY_LABELS: [string, string][] = [
  ['people.view_subtree', "See people's records"],
  ['people.create', 'Add a person'],
  ['people.edit_basic', "Edit a person's name, birthday and mobile number"],
  ['people.manage_pastoral_assignment', "Change a person's pastoral leader"],
  ['people.manage_lifecycle', 'Archive or restore a person'],
  ['people.correct_sex', "Correct a person's recorded sex"],
  ['people.merge', 'Merge two records of one person'],
  ['dcc.take_attendance', 'Record DCC attendance'],
  ['dcc.submit_on_behalf', 'Record DCC for a leader under you'],
  ['dcc.correct_subtree', 'Correct DCC attendance already recorded'],
  ['dcc.view_subtree', 'See DCC attendance'],
  ['cell.take_attendance', 'Record Cell meetings'],
  ['cell.submit_on_behalf', 'Record a Cell meeting for its leader'],
  ['cell.correct_subtree', 'Correct a Cell meeting already recorded'],
  ['cell.view_subtree', 'See Cells and their members'],
  ['cell.manage_membership', 'Add or remove Cell members'],
  ['cell.manage_configuration', "Change a Cell's category or meeting time"],
  ['cell.manage_leadership', "Change a Cell's leader"],
  ['cell.request_leadership', 'Ask for a new Cell or a new Cell Leader'],
  ['cell.approve_leadership', 'Approve a new Cell or Cell Leader'],
  ['cell.manage_lifecycle', 'Close a Cell'],
  ['reports.view_subtree', 'See reports'],
  ['suynl.view_subtree', 'See SUYNL lessons'],
  ['suynl.confirm', 'Record SUYNL lessons'],
  ['suynl.confirm_on_behalf', 'Record SUYNL lessons for a leader under you'],
  ['training.view_subtree', 'See Training graduations'],
  ['training.confirm', 'Record Training graduations'],
  ['training.confirm_on_behalf', 'Record Training graduations for a leader under you'],
  ['conquest.view_subtree', 'See Conquest goals'],
  ['conquest.confirm', 'Confirm a Conquest goal'],
  ['conquest.confirm_on_behalf', 'Confirm a Conquest goal for a leader under you'],
  ['records.backdate_effective_date', 'Date a change in the past, or amend a closed month'],
  ['accounts.manage', 'Give and manage accounts'],
  ['roles.manage', 'Change roles and permissions'],
  ['settings.manage', 'Change church-wide settings'],
  ['audit.view', 'See the record of changes'],
];

const ORDER = new Map(CAPABILITY_LABELS.map(([code], index) => [code, index]));
const LABEL = new Map(CAPABILITY_LABELS);

/** How far a grant reaches, in the words decision 0317 gives the reader's scope. */
function reachLabel(grant: GrantSummary): string {
  switch (grant.scope_type) {
    case 'WHOLE_CHURCH':
      return 'Whole Church';
    case 'NETWORK':
      return grant.scope_network ? networkLabel(grant.scope_network as Network) : 'A Network';
    case 'SUBTREE_EXCL_SELF':
      return 'People you oversee, not yourself';
    default:
      return 'People you oversee';
  }
}

const REACH_ORDER = ['People you oversee', 'People you oversee, not yourself'];

/**
 * The account's grants as plain sentences, grouped by how far each reaches: the reader's
 * own people first, then a Network, then the whole church. A grant whose code this page
 * does not know is shown as "Another permission" rather than as the code.
 */
export function describeGrants(grants: GrantSummary[]): { reach: string; actions: string[] }[] {
  const groups = new Map<string, { label: string; order: number }[]>();
  for (const grant of grants) {
    const reach = reachLabel(grant);
    const action = `${LABEL.get(grant.capability) ?? 'Another permission'}${grant.read_only ? ' (view only)' : ''}`;
    const list = groups.get(reach) ?? [];
    if (!list.some((item) => item.label === action)) {
      list.push({ label: action, order: ORDER.get(grant.capability) ?? ORDER.size });
    }
    groups.set(reach, list);
  }

  const rank = (reach: string) =>
    REACH_ORDER.includes(reach) ? REACH_ORDER.indexOf(reach) : reach === 'Whole Church' ? 99 : 50;

  return [...groups.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([reach, list]) => ({
      reach,
      actions: list.sort((x, y) => x.order - y.order).map((item) => item.label),
    }));
}
