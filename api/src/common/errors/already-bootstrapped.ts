/**
 * The refusal that makes the first-Admin bootstrap one-time (SKILL.md section 6).
 *
 * Here rather than beside either service because three places raise it and none of
 * them owns it: `auth` refuses to create a second first-Admin account, `people`
 * refuses to create a second unassigned administrator, and `admin/bootstrap`
 * refuses before doing either so the operator gets the message before anything is
 * attempted.
 *
 * **Each guard reads its own module's table**, which is what keeps them
 * independent. `people` cannot ask `auth` whether an account exists — `auth`
 * imports `people` (the 2026-08-24 seam), so the reverse would restore the cycle
 * that ruling removed. It asks whether any Person exists instead, which is exactly
 * as true at the only moment either method may run: the bootstrap is the first
 * write to an empty database, so `persons` and `accounts` are both empty, and
 * either being non-empty means this is not a fresh installation.
 */
export class AlreadyBootstrappedError extends Error {
  constructor(
    message = 'An account already exists, so this is not a fresh installation. The first ' +
      'Admin is created once; provision further accounts through POST /api/v1/accounts, ' +
      'which is audited and names the Admin who did it.',
  ) {
    super(message);
    this.name = 'AlreadyBootstrappedError';
  }
}
