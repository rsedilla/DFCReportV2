# 2026-11-05 — Ten wrong codes pause an account's second step

The security audit of 2026-11-02 found that the second sign-in step bounded guessing per
sign-in only. A sign-in past the password allowed five wrong codes and then had to start again,
and nothing stopped it starting again at once. Somebody holding an administrator's or a Senior
Pastor's password could therefore keep starting sign-ins and try about fifty codes a minute from
one address, and more from several: a six-digit code would fall within hours. The owner chose
the fix on 2026-11-05 from screenshots of the code screen today and of the proposed answer.

## The ruling

**1. Ten wrong codes for one account within fifteen minutes pause its second step for fifteen
minutes**, counted across every sign-in, so a new sign-in does not start a new count. Wrong
authenticator codes and wrong recovery codes both count. A code typed while setting the step up
does not: whoever is setting it up holds the secret, so there is nothing to guess.

**2. While it lasts no code is checked, the right one included, and nothing is counted.** The
tenth wrong code, and every code after it until the pause ends, is answered `RATE_LIMITED` with
`details.reason` `SECOND_STEP_PAUSED`, `details.paused_until`, and "Sign-in to this account is
paused for 15 minutes after 10 wrong codes. Try again after 3:45 PM." (the time it opens, Manila
time). That sign-in is closed, and the screen returns to the password with those words. The five
wrong codes a single sign-in allows are unchanged.

**3. A right code starts the count again, and a reset of the step ends the pause.** A password
reset does not: only somebody past the password reaches the code, so a reset by whoever knows the
password must not reopen the guessing.

**4. The pause is written to the audit log and each active Admin is emailed** (`second_step.paused`,
a system action targeting the account, with when it opens and whether the Admin was emailed). The
email says that whoever typed the codes knows the password and asks the Admin to have the holder
change it if it was not them. It goes at most once a day for one account, counted apart from that
account's password-pause email, because a code pause is the worse news; the twenty alerts a day
are shared with the password pause (decision 0413). Both happen after the answer is sent.

**5. The count is kept in the database** (`second_step_pauses`, migration 0041), so a restart or a
second API instance does not reset it, and a row untouched for a day is removed. Like
`sign_in_pauses` it is transient security state and not history.

## Why

The password pause of decision 0413 bounds guessing at a name; nothing bounded guessing at the
code behind it, and the code is the only thing standing between a leaked password and the
accounts that read the whole church, minors' records included. Ten in fifteen minutes is what the
password pause allows, so a holder who mistypes is treated alike in both steps; at that rate a
six-digit code needs years. Counting per account rather than per address is what makes changing
address useless. A pause can be started by whoever has the password, which locks the holder out
for fifteen minutes; that is accepted, because such a person already holds the password and the
email tells the Admin so.

---

Decision 0441, indexed in [CLAUDE.md](../../CLAUDE.md) and amended into [SKILL.md](../../SKILL.md)
Sections 6, 21, 22 and 24.

Previous: [2026-11-05 — Closed Cells leave out those created in error, until asked for](0440-closed-cells-leave-out-those-created-in-error.md)
