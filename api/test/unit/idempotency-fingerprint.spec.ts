import { IdempotencyService } from '../../src/common/idempotency/idempotency.service';

import type { Db } from '../../src/database/database.module';

/**
 * A password in a body enters the idempotency fingerprint keyed (SKILL.md section 22,
 * decision 0351), so a stored fingerprint is not a plain hash a copy of the database can
 * guess passwords against.
 */
describe('the idempotency fingerprint keys a password', () => {
  const service = (jwtSecret: string) =>
    new IdempotencyService(null as unknown as Db, { jwtSecret });
  const one = service('one test secret of at least thirty-two characters');
  const other = service('another test secret of at least thirty-two chars');

  const password = {
    current_password: 'the first long passphrase',
    new_password: 'a second long passphrase',
    refresh_token: 'x',
  };

  it('depends on the server secret where a body holds a password', () => {
    expect(one.fingerprint('POST', '/api/v1/auth/password', password)).not.toBe(
      other.fingerprint('POST', '/api/v1/auth/password', password),
    );
  });

  it('is unchanged by the secret for every other body', () => {
    const body = { username: 'rbsantiago' };
    expect(one.fingerprint('POST', '/api/v1/auth/username', body)).toBe(
      other.fingerprint('POST', '/api/v1/auth/username', body),
    );
  });

  it('still tells two passwords apart, and matches a retry of the same one', () => {
    const fingerprint = (body: object) => one.fingerprint('POST', '/api/v1/auth/password', body);

    expect(fingerprint(password)).toBe(fingerprint({ ...password }));
    expect(fingerprint(password)).not.toBe(
      fingerprint({ ...password, new_password: 'a third long passphrase' }),
    );
  });
});
