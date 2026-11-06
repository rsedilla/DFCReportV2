# 2026-11-06 — A session ends thirty days after its sign-in, seven for an Admin or Senior Pastor

A refresh token lived thirty days from its issue and was replaced on every use, so each renewal
moved the thirty days forward. A browser session ends after thirty minutes without activity
(decision 0435), but a session in the app installed on a phone has no idle limit, so one that was
used at least once a month never ended. The 2026-11-02 security audit raised it: a lost phone,
unlocked, stays signed in to members' details for good. The owner chose on 2026-11-06, from
screenshots of the sign-in page, thirty days for a leader and seven for an Admin or Senior
Pastor.

## The ruling

**A session ends a fixed time after its sign-in, however often it is used**: thirty days, and
seven for an account holding `ADMIN` or `SENIOR_PASTOR`, the accounts that read the whole church.
Renewing a session no longer moves its end. A browser session still ends sooner when idle
(decision 0435); this bounds every session, the installed app's included.

**The sign-in page says why.** A renewal refused for this answers `UNAUTHENTICATED` with
`details: { reason: 'SESSION_AGE', days }`, after the checks that refuse a revoked or disabled
session, and the tab that tried to renew opens the sign-in page saying "It has been 30 days since
you signed in on this device. Sign in again to continue, to keep members' details safe." (7 for an
Admin or Senior Pastor). Any other refused renewal opens it plain, as before.

**It is no reuse signal**, a retry of a renewal whose answer was lost (decision 0128) included:
a session's end may fall seconds after a rotation, and reading that retry as a stolen token would
sign the person out on every device. A renewal that reaches the end while it waits is refused the
same way and spends nothing.

**How it is held.** Each refresh token carries `session_ends_at`, set at sign-in and carried
unchanged to every replacement, and its own `expires_at` never passes it, which a `CHECK`
constraint holds (migration `0044`). The length is read from the account's roles at sign-in; a
role cannot change after an account is provisioned, so it does not move during a session.

**Sessions already signed in** are given an end counted from the day the migration runs, thirty
or seven days on, rather than from a sign-in no row records. So nobody is signed out at
deployment, and every session, however old, ends within the limit after it. Nothing is
backdated.

## What does not change

The access token's fifteen minutes, a refresh token's rotation and reuse signal, the browser's
thirty minutes without activity, the second sign-in step (decision 0302), and a password change
keeping the device it was made on signed in (decision 0351), which keeps that session's end as
it was; a change made in the very instant that session ends does not keep it. Signing in again
starts a new session with a new end.

## Why these lengths

Thirty days asks a leader for their password about once a month, which is what the refresh token
already promised before renewal stretched it. The Admin and Senior Pastors sign in with a second
step and see the whole church, minors' records included, so a week bounds what a lost device
of theirs exposes; their sign-in is the authenticator code they already use.

---

Decision 0450, indexed in [CLAUDE.md](../../CLAUDE.md) and amended into [SKILL.md](../../SKILL.md)
Section 6.

Previous: [2026-11-06 — The duplicate check allows sixty a minute, and reads indexes](0449-the-duplicate-check-allows-sixty-a-minute.md)
(on its own pull request, #461, until it has merged)
