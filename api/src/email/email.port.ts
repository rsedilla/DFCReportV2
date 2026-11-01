/**
 * The boundary between this system and whatever sends mail (SKILL.md section 2,
 * Chosen stack).
 *
 * "Provider abstraction; business logic must never depend directly on SES or any
 * other provider" is the rule, and this interface is the whole of it. Nothing
 * outside `src/email` names a provider, imports a provider SDK, or knows whether
 * one exists.
 *
 * **It carries messages this system defines, not a generic `send(to, subject,
 * body)`.** A generic sender would put the subject line and the body of an
 * activation email in whichever service happened to call it, so the wording a
 * leader reads would live beside the token machinery and be duplicated the second
 * time somebody needed it. Naming the messages keeps that in one place and makes
 * the set of mail this system can send a list somebody can read.
 *
 * Section 6 keeps the tokens out of every API response — an administrator may not
 * know or choose another user's password, and a token that sets one is the same
 * secret a step earlier — so this is the only route by which an activation or
 * reset token reaches a person. (An earlier version of this line cited section 7,
 * which is the Authorization Model and says nothing about token disclosure.)
 */
export const EMAIL_PORT = Symbol('EMAIL_PORT');

/** Where a recipient goes, and what to call them. */
export interface EmailRecipient {
  email: string;
  /** For the greeting. Composed by the caller, since `people` owns name shape. */
  name: string;
}

/**
 * An account has been created and its holder must set their first password.
 *
 * The token is single-use and short-lived (section 6). It is passed here rather
 * than a fully-formed URL because the link's shape belongs to whichever client is
 * deployed, which section 2 says the API must not assume.
 */
export interface ActivationEmail {
  kind: 'ACTIVATION';
  to: EmailRecipient;
  token: string;
  expiresAt: Date;
}

/**
 * Somebody asked to reset a password on an account that exists.
 *
 * Nothing is sent when the address matches no account: section 6 requires the
 * *response* to be identical either way, and sending mail to an address that has
 * no account would both leak the answer to whoever holds that inbox and mail a
 * stranger.
 */
export interface PasswordResetEmail {
  kind: 'PASSWORD_RESET';
  to: EmailRecipient;
  token: string;
  expiresAt: Date;
}

/**
 * The holder changed their password while signed in (decision 0351). It carries no
 * token: it tells somebody who did not make the change that it happened, and the
 * remedy it points to is the reset they can ask for themselves.
 */
export interface PasswordChangedEmail {
  kind: 'PASSWORD_CHANGED';
  to: EmailRecipient;
  changedAt: Date;
}

/**
 * Sign-in for an account's address or username was paused after ten wrong passwords
 * (decision 0413). Sent to each active Admin, once per pause, and only where an account
 * holds the name: what a stranger typed for nobody is not worth an Admin's attention.
 */
export interface SignInPausedEmail {
  kind: 'SIGN_IN_PAUSED';
  to: EmailRecipient;
  /** What was typed, as typed: the address or the username. */
  typed: { email: string } | { username: string };
  /** The full name of the person whose account it is. */
  holder: string;
  pausedUntil: Date;
}

/**
 * One person opened more than a hundred person pages in an hour (decision 0414). Sent to each
 * active Admin, at most once a day for one person and twenty times a day in all.
 */
export interface ManyPagesOpenedEmail {
  kind: 'MANY_PAGES_OPENED';
  to: EmailRecipient;
  /** The full name of the person who opened them. */
  viewer: string;
  /** How many different person pages, in the last hour. */
  pages: number;
}

/**
 * The holder asked to change their address (decision 0415). Sent to the **new** address,
 * whose holder confirms it from the link; nothing changes until they do.
 */
export interface EmailChangeEmail {
  kind: 'EMAIL_CHANGE';
  to: EmailRecipient;
  token: string;
  expiresAt: Date;
}

/**
 * The address of an account was changed (decision 0415). Sent to the **old** address and
 * carrying no token: it tells somebody who did not make the change that it happened.
 * `byAdministrator` says whether the account started over, which signs its holder out.
 */
export interface EmailChangedEmail {
  kind: 'EMAIL_CHANGED';
  to: EmailRecipient;
  changedAt: Date;
  byAdministrator: boolean;
}

export type OutboundEmail =
  | ActivationEmail
  | PasswordResetEmail
  | PasswordChangedEmail
  | SignInPausedEmail
  | ManyPagesOpenedEmail
  | EmailChangeEmail
  | EmailChangedEmail;

export interface EmailPort {
  /**
   * Delivers one message, or throws.
   *
   * **A caller decides what a failure means; this never swallows one.** Every
   * caller today logs rather than raises, and each reaches that from a different
   * direction:
   *
   * - **Provisioning** and **re-sending an activation** both record their
   *   idempotency completion inside the committed transaction, so raising
   *   afterwards would hand the client a 500 while the store holds the success
   *   every retry replays (`CLAUDE.md`, Write endpoints). The operator learns from
   *   the log and calls the re-send endpoint, which mints a fresh token.
   * - **A password reset** logs because an error on the hit path and a success on
   *   the miss path is the same oracle the identical response exists to prevent.
   *
   * That the answer is currently unanimous is not a reason to move the decision in
   * here. It became unanimous twice over by correction: this docblock first
   * asserted a guarantee provisioning did not provide, then said re-sending raises
   * — which was true when written and was made false by the commit that gave that
   * endpoint an idempotency completion, twelve lines from the comment.
   */
  send(message: OutboundEmail): Promise<void>;
}
