# 2026-10-27 — An administrator sends a password reset to an account in use

Owner ruling, 2026-10-27, agreed from a real screenshot of the person page beside the proposal.

## The ruling

**1. On the person page of an `ACTIVE` account, an administrator may send a password reset
email.** The button reads *Send a password reset email* and sits above *Disable the account*,
with the line: "For someone who cannot sign in. It emails *first name* a link to choose a new
password, at *their address*. You never see or choose the password, and the link lasts 30
minutes." Once sent, the screen says where it went.

**2. The link goes only to the address already on the account.** It is the same reset token the
forgot-password page sends: single-use, stored only as a hash, lasting 30 minutes, and
replacing a reset link sent before it, as a new forgot-password link does. It never appears in a response, so the administrator
learns nothing they could sign in with, and the holder still chooses their own password, as
Section 6 requires.

**3. Only an account in use.** One awaiting activation is sent its activation email again, as
before, and a disabled one is refused: Section 6 makes re-enabling an account a separate
decision, which a reset link must not reopen. Both refusals are `INVARIANT_VIOLATION`.

**4. Under `accounts.manage`, against the Account,** as the activation re-send is:
`POST /api/v1/accounts/{id}/password-reset-email`, answering 204. It is audited as
`account.password_reset_sent`, targeting the account; the reset itself is still audited as
`password.reset` when the holder uses the link. It allows 5 requests a minute, as asking for a
reset does, since each one emails somebody else. A delivery failure is logged rather than
refused, as for the activation re-send, and the administrator may send again.

**5. Not asked first.** Sending changes nothing until the holder uses the link, so the button
acts at once, unlike disabling, which signs a person out.

## Why

On 19 October a leader given an account said they never saw it. The account was already
active, so somebody had used the activation link, and the administrator's page offered only
*Disable the account*: the activation re-send is shown only while an account waits. The only
way back was for the leader to find *I have forgotten my password* themselves. A leader who
cannot sign in is the one least able to do that, and an administrator who is asked to help
had nothing to press.

Choosing the password for them was considered and refused: Section 6 says an administrator
must not know or choose another person's password. Sending the holder their own reset link keeps that
rule whole. Changing the address the link goes to is a different question, still open in
`CLAUDE.md`, and this ruling does not answer it: the link goes where the account already points.

Decision 0393, indexed in [CLAUDE.md](../../CLAUDE.md) and amended into [SKILL.md](../../SKILL.md)
Section 6.

Previous: [2026-10-26 — A member added after a meeting was recorded is asked about, not called not marked](0391-a-member-added-after-a-meeting-was-recorded.md)
