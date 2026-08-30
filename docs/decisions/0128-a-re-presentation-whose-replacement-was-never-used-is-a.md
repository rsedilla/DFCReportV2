# 2026-08-27 — A re-presentation whose replacement was never used is a retry


Raised by the first web screens, which are the first code to hold a refresh token.
§6 defined rotation, the reuse signal, and the 2026-08-21 exemption for simultaneous
presentation, and said nothing about the case a client actually meets most often on a
phone: a refresh whose **response** was lost.

The client cannot tell that apart from a request that never arrived — `fetch` reports
both identically — and it is then holding a token the server has already spent. Its
only two options were to discard a credential that may still be live, or to present it
again and be treated as a thief. The second signs a leader out of every device for a
dropped connection, which is the cost the simultaneous-presentation rule already
refused to accept, one step further out.

**The server can tell them apart, because theft forks the chain and a lost response
does not.** An attacker presents the old token while the real client has moved on to
the replacement, so two chains advance and the replacement is used. A client that
never received the replacement cannot ever have used it. So *rotated token presented,
replacement exists, replacement never used* is the signature of a lost response, and a
used replacement is the signature of a copy in circulation. That is a statement about
what the rows show rather than about intent, which is what makes it checkable.

**A window bounds it, and the bound is the part that keeps the signal.** A retry
follows its failed request by seconds. With none, a token stolen from a device long
afterwards — whose owner never returned, so the replacement sits unused — would find
that replacement waiting. Sixty seconds, measured from the rotation.

*The window was not in the proposal this was approved from, and is an addition rather
than a detail.* Without it the rule is strictly weaker than §6 was, because it hands
an attacker every abandoned chain in the system. It is recorded here rather than left
in a constant so that raising it later is visibly a security decision.

**Two costs, accepted in writing.** An attacker who presents a stolen token *before*
the real client retries is served, and is detected one step later when the client's own
retry finds the chain advanced — the same shape the simultaneous case already accepts.
And nothing is served twice: the retry advances the chain and revokes what it advanced
from, so only one party ever holds the newest token.

**The existing reuse test was changed deliberately, and that is the part to check.**
It presented the first token again with its replacement untouched — which is exactly
the lost-response shape, so under this rule it is served rather than revoked. Weakening
its assertion would have been the obvious wrong move. It now establishes the fork by
rotating the replacement onward first, which is the genuine theft signature, and two
cases were added either side: the retry is served, and the same shape outside the window
revokes as before.

Written to `SKILL.md` §6, checked by grep rather than asserted.

---

Decision 0128 of 155, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-27 — An idempotency key belongs to a body, not to an attempt](0127-an-idempotency-key-belongs-to-a-body-not-to-an-attempt.md) | Next: [2026-08-28 — Membership and order disclose as loudly as fields did](0129-membership-and-order-disclose-as-loudly-as-fields-did.md)
