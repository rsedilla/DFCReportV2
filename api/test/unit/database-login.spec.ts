import {
  DatabaseLoginError,
  loginProblems,
  type LoginFacts,
} from '../../src/database/database-login';

/** What the production startup check refuses (SKILL.md section 24, decision 0453). */
describe('the database login production starts on', () => {
  const restricted: LoginFacts = {
    login: 'app_login',
    superuser: false,
    ownsDatabaseOrSchema: false,
    createsInSchema: false,
    owned: [],
    truncatable: [],
    tablesWithoutAccess: [],
    sequencesWithoutAccess: [],
  };

  it('accepts a login that only reads and writes', () => {
    expect(loginProblems(restricted)).toEqual([]);
  });

  it('refuses a superuser, once rather than once per privilege it implies', () => {
    expect(
      loginProblems({ ...restricted, superuser: true, truncatable: ['audit_log', 'persons'] }),
    ).toEqual(['it is a superuser']);
  });

  it('refuses the owner of the database or schema, and a login that can create in it', () => {
    expect(
      loginProblems({ ...restricted, ownsDatabaseOrSchema: true, createsInSchema: true }),
    ).toEqual(['it owns the database or its public schema']);
    expect(loginProblems({ ...restricted, createsInSchema: true })).toEqual([
      'it can create tables in the public schema',
    ]);
  });

  it('refuses the tables’ owner, and a login that can TRUNCATE', () => {
    expect(
      loginProblems({ ...restricted, owned: ['persons'], truncatable: ['audit_log', 'persons'] }),
    ).toEqual(['it owns 1 table(s) (persons)', 'it can TRUNCATE 2 table(s) (audit_log, persons)']);
  });

  it('refuses a table or sequence it cannot use, naming three and counting the rest', () => {
    expect(
      loginProblems({
        ...restricted,
        tablesWithoutAccess: ['a_table', 'b_table', 'c_table', 'd_table', 'e_table'],
        sequencesWithoutAccess: ['member_id_seq'],
      }),
    ).toEqual([
      'it cannot read and write 5 table(s) (a_table, b_table, c_table and 2 more)',
      'it cannot use 1 sequence(s) (member_id_seq)',
    ]);
  });

  it('says which login, what is wrong, and where the setup script is', () => {
    const error = new DatabaseLoginError('owner_login', ['it owns 1 table(s) (persons)']);
    expect(error.message).toBe(
      'Refusing to start: the database login "owner_login" is not the restricted login ' +
        'production requires (SKILL.md section 24): it owns 1 table(s) (persons). Connect ' +
        'as a login holding only SELECT, INSERT, UPDATE and DELETE on the tables, and set ' +
        'it up with api/scripts/restricted-login.sql.',
    );
  });
});
