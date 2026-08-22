import {
  ALL_CAPABILITIES,
  READ_CAPABILITIES,
  isReadCapability,
} from '../../src/auth/authorization/capabilities';
import { ALL_SCOPE_TYPES } from '../../src/auth/authorization/scopes';

/**
 * SKILL.md section 7 calls the capability list and the scope list closed
 * enumerations, because a guard cannot fail closed against an open one. These
 * tests are a second transcription of both lists: if the enumeration in the code
 * drifts from the specification, one of the two has to change deliberately.
 */
describe('the capability enumeration (SKILL.md section 7)', () => {
  const SPECIFIED = [
    'people.view_subtree',
    'people.edit_basic',
    'people.manage_lifecycle',
    'people.manage_pastoral_assignment',
    'people.correct_sex',
    'dcc.take_attendance',
    'dcc.view_subtree',
    'dcc.submit_on_behalf',
    'dcc.correct_subtree',
    'cell.take_attendance',
    'cell.view_subtree',
    'cell.submit_on_behalf',
    'cell.correct_subtree',
    'cell.manage_membership',
    'cell.manage_leadership',
    'cell.request_creation',
    'cell.approve_creation',
    'cell.manage_lifecycle',
    'reports.view_subtree',
    'people.merge',
    'records.backdate_effective_date',
    'settings.manage',
    'accounts.manage',
    'roles.manage',
    'audit.view',
  ];

  it('is exactly the twenty-five the specification names', () => {
    expect([...ALL_CAPABILITIES]).toEqual(SPECIFIED);
  });

  it('holds no duplicates', () => {
    expect(new Set(ALL_CAPABILITIES).size).toBe(ALL_CAPABILITIES.length);
  });

  it('divides into five reads and twenty writes', () => {
    expect([...READ_CAPABILITIES]).toEqual([
      'people.view_subtree',
      'dcc.view_subtree',
      'cell.view_subtree',
      'reports.view_subtree',
      'audit.view',
    ]);

    const writes = ALL_CAPABILITIES.filter((capability) => !isReadCapability(capability));
    expect(writes).toHaveLength(20);
  });
});

describe('the scope enumeration (SKILL.md section 7)', () => {
  it('is exactly the four the specification names', () => {
    expect([...ALL_SCOPE_TYPES]).toEqual([
      'OWN_SUBTREE',
      'SUBTREE_EXCL_SELF',
      'NETWORK',
      'WHOLE_CHURCH',
    ]);
  });
});
