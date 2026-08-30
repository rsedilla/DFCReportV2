# 2026-08-27 — `field-invalid` follows the field, not the error code


The question §23 left open once a real form existed. §22's envelope carries
`details.field`, and a client keying the colour on that alone paints messages red
that point at nothing the reader can fix.

**Where the form does not render the field the failure names, the message is
form-level and carries no colour.** A reset link that expired answers
`VALIDATION_FAILED` with `field: 'token'` on a screen whose only input is a new
password, and the password is fine.

`details.field` is a hint for binding a message to an input. Where there is no such
input the hint does not apply, and the failure is not a statement that anything was
mistyped. The test is what the message is to the person reading it — which is the
test the token's name was settled on in the first place — so it reaches a server
error, a dropped connection, an expired link, and a session that ended while the page
was open, whatever code each arrived under.

Chosen partly because it is the cheapest to reverse: one predicate in
`web/lib/messages.ts`, no schema and no API change, so if it reads wrong on a real
screen it flips in a line. Written to `SKILL.md` §23.

---

Decision 0126 of 155, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-27 — Every tab of one browser profile is one session](0125-every-tab-of-one-browser-profile-is-one-session.md) | Next: [2026-08-27 — An idempotency key belongs to a body, not to an attempt](0127-an-idempotency-key-belongs-to-a-body-not-to-an-attempt.md)
