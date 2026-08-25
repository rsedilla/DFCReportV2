import { InvariantViolationError } from './api-error';

/**
 * The refusal that makes the first-Admin bootstrap one-time (SKILL.md section 6).
 *
 * Here rather than beside either service because three places raise it and none of
 * them owns it: `auth` refuses to create a second first-Admin account, `people`
 * refuses to create a second unassigned administrator, and `admin/bootstrap`
 * refuses before either so the operator is told before anything is attempted.
 *
 * **Each guard reads its own module's table**, which is what keeps them
 * independent. `people` cannot ask `auth` whether an account exists — `auth`
 * imports `people` (the 2026-08-24 seam), so the reverse would restore the cycle
 * that ruling removed. It asks whether any Person exists instead. Section 6 states
 * both conditions and the fact that they are not equivalent: a foreign key makes a
 * non-empty `accounts` imply a non-empty `persons` and not the reverse, so a
 * database holding Persons and no account is refused deliberately.
 *
 * **An `InvariantViolationError`, not a bare `Error`.** The stated reason both
 * service methods guard themselves is that they are public on services the API
 * uses — so the caller this anticipates is an endpoint, and a bare `Error` reaches
 * `ApiExceptionFilter` unrecognised and renders `INTERNAL_ERROR`. That is the
 * 500-instead-of-an-answer failure this repository records for the self-leader
 * check and for the duplicate-email `23505`, and section 22's
 * `INVARIANT_VIOLATION` already means what this refusal means: a rule about what
 * may be recorded, whoever submits it.
 *
 * `details.refused_by` distinguishes the three sites, because the message is
 * otherwise the only discriminator and a caller comparing strings is not a caller
 * that can branch.
 */
export class AlreadyBootstrappedError extends InvariantViolationError {
  constructor(
    refusedBy: 'bootstrap' | 'accounts' | 'people',
    message = 'An account already exists, so this is not a fresh installation. The first ' +
      'Admin is created once; provision further accounts through POST /api/v1/accounts, ' +
      'which is audited and names the Admin who did it.',
  ) {
    super(message, { refused_by: refusedBy });
    this.name = 'AlreadyBootstrappedError';
  }
}
