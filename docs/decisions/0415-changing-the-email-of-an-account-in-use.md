# 2026-11-01 — Changing the email of an account in use

Decision 0300 lets an administrator correct an account's address only while nobody has
activated it, and left changing the address of an account in use open. A leader who changes
phones or loses a mailbox had no way to move where their reset links go. The owner chose
both ways from screenshots on 2026-11-01.

## The ruling

**1. A signed-in person changes their own address on their Account page**, giving the new
address and their current password (`POST /api/v1/auth/email`). A link goes to the new
address, and the address changes only when that link is opened and confirmed, so a typing
mistake cannot lock anybody out. The link lasts 24 hours, and asking again replaces the one
sent before.

**2. Opening the link changes nothing by itself.** It opens a page with a button
(`POST /api/v1/auth/email/confirm`), because mail scanners follow links. The link is the
credential, so the page works signed in or not. It fails for a disabled account, and for an
address that another account has taken since. That second refusal is the only place an
address already in use is refused: refusing at the request would tell any signed-in person
whether an address has an account.

**3. When the address changes**, every outstanding reset link stops working, so the old
mailbox can no longer reset the password. The person's sessions are kept. The old address
is told, and the change is recorded as `account.email_changed` with both addresses.

**4. An administrator changes the address of an account in use from the person page**, for
someone who has lost the mailbox (`POST /api/v1/accounts/{id}/email` with `restart: true`,
under `accounts.manage`). The account starts over at the new address: it returns to
`PENDING_ACTIVATION`, its password is removed, every session ends, every outstanding link
stops working, and an activation link goes to the new address. The old address is told,
and the change is recorded as `account.email_replaced` with both addresses and the
administrator.

**5. That route still corrects a pending account as decision 0300 says.** Without `restart`
an account in use is refused as before, so a page that still shows an account as awaiting
activation cannot start it over by mistake. The administrator's own account is refused (the
Account page is theirs), and so is a disabled one. The username and the second sign-in step
are kept, so taking over an administrator's or a Senior Pastor's account this way still
needs their second step.

**6. The accepted cost** is that an administrator could take an account this way, by
choosing a mailbox they control. It is never silent: the holder is signed out, the old
address is told, and the audit log names the administrator.

**7. A delivery failure does not fail the change**, as with provisioning: the confirmation
link can be asked for again, and the activation email resent.

## Why

An address must be movable by its holder without risk of a typo, and recoverable by an
administrator when the mailbox is gone, and neither may happen unseen. This settles the
question decision 0300 left open.

---

Decision 0415, indexed in [CLAUDE.md](../../CLAUDE.md) and amended into [SKILL.md](../../SKILL.md)
Sections 6, 21 and 22.

Previous: [2026-11-01 — Who opened this record, shown to the Admin](0414-who-opened-this-record.md)
