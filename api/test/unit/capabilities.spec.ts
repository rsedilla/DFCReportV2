import {
  ALL_CAPABILITIES,
  READ_CAPABILITIES,
  isReadCapability,
} from '../../src/auth/authorization/capabilities';
import { ALL_SCOPE_TYPES } from '../../src/auth/authorization/scopes';

/**
 * SKILL.md section 7 calls the capability list and the scope list closed
 * enumerations, because a guard cannot fail closed against an open one. Both
 * tests are a second transcription of section 7's own lists, in its order.
 *
 * The nine Conquest, SUYNL and Training capabilities joined the declaration and
 * the `capability` enum with migration `0017_growth.sql` (sections 27 and 28), so
 * what the application declares and what section 7 names are now the same list.
 */
describe('the capability enumeration the application declares', () => {
  const DECLARED = [
    'people.view_subtree',
    'people.create',
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
    'cell.manage_configuration',
    'cell.request_leadership',
    'cell.approve_leadership',
    'cell.manage_lifecycle',
    'reports.view_subtree',
    'people.merge',
    'records.backdate_effective_date',
    'settings.manage',
    'accounts.manage',
    'roles.manage',
    'audit.view',
    'conquest.view_subtree',
    'conquest.confirm',
    'conquest.confirm_on_behalf',
    'suynl.view_subtree',
    'suynl.confirm',
    'suynl.confirm_on_behalf',
    'training.view_subtree',
    'training.confirm',
    'training.confirm_on_behalf',
  ];

  it('is exactly the capabilities the application declares', () => {
    expect([...ALL_CAPABILITIES]).toEqual(DECLARED);
  });

  it('holds no duplicates', () => {
    expect(new Set(ALL_CAPABILITIES).size).toBe(ALL_CAPABILITIES.length);
  });

  // Section 7 names eight read capabilities, and `read_only` is valid on those
  // alone. The three Growth reads arrived with their modules; the counts are
  // written out rather than derived, because a count computed from the list it is
  // checking agrees with it whatever the list says.
  it('divides into eight reads and twenty-eight writes', () => {
    expect([...READ_CAPABILITIES]).toEqual([
      'people.view_subtree',
      'dcc.view_subtree',
      'cell.view_subtree',
      'reports.view_subtree',
      'audit.view',
      'conquest.view_subtree',
      'suynl.view_subtree',
      'training.view_subtree',
    ]);

    const writes = ALL_CAPABILITIES.filter((capability) => !isReadCapability(capability));
    expect(writes).toHaveLength(28);
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
