# 2026-11-04 — A browser session signs out after thirty minutes idle

A signed-in browser stayed signed in for thirty days whether or not anybody used it, renewing
itself quietly in the background (section 6). A leader who signed in on a laptop others use and
walked away left DREAMS open to whoever sat down next, members' names, birthdays and mobile numbers
among it, children's too. On 2026-11-04 the owner asked for an idle sign-out. They were shown how
banks, government portals and Google handle it, the NIST and OWASP guidance, and the warning and the
signed-out notice on the real screens, and chose thirty minutes in a browser, leaving the installed
home-screen app on a phone or tablet as it is.

## The ruling

**1. A session begun in a browser signs out after thirty minutes with no activity.** Activity is a
click, tap, key, scroll or pointer movement in any DREAMS tab of that browser; every tab of one
browser profile is one session (decision 0125), so working in one tab keeps the others signed in. At
twenty-eight minutes a box asks "Are you still there?", counting down the last two, with *Stay
signed in* and *Sign out now*. At thirty the session is signed out as *Sign out* signs it out, and the
sign-in page says it was signed out after thirty minutes without activity.

**2. A session begun in the app installed on a phone or tablet's home screen keeps the thirty
days.** The device it is on is its holder's own and locks itself. An app installed on a computer,
which Chrome and Edge also offer, signs out as a browser does (owner, 2026-11-04, after
`architecture-guardian` raised it), since a shared computer is the case this exists for. The web
client tells the server at sign-in which of the two a session begins in (`session_kind`, `BROWSER`
by default, or `INSTALLED`), on the password step and on the second step (decision 0302) alike; it
counts a page as the installed app when it runs standalone, by the browser's own report, on a
device whose main pointer is a finger. A computer whose main pointer is a finger, a touch kiosk or
a two-in-one in tablet mode, counts as a tablet; that is the edge of the test, not a choice about
such devices.

**3. The server holds a deadline of its own for a session that says it began in a browser.** Its
refresh token carries an idle deadline, thirty-five minutes after it was issued, and each rotation
issues the replacement with a fresh one; a refresh after the deadline is refused as an expired one
is, and is not a reuse signal. The client renews the session on any activity two minutes or more
after its last renewal, because a page that asks the server for nothing would otherwise let the
deadline pass under somebody reading it; an idle tab renews nothing. So while renewals succeed,
the server's deadline falls at least thirty-three minutes after the last activity, after the
client's warning and its sign-out, which stay the ones somebody meets.

**4. A session signed in before this carries no server deadline** until it signs in again, since
nothing recorded says whether it began in a browser or the installed app and none is backdated;
each rotation copies that none. In a browser it is still signed out by the client after thirty
minutes idle, like any other.

**5. An idle sign-out is a sign-out.** Attendance marks kept on the device and not yet saved are
deleted with it, as decision 0345 already deletes them whenever somebody signs out; the warning says
so.

## Why

Thirty minutes is the inactivity limit revision 3 of NIST SP 800-63B sets at its second assurance
level, and at the long end of the fifteen to thirty minutes OWASP gives; a leader who clicks,
scrolls or types at least once every twenty-eight minutes is never interrupted. The installed app
is exempt because the risk it answers, a shared computer left signed in, is not a phone's, and
signing leaders out of their own phones would be friction with no protection behind it.

The client's sign-out alone would be a convenience, since anybody holding the token could keep
renewing it; the server's deadline is what makes it a control against a session left behind. It is
not a control against the person signing in: the session's kind is what the client says it is, so a
client that says `INSTALLED` carries no server deadline. The owner accepted that on 2026-11-04,
since no website can check it and the risk it answers is a session somebody walked away from. A copied access token still lives its
fifteen minutes, which this does not change.

On Android the installed app and the browser share their storage, unlike on iPhone, so a session
begun in one is the session of the other. A browser session opened in the installed app may sign
out once when idle, after which signing in from the app begins an installed one; a session begun in
the installed app and opened in a browser tab is still signed out by that tab when idle, without the
server's deadline behind it.

---

Decision 0435, indexed in [CLAUDE.md](../../CLAUDE.md) and amended into [SKILL.md](../../SKILL.md)
Section 6.

Previous: [2026-11-04 — Late lasts three weeks](0434-late-lasts-three-weeks.md)
