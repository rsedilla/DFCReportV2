# 2026-10-14 — Changing a password while signed in

Section 6 lists *Change Password* among the first release's sign-in features and says what a
new password must be, and nothing about how a change behaves. There was no route, so a
signed-in person who wanted a new password had only the reset link. The owner answered four
questions on 14 Oct from a real screenshot of the proposed screen.

## The ruling

A signed-in holder changes their own password on their Account page, at
`POST /api/v1/auth/password`:

1. **The current password is asked first** (owner: A). A wrong one is refused
   `VALIDATION_FAILED` on `current_password`.
2. **Every other device is signed out at once, and this one stays signed in** (owner: A).
   The refresh token the request sends names the session to keep; it must be this
   account's and live, or every session ends.
3. **The holder is emailed that it changed** (owner: A), with no token and with the
   address of the reset page.
4. **No second sign-in step is asked** of an `ADMIN` or `SENIOR_PASTOR` account (owner: A).

It is audited as `password.changed` and limited to ten a minute for each account.

## Two things the building settled

**An access token carries its issue instant in milliseconds.** Signing every other device
out at once means stamping the account's revocation marker, and the guard compared that
against `iat`, which is whole seconds and read inclusively. The session kept is renewed in
the same second as the marker, so its new token was refused. The claim `iat_ms` orders it;
a token without one is read by `iat`, as before.

**The kept session's row is dated a millisecond after the marker**, rather than the change
returning a new session. Every write's response is stored against its `Idempotency-Key`
(Section 22), so a session in the response would be a credential at rest in the database.
The client renews from the session it already holds, at once, under its session lock.

## Why

The current password stops somebody holding an unlocked phone from taking the account; the
email tells a holder who did not make the change, and points at the reset they can ask for
themselves. Keeping this device is what a person changing their password expects; signing
the rest out is what makes the change worth making when somebody else knew the old one.
Rejected: signing this device out too, which costs a sign-in and, for an Admin or a Senior
Pastor, a second code, for nothing.

Decision 0351, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-10-14 — Add a person for those who may, and no 0 on Record's switch](0350-add-a-person-for-those-who-may-and-no-0-on-the-switch.md)
