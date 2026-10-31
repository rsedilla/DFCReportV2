# 2026-11-01 — A pause after ten wrong passwords, and the Admin is told

Owner ruling, chosen on 2026-11-01 from screenshots of today's sign-in refusal, today's
per-minute limit and the proposed pause, side by side. Points 6 to 8 were settled the same day,
on the owner's answers to three questions `architecture-guardian`'s review of the build raised,
and point 7 narrowed to one browser on the owner's answer to its second review.

## What was missing

Section 24 limits sign-in to 10 requests a minute from one address. Somebody guessing one
leader's password from many addresses, or slowly from one, met no limit at all: nothing
counted wrong passwords for an account.

## The ruling

**1. Ten wrong passwords for one email address or username, as typed, within fifteen minutes
pause sign-in for it for fifteen minutes, from every device and address.** The tenth wrong
password and every attempt while the pause lasts, the correct password included, are answered:
"Sign-in for this username is paused for 15 minutes after 10 wrong passwords. To get in now,
use "I have forgotten my password"." Where an email address was typed, it says "this email
address" (decision 0337 words the ordinary refusal the same way).

**2. It counts the name whether or not an account holds it, with the same words either way**,
so a pause says nothing about whether an account exists. Wrong passwords for an account
awaiting activation, or disabled, count like any other, because sign-in already answers them
alike.

**3. A correct password before the tenth starts the count again, and a completed password
reset ends the pause.** "I have forgotten my password" keeps working during it.

**4. Today's limit of 10 sign-ins a minute from one address stays.**

**5. Each active Admin is emailed about a pause** (the first of the two alerts on the security
checklist), with no new screen.

**6. The Admin is emailed about one account at most once a day, and twenty times a day in
all.** Without a cap, somebody trying many names could set off an alert every few minutes and
spend the mail provider's daily allowance, after which reset emails, the way out the pause
names, would stop going.

**7. For fifteen minutes after a completed reset, the browser that completed it signs in with
the right password even if the name is paused again.** Otherwise somebody could re-pause the name
the moment a reset cleared it and keep its holder out for as long as they kept trying. Only that
browser: a first version let any device's right password through, and to do so stopped counting
every device's attempts for those minutes, which let somebody guess without limit from as many
addresses as they had, and ended for the holder at their first sign-in.

**8. Each pause of a name an account holds is written to the audit log.** A name nobody holds
is not, so strangers' typing does not fill the log.

## How it is built, where the owner's words left a choice

- **An address and a username of one account are counted apart.** Counting them together would
  pause a held name typed both ways sooner than a name nobody holds, and that difference would
  tell an attacker which names are held. So somebody can try ten passwords with the address
  and ten with the username in fifteen minutes; point 2 is worth more than that half.
- **The answer is `RATE_LIMITED`** (Section 22), carrying `details.reason` `SIGN_IN_PAUSED` so
  the sign-in screen shows the owner's words rather than the minute's, and `details.paused_until`
  so a client does not retry within seconds as it may for a per-minute limit. That instant is
  absent only when ten attempts are still being checked and no pause exists yet.
- **The Admin is emailed only where an account holds the name**, for the reason point 8 gives.
  The email names what was typed, whose account it is, and when it opens. A day is a Manila day.
- **The audit entry is a system action**, with no actor: nobody signed in caused the pause. It
  targets the account and stores the name as it was compared (`email:…` or `username:…`), when
  the pause opens, and whether the Admin was emailed. Sections 6 and 7 now name it among the
  writers permitted a null actor.
- **The audit entry and the email are made after the answer is sent**, so the answer takes no
  longer for a held name than for one nobody holds, and a failing mail provider changes nothing
  sign-in answers. A failure to write either is logged.
- **Point 7's browser is known by a proof.** A completed reset answers `200` with
  `sign_in_proof`, a random value whose SHA-256 is stored beside the pause; the browser keeps it
  for fifteen minutes and sends it as `reset_proof` when signing in. With it, that browser's
  attempts are admitted through a pause and not counted, and a wrong password is answered as the
  pause. Without it, every attempt is refused as the pause, so nobody else gets a guess; that
  browser's signing in leaves the pause in place for everybody else. Signing in once keeps the
  allowance for the rest of the fifteen minutes. The reset route answered
  `204` with no body before; nothing but the web client calls it.
- **The count is kept in the database**, in two new tables, `sign_in_pauses` and
  `sign_in_pause_alerts` (migration 0035), so a restart or a deploy does not clear it. Each
  attempt is counted before its password is checked, so attempts sent together cannot slip past
  the count. A row nobody has touched for a day is removed; it holds what strangers typed, and
  is not history. The audit log is the history.

## What it does not change

Who may sign in, the second sign-in step, the reset flow, or Section 24's per-address limits.

Decision 0413, indexed in [CLAUDE.md](../../CLAUDE.md) and amended into [SKILL.md](../../SKILL.md)
Sections 6, 7, 21, 22 and 24.

Previous: [2026-10-31 — A Privacy Notice, linked from the sign-in page](0412-a-privacy-notice-on-the-sign-in-page.md)
