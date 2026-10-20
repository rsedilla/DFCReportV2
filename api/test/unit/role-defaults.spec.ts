import { ALL_CAPABILITIES } from '../../src/auth/authorization/capabilities';
import {
  LEADER_APPROVES_CELLS,
  LEADER_MOVES_PEOPLE,
  ROLE_DEFAULTS,
} from '../../src/auth/authorization/role-defaults';

import type { Capability } from '../../src/auth/authorization/capabilities';
import type { AccountRole } from '../../src/database/schema';

/**
 * The role catalog of SKILL.md section 7, transcribed a second time, cell by
 * cell. Every row of that table is here since the Growth modules were built
 * (sections 27 and 28), which is what the case below asserts.
 *
 * A dash in the specification's table is an absence here. The seven deliberate
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
    SENIOR_PASTOR: null,
    ADMIN: 'WHOLE_CHURCH',
    LEADER: 'OWN_SUBTREE',
  },
  'people.edit_basic': {
    SENIOR_PASTOR: null,
    ADMIN: 'WHOLE_CHURCH',
    LEADER: 'OWN_SUBTREE',
  },
  'people.manage_lifecycle': { SENIOR_PASTOR: null, ADMIN: 'WHOLE_CHURCH', LEADER: null },
  // The Leader cell reads "own/subtree, with Moves people and Full view" (decision 0356): a
  // default the tick adds, so it is absent here and pinned against `LEADER_MOVES_PEOPLE` below.
  'people.manage_pastoral_assignment': {
    SENIOR_PASTOR: 'WHOLE_CHURCH',
    ADMIN: 'WHOLE_CHURCH',
    LEADER: null,
  },
  'people.correct_sex': { SENIOR_PASTOR: null, ADMIN: 'WHOLE_CHURCH', LEADER: null },
  'people.set_title': { SENIOR_PASTOR: null, ADMIN: 'WHOLE_CHURCH', LEADER: null },
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
  'dcc.submit_on_behalf': { SENIOR_PASTOR: null, ADMIN: 'WHOLE_CHURCH', LEADER: null },
  'dcc.correct_subtree': {
    SENIOR_PASTOR: null,
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
  'cell.submit_on_behalf': { SENIOR_PASTOR: null, ADMIN: 'WHOLE_CHURCH', LEADER: null },
  'cell.correct_subtree': {
    SENIOR_PASTOR: null,
    ADMIN: 'WHOLE_CHURCH',
    LEADER: 'OWN_SUBTREE',
  },
  'cell.manage_membership': {
    SENIOR_PASTOR: null,
    ADMIN: 'WHOLE_CHURCH',
    LEADER: 'OWN_SUBTREE',
  },
  // The Leader cell reads "own/subtree, with Moves people and Full view" (decision 0357): the
  // same tick as people.manage_pastoral_assignment, pinned against `LEADER_MOVES_PEOPLE` below.
  'cell.move_members': { SENIOR_PASTOR: null, ADMIN: 'WHOLE_CHURCH', LEADER: null },
  'cell.manage_leadership': {
    SENIOR_PASTOR: null,
    ADMIN: 'WHOLE_CHURCH',
    LEADER: 'OWN_SUBTREE',
  },
  'cell.manage_configuration': {
    SENIOR_PASTOR: null,
    ADMIN: 'WHOLE_CHURCH',
    LEADER: 'OWN_SUBTREE',
  },
  'cell.request_leadership': {
    SENIOR_PASTOR: 'SUBTREE_EXCL_SELF',
    ADMIN: 'SUBTREE_EXCL_SELF',
    LEADER: 'SUBTREE_EXCL_SELF',
  },
  // The Leader cell reads "subtree, excl. self, with Approves Cells" (decision 0352). Unlike
  // the Full view rows it is not a Leader default withheld without the tick but one the
  // tick adds, so it is absent here and pinned against `LEADER_APPROVES_CELLS` below.
  'cell.approve_leadership': { SENIOR_PASTOR: null, ADMIN: 'WHOLE_CHURCH', LEADER: null },
  'cell.manage_lifecycle': {
    SENIOR_PASTOR: null,
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
  // Sections 27 and 28. Admin and Leader hold all nine at the role's usual scope, except
  // suynl.confirm_on_behalf, Admin's alone (decision 0322); a Senior Pastor holds the three
  // views (decision 0326).
  // They are written out rather than generated — a generated row would agree with the
  // code it is checking by construction.
  'conquest.view_subtree': {
    SENIOR_PASTOR: 'WHOLE_CHURCH',
    ADMIN: 'WHOLE_CHURCH',
    LEADER: 'OWN_SUBTREE',
  },
  'conquest.confirm': {
    SENIOR_PASTOR: null,
    ADMIN: 'WHOLE_CHURCH',
    LEADER: 'OWN_SUBTREE',
  },
  'conquest.confirm_on_behalf': {
    SENIOR_PASTOR: null,
    ADMIN: 'WHOLE_CHURCH',
    LEADER: 'OWN_SUBTREE',
  },
  'suynl.view_subtree': {
    SENIOR_PASTOR: 'WHOLE_CHURCH',
    ADMIN: 'WHOLE_CHURCH',
    LEADER: 'OWN_SUBTREE',
  },
  'suynl.confirm': { SENIOR_PASTOR: null, ADMIN: 'WHOLE_CHURCH', LEADER: 'OWN_SUBTREE' },
  'suynl.confirm_on_behalf': { SENIOR_PASTOR: null, ADMIN: 'WHOLE_CHURCH', LEADER: null },
  'training.view_subtree': {
    SENIOR_PASTOR: 'WHOLE_CHURCH',
    ADMIN: 'WHOLE_CHURCH',
    LEADER: 'OWN_SUBTREE',
  },
  'training.confirm': {
    SENIOR_PASTOR: null,
    ADMIN: 'WHOLE_CHURCH',
    LEADER: 'OWN_SUBTREE',
  },
  'training.confirm_on_behalf': {
    SENIOR_PASTOR: null,
    ADMIN: 'WHOLE_CHURCH',
    LEADER: 'OWN_SUBTREE',
  },
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

  describe('the seven deliberate absences', () => {
    it('keeps recording on behalf with Admin alone (decision 0322)', () => {
      // Reporting is done on the ground by the leader who owes it; the leaders above
      // see whether it is done, and only Admin steps in. Training and Conquest keep theirs.
      for (const role of ['SENIOR_PASTOR', 'LEADER'] as const) {
        expect(ROLE_DEFAULTS[role]['dcc.submit_on_behalf']).toBeUndefined();
        expect(ROLE_DEFAULTS[role]['cell.submit_on_behalf']).toBeUndefined();
        expect(ROLE_DEFAULTS[role]['suynl.confirm_on_behalf']).toBeUndefined();
      }
      expect(ROLE_DEFAULTS.LEADER['training.confirm_on_behalf']).toBeDefined();
      expect(ROLE_DEFAULTS.LEADER['conquest.confirm_on_behalf']).toBeDefined();
      expect(ROLE_DEFAULTS.ADMIN['dcc.submit_on_behalf']).toBe('WHOLE_CHURCH');
      expect(ROLE_DEFAULTS.ADMIN['cell.submit_on_behalf']).toBe('WHOLE_CHURCH');
      expect(ROLE_DEFAULTS.ADMIN['suynl.confirm_on_behalf']).toBe('WHOLE_CHURCH');
    });

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

    it('keeps the Senior Pastors to reading, recording and reassigning (decision 0326)', () => {
      // They read the church and delegate the work: every write capability but recording
      // what they owe and reassigning is an administrator's.
      const writes = Object.keys(ROLE_DEFAULTS.SENIOR_PASTOR).filter(
        (capability) => !capability.endsWith('.view_subtree') && capability !== 'audit.view',
      );
      expect(writes.sort()).toEqual([
        'cell.request_leadership',
        'cell.take_attendance',
        'dcc.take_attendance',
        'people.manage_pastoral_assignment',
      ]);
    });

    it('keeps archival away from Leaders', () => {
      // Archiving reduces a leader's own People count, which is precisely the
      // incentive Person Lifecycle guards against (section 3).
      expect(ROLE_DEFAULTS.LEADER['people.manage_lifecycle']).toBeUndefined();
    });
  });

  it('gives a Leader cell.approve_leadership only with Approves Cells, over its branch excluding itself (decision 0352)', () => {
    // The catalog's "subtree, excl. self, with Approves Cells": a set the tick adds,
    // holding that one capability and nothing else, and never part of the Leader role.
    expect(LEADER_APPROVES_CELLS).toEqual({ 'cell.approve_leadership': 'SUBTREE_EXCL_SELF' });
    expect(ROLE_DEFAULTS.LEADER['cell.approve_leadership']).toBeUndefined();
    expect(ROLE_DEFAULTS.SENIOR_PASTOR['cell.approve_leadership']).toBeUndefined();
  });

  it('gives a Leader people.manage_pastoral_assignment and cell.move_members only with Moves people, over its own subtree (decisions 0356 and 0357)', () => {
    // A set the tick adds, holding those two capabilities and nothing else, never part of
    // the Leader role. A Senior Pastor moves people to another leader and moves no member.
    expect(LEADER_MOVES_PEOPLE).toEqual({
      'people.manage_pastoral_assignment': 'OWN_SUBTREE',
      'cell.move_members': 'OWN_SUBTREE',
    });
    expect(ROLE_DEFAULTS.LEADER['people.manage_pastoral_assignment']).toBeUndefined();
    expect(ROLE_DEFAULTS.LEADER['cell.move_members']).toBeUndefined();
    expect(ROLE_DEFAULTS.SENIOR_PASTOR['cell.move_members']).toBeUndefined();
    expect(ROLE_DEFAULTS.ADMIN['cell.move_members']).toBe('WHOLE_CHURCH');
    expect(ROLE_DEFAULTS.SENIOR_PASTOR['people.manage_pastoral_assignment']).toBe('WHOLE_CHURCH');
    expect(ROLE_DEFAULTS.ADMIN['people.manage_pastoral_assignment']).toBe('WHOLE_CHURCH');
  });

  it('holds cell.request_leadership at subtree scope for every role', () => {
    // Naming oneself on a request is prohibited for everyone, Senior Pastors and
    // Admin included (section 10).
    for (const role of ROLES) {
      expect(ROLE_DEFAULTS[role]['cell.request_leadership']).toBe('SUBTREE_EXCL_SELF');
    }
  });
});
