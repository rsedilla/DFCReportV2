# 2026-09-28 — An account's address is corrected before it is activated

An administrator gave a Cell leader an account under a mistyped address. Section 6 let them
resend the activation email and nothing else, so each resend went to the wrong address again,
and the link sent there stayed live for its seven days. The address was corrected on the
server by hand, which left no audit entry. The owner approved this rule and its screen on
2026-09-28.

## The ruling

**1. While an account is `PENDING_ACTIVATION`, an administrator may correct its email
address** (`POST /api/v1/accounts/{id}/email`, under `accounts.manage`). Any other status is
refused. Changing where an account in use receives its reset link is a different decision,
which stays open.

**2. The correction, a new activation token and the audit entry are one transaction.** Every
outstanding token of the account is superseded, a reset link included, since forgot-password
answers an account awaiting activation too. So no link sent to the old address works, and
the new link goes to the new address.

**3. The new address is refused when another account holds it, or when it is the address the
account already has**, each as `INVARIANT_VIOLATION` naming the field.

**4. It is recorded as `account.email_corrected`**, with the old and new addresses.

**5. A delivery failure does not fail the correction**, exactly as with provisioning and a
resend: the address stands, and the email can be resent.

**6. The screen** is a "Correct the email" button beside "Resend the activation email" on the
person page. After saving it says where the link went and that the old one no longer works.

## Why

A wrong address must be fixable in the product, recorded, and never reached by a working link.

---

Decision 0300, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-27 — Two pickers search one Network](0299-two-pickers-search-one-network.md)
