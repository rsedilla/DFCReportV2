# 2026-11-17 — An offline page for the installed app

Owner ruling of 2026-11-17, chosen from screenshots of the page on a phone, a phone in dark
mode and a laptop.

## What was missing

Opened with no connection, DREAMS showed the browser's own "No internet" page, which on a
phone's home screen reads as the app being broken. Decision 0424 says the application keeps no
offline copy of itself, and that working offline takes a ruling first.

## The ruling

**1. Opened with no connection, DREAMS shows its own page**: the logo and the name, *You're
offline*, "DREAMS needs the internet to open. Check your Wi-Fi or mobile data, then try
again.", a box saying unsaved attendance marks are kept on the device (decision 0345), and a
*Try again* button. It opens DREAMS by itself once the connection is back.

**2. The device keeps that page and its logo, and nothing else.** No screen of the
application, no script of the build and no answer of the API is kept. So the application
still opens the version on the server every time, and nothing a leader reads can be old.

**3. This is not working offline.** A leader still needs a connection to read or record
anything, and decision 0424's point 6 stands: working offline takes its own ruling. Because no
part of the application is kept, Section 22's permission to narrow `/api/v1` in step with the
web application is untouched.

**4. Only opening a page is answered.** A connection lost while a screen is already open
shows that screen's existing notice, as before.

**5. Nobody reinstalls.** A device takes the page the next time DREAMS is opened with a
connection. A device that has not done so since the release shows the browser's own page, as
before.

## What it does not change

What is kept of attendance marks (decision 0345), the idle sign-out or the length of a session
(decisions 0435 and 0450), or any API route. The security headers are unchanged: the policy
already allows a script of this site.

---

Decision 0497, indexed in [CLAUDE.md](../../CLAUDE.md) and amended into [SKILL.md](../../SKILL.md)
Sections 2 and 23.

Previous: [2026-11-16 — Every account holder ticks that they have read the Privacy Notice](0496-every-account-holder-ticks-that-they-have-read-the-privacy-notice.md)
