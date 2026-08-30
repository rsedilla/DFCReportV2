# 2026-08-27 — Every tab of one browser profile is one session


Ruled the day it was raised. `SKILL.md` §6 tracked a refresh token "per device or per
session" and §2 requires several concurrent sessions per account, and neither said
which a second browser tab is.

**One.** Tabs share the credential because `localStorage` is scoped to the origin
rather than to the tab, and signing out in one tab ends the session in all of them,
which is what "this device" means to the person holding it.

The consequence is the part worth writing down: a browser client **must** serialize
refresh across tabs, as a requirement and not an optimisation. Rotation makes the
previous token spent, so two tabs each reading the stored token and presenting it
independently produces a presentation landing *after* another has committed —
sequential, so the 2026-08-21 exemption does not reach it, and §6 revokes every
session on the account because somebody had two tabs open. An in-process guard cannot
close it, being per JavaScript context while the credential is shared across them.
The web client uses a Web Lock; anything giving the same guarantee is equivalent.

Per-tab credentials were rejected rather than merely not chosen. They remove the race
by giving each tab its own chain, and they make opening the application from a
bookmark in a new tab demand a password every time — while duplicating a tab copies
session-scoped storage anyway, reintroducing the race with none of the protection.

**The residual gap is where `navigator.locks` is absent**, and it closes for free if
the transit-failure item below is answered as proposed: with a server-side grace
window, a cross-tab race produces exactly the lost-response signature — the previous
token replayed, its replacement never used — and stops being a revocation event at
all. Two questions, one answer.

Written to `SKILL.md` §6, and pinned by a two-tab case in
`web/e2e/session.spec.ts` verified against a client with the lock removed.

---

Decision 0125, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-27 — What the web client does with a refresh token, pending three rulings](0124-what-the-web-client-does-with-a-refresh-token-pending-three.md) | Next: [2026-08-27 — `field-invalid` follows the field, not the error code](0126-field-invalid-follows-the-field-not-the-error-code.md)
