import { ALL_CAPABILITIES } from '../../src/auth/authorization/capabilities';
import { ROLE_DEFAULTS } from '../../src/auth/authorization/role-defaults';

import type { Capability } from '../../src/auth/authorization/capabilities';
import type { AccountRole } from '../../src/database/schema';

/**
 * The role catalog of SKILL.md section 7, transcribed a second time, cell by cell.
 *
 * A dash in the specification's table is an absence here. The five deliberate
 * absences have their own cases below, because each of them looks like an
 * oversight, each would be convenient to widen, and each is load-bearing.
 */
const TABLE: Record<Capability, Record<AccountRole, string | null>> = {
  'people.view_subtree': {
    SENIOR_PASTOR: 'WHOLE_CHURCH',
    ADMIN: 'WHOLE_CHURCH',
    LEADER: 'OWN_SUBTREE',
  },
  'people.create': {
    SENIOR_PASTOR: 'WHOLE_CHURCH',
    ADMIN: 'WHOLE_CHURCH',
    LEADER: 'OWN_SUBTREE',
  },
  'people.edit_basic': {
    SENIOR_PASTOR: 'WHOLE_CHURCH',
    ADMIN: 'WHOLE_CHURCH',
    LEADER: 'OWN_SUBTREE',
  },
  'people.manage_lifecycle': { SENIOR_PASTOR: 'WHOLE_CHURCH', ADMIN: 'WHOLE_CHURCH', LEADER: null },
  'people.manage_pastoral_assignment': {
    SENIOR_PASTOR: 'WHOLE_CHURCH',
    ADMIN: 'WHOLE_CHURCH',
    LEADER: 'OWN_SUBTREE',
  },
  'people.correct_sex': { SENIOR_PASTOR: null, ADMIN: 'WHOLE_CHURCH', LEADER: null },
  'dcc.take_attendance': {
    SENIOR_PASTOR: 'WHOLE_CHURCH',
    ADMIN: 'WHOLE_CHURCH',
    LEADER: 'OWN_SUBTREE',
  },
  'dcc.view_subtree': {
    SENIOR_PASTOR: 'WHOLE_CHURCH',
    ADMIN: 'WHOLE_CHURCH',
    LEADER: 'OWN_SUBTREE',
  },
  'dcc.submit_on_behalf': {
    SENIOR_PASTOR: 'WHOLE_CHURCH',
    ADMIN: 'WHOLE_CHURCH',
    LEADER: 'OWN_SUBTREE',
  },
  'dcc.correct_subtree': {
    SENIOR_PASTOR: 'WHOLE_CHURCH',
    ADMIN: 'WHOLE_CHURCH',
    LEADER: 'OWN_SUBTREE',
  },
  'cell.take_attendance': {
    SENIOR_PASTOR: 'WHOLE_CHURCH',
    ADMIN: 'WHOLE_CHURCH',
    LEADER: 'OWN_SUBTREE',
  },
  'cell.view_subtree': {
    SENIOR_PASTOR: 'WHOLE_CHURCH',
    ADMIN: 'WHOLE_CHURCH',
    LEADER: 'OWN_SUBTREE',
  },
  'cell.submit_on_behalf': {
    SENIOR_PASTOR: 'WHOLE_CHURCH',
    ADMIN: 'WHOLE_CHURCH',
    LEADER: 'OWN_SUBTREE',
  },
  'cell.correct_subtree': {
    SENIOR_PASTOR: 'WHOLE_CHURCH',
    ADMIN: 'WHOLE_CHURCH',
    LEADER: 'OWN_SUBTREE',
  },
  'cell.manage_membership': {
    SENIOR_PASTOR: 'WHOLE_CHURCH',
    ADMIN: 'WHOLE_CHURCH',
    LEADER: 'OWN_SUBTREE',
  },
  'cell.manage_leadership': {
    SENIOR_PASTOR: 'WHOLE_CHURCH',
    ADMIN: 'WHOLE_CHURCH',
    LEADER: 'OWN_SUBTREE',
  },
  'cell.manage_configuration': {
    SENIOR_PASTOR: 'WHOLE_CHURCH',
    ADMIN: 'WHOLE_CHURCH',
    LEADER: 'OWN_SUBTREE',
  },
  'cell.request_leadership': {
    SENIOR_PASTOR: 'SUBTREE_EXCL_SELF',
    ADMIN: 'SUBTREE_EXCL_SELF',
    LEADER: 'SUBTREE_EXCL_SELF',
  },
  'cell.approve_leadership': { SENIOR_PASTOR: null, ADMIN: 'WHOLE_CHURCH', LEADER: null },
  'cell.manage_lifecycle': {
    SENIOR_PASTOR: 'WHOLE_CHURCH',
    ADMIN: 'WHOLE_CHURCH',
    LEADER: 'OWN_SUBTREE',
  },
  'reports.view_subtree': {
    SENIOR_PASTOR: 'WHOLE_CHURCH',
    ADMIN: 'WHOLE_CHURCH',
    LEADER: 'OWN_SUBTREE',
  },
  'audit.view': { SENIOR_PASTOR: 'WHOLE_CHURCH', ADMIN: 'WHOLE_CHURCH', LEADER: null },
  'records.backdate_effective_date': { SENIOR_PASTOR: null, ADMIN: 'WHOLE_CHURCH', LEADER: null },
  'settings.manage': { SENIOR_PASTOR: null, ADMIN: 'WHOLE_CHURCH', LEADER: null },
  'accounts.manage': { SENIOR_PASTOR: null, ADMIN: 'WHOLE_CHURCH', LEADER: null },
  'roles.manage': { SENIOR_PASTOR: null, ADMIN: 'WHOLE_CHURCH', LEADER: null },
  'people.merge': { SENIOR_PASTOR: null, ADMIN: 'WHOLE_CHURCH', LEADER: null },
};

const ROLES: AccountRole[] = ['SENIOR_PASTOR', 'ADMIN', 'LEADER'];

describe('the role catalog (SKILL.md section 7)', () => {
  it.each(ROLES)('%s carries exactly the defaults the specification gives it', (role) => {
    const expected = Object.fromEntries(
      ALL_CAPABILITIES.map((capability) => [capability, TABLE[capability][role]]).filter(
        ([, scope]) => scope !== null,
      ),
    );

    expect(ROLE_DEFAULTS[role]).toEqual(expected);
  });

  it('covers every capability, so a new one cannot be added without a ruling on each role', () => {
    expect(Object.keys(TABLE).sort()).toEqual([...ALL_CAPABILITIES].sort());
  });

  describe('the five deliberate absences', () => {
    it('keeps grant-making away from the Senior Pastors', () => {
      // The two highest-visibility accounts in the church cannot escalate their
      // own authority, and every permission change involves a second party.
      expect(ROLE_DEFAULTS.SENIOR_PASTOR['roles.manage']).toBeUndefined();
      expect(ROLE_DEFAULTS.SENIOR_PASTOR['accounts.manage']).toBeUndefined();
    });

    it('keeps backdating away from the Senior Pastors', () => {
      // Backdating rewrites totals for periods already reported. It is data
      // correction, not a pastoral act.
      expect(ROLE_DEFAULTS.SENIOR_PASTOR['records.backdate_effective_date']).toBeUndefined();
    });

    it('keeps Person Merge away from the Senior Pastors', () => {
      // A merge is irreversible, crosses both Networks, and can lower totals for
      // periods already reported.
      expect(ROLE_DEFAULTS.SENIOR_PASTOR['people.merge']).toBeUndefined();
    });

    it('keeps the sex correction with Admin alone', () => {
      // It moves a Person between Networks, which can change totals for periods
      // already reported, and it forces the pastoral reassignment of section 4.
      // A leader holding it could move people between Networks without ever
      // invoking people.manage_pastoral_assignment.
      expect(ROLE_DEFAULTS.ADMIN['people.correct_sex']).toBe('WHOLE_CHURCH');
      expect(ROLE_DEFAULTS.SENIOR_PASTOR['people.correct_sex']).toBeUndefined();
      expect(ROLE_DEFAULTS.LEADER['people.correct_sex']).toBeUndefined();
    });

    it('keeps archival away from Leaders', () => {
      // Archiving reduces a leader's own People count, which is precisely the
      // incentive Person Lifecycle guards against (section 3).
      expect(ROLE_DEFAULTS.LEADER['people.manage_lifecycle']).toBeUndefined();
    });
  });

  it('holds cell.request_leadership at subtree scope for every role', () => {
    // Naming oneself on a request is prohibited for everyone, Senior Pastors and
    // Admin included (section 10).
    for (const role of ROLES) {
      expect(ROLE_DEFAULTS[role]['cell.request_leadership']).toBe('SUBTREE_EXCL_SELF');
    }
  });
});
