# 2026-09-22 — An administrator gives a person an account from their page

The two account routes, provisioning and resending an activation email, were waived to
"after the pilot — Admin screens", so every pilot account had to be created by calling the
API. The owner's Claude Design draws no Admin screen. The owner chose this answer from a
drawing of it beside a separate Accounts page.

## The ruling

**The person page carries an Account section**, shown only to a reader holding
`accounts.manage`. It says whether the person has an account and in what state, and offers
the one act that fits: "Give … an account" (an email address and a role), or, while the
account waits for activation, "Resend the activation email".

**`GET /api/v1/accounts/for-person/{personId}`** answers it under `accounts.manage`, resolved
through the Person as provisioning is: the account's id, email, status, unrevoked roles and
creation date, or `null`. It returns no password, token or session data.

## Why

Which capabilities should show an `Admin` sidebar item is still open, and the person page
does not need an answer to it: the section appears where the account belongs.

Changing a role or granting a capability is not offered, because no route exists for either.

---

Decision 0276, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-22 — A refusal names where it is, and the screen names the line](0275-a-refusal-names-where-it-is.md)
