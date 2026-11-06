# 2026-11-06 — A wrong current password counts in the sign-in pause

My Account asks for the current password before changing the password (decision 0351) or the
email address (decision 0415). A wrong one was refused on its field with no limit beyond the
route's ten requests a minute, so somebody holding a signed-in device, or a stolen session, could
guess at the password all day, and with it change the email address and take the account. Sign-in
itself stops after ten wrong passwords (decision 0413). The 2026-11-02 security audit raised it as
its fourth finding, and the owner chose on 2026-11-06, from screenshots of My Account, one count
shared with sign-in over a separate one.

## The ruling

**A wrong current password counts in the same pause as sign-in for the account's email address.**
Ten wrong passwords within fifteen minutes, from sign-in by that address and from the two My
Account forms together, pause all three for fifteen minutes. Until the tenth in the window,
wherever it was typed, a wrong one on My Account is answered as before, on `current_password`.
The tenth, and every current password while the pause lasts, the right one included, are
answered `RATE_LIMITED` with `details.reason` `SIGN_IN_PAUSED` and, as at sign-in,
`details.paused_until` where a pause exists yet, and the words "Paused for 15 minutes after 10 wrong
passwords. Signing in with your email address is paused too; this device stays signed in." A
right current password before the tenth starts the count again, as at sign-in. The username's
count stays its own, as at sign-in.

**A pause started on My Account has its own alert** (owner, 2026-11-06, a second choice made from
the two emails side by side). The sign-in alert would have said "Nothing needs doing to keep the
account safe", which is false when the guesser holds a signed-in session, and its once a day for
one account would have let a sign-in pause emailed that morning hide this one entirely. So it is
written to the audit log as `current_password.paused`, naming the signed-in account as the actor,
and each active Admin is emailed "10 wrong current passwords on My Account": somebody signed in
to the account typed them, sign-in with the address is paused until when, and the holder should
reset the password, which signs out every device. It is sent at most once a day for one account,
counted apart from the sign-in and second-step alerts as decision 0441 counted the second step;
the twenty a day in all stay shared. Migration `0042` admits the new kind.

**The device in use stays signed in.** Only checking the password, and signing in with the
address elsewhere, wait for the pause. "I have forgotten my password" keeps working, and a
completed reset ends the pause as before.

**A 429 is not stored against the idempotency key; it releases the key as a 5xx does.** Section 22
stored every 4xx, and a pause is answered with one, so the right password sent during a pause
would have been refused again for the whole retention, with the same body, after the pause had
ended. A limit is lifted by time and not by a different body, which is the release rule's own
reason. No other write endpoint answers 429 from the handler: a route's per-minute limit refuses
before the key is claimed. Section 22 now names `RATE_LIMITED` as its one exception, and
Section 5's `RESOURCE_BUSY` argument says so, so that a new transient condition still goes to
the 5xx side rather than joining it.

## Why

One shared count gives a guesser ten tries in fifteen minutes however they spread them, and it is
one rule to explain. A separate count would have kept sign-in elsewhere open while My Account was
paused, at the cost of ten more tries for each form.

**What it costs.** Anybody who knows the holder's email address can now, with ten wrong sign-ins
every fifteen minutes, keep the holder from changing their password or address on My Account, as
they could already keep them from signing in there. A reset still works, and ends the pause, but
its fifteen-minute allowance covers sign-in only, so My Account waits while somebody keeps
pausing the address again.

---

Decision 0448, indexed in [CLAUDE.md](../../CLAUDE.md) and amended into [SKILL.md](../../SKILL.md)
Sections 5, 6, 21 and 22.

Previous: [2026-11-05 — An emailed link's code leaves the address once the page has read it](0447-an-emailed-links-code-leaves-the-address.md)
