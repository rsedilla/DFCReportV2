# 2026-08-27 — What the web client does with a refresh token, pending three rulings


Stage 2's screens are the first code to hold a refresh token, and section 6 does not
reach three of the situations one is actually held in. Two `architecture-guardian`
passes found the same thing from opposite directions: the first that the client
discarded a live credential on any failure, the second that the fix re-presented one
up to three times a page load. Both are section 6 questions the specification does
not answer, so what is recorded here is the **interim client behaviour**, and the
questions are listed as open below rather than settled in a component.

`SKILL.md` is deliberately **not** amended. These are not rules yet, and writing them
into the specification would settle by implementation what the log says must be
settled by decision — the failure this file's own preamble names in one line.

**All three questions this entry raised are now settled**, and each is recorded
under its own heading below: tabs are one session (§6), `field-invalid` follows the
field rather than the error code (§23), and — last, because it needed the API
change this entry could only scope — a re-presentation whose replacement was never
used is a retry rather than reuse (§6). All three are in `SKILL.md`.

The interim client behaviour described here therefore stops being interim. The client
still halts on a presentation whose outcome is unknown, and *Try again* is now safe
rather than a risk somebody is asked to weigh: inside the window, the server
recognises the replay as the retry it is.

**A presentation whose outcome is unknown halts the client.** `fetch` rejects
identically whether a request never arrived or arrived, rotated the row, and lost the
response. The second makes the stored token spent, so presenting it again is section
6's reuse signal and revokes every session on the account. The client therefore
neither discards the token — section 23 makes an unreliable connection the expected
case, and a tunnel is not a revoked session — nor presents it again on its own
initiative. It stops and says so, and only a person pressing *Try again* presents it
a second time. That makes the risk theirs to take knowingly, which is the most a
client can honestly do while the question is open.

**Refresh is serialized per origin, by a Web Lock.** `localStorage` is shared across
tabs while an in-flight guard is per JavaScript context, so two tabs opening together
each read one token and the later POST lands after the earlier has rotated —
sequential, so the 2026-08-21 simultaneous exemption does not cover it. Whether two
tabs *should* be one session is open; the lock does not decide it, because tabs
already share the credential. It stops the sharing being unsafe.

**A refusal discards; a failure does not.** A 401 means the credential is spent,
revoked or expired. A `VALIDATION_FAILED` means the stored value is not a token at
all, and is discarded too — otherwise `hasStoredSession()` keeps reporting a session
that can never be renewed and nothing redirects to sign-in. A rate limit or a 5xx
refused the attempt without spending the token, so it is kept.

**Section 23's `field-invalid` is decided from the error code, in one place.** Three
codes reach a screen without being a refusal of anything typed: `UNAUTHENTICATED` on
any request that is not a credential form, a `VALIDATION_FAILED` naming a field the
form does not render — `field: 'token'` for a spent link — and
`DUPLICATE_ACKNOWLEDGEMENT_REQUIRED`, which `api-error.ts` says in terms is not a
validation code precisely so that a client does not render it as a field error. All
three had acquired the colour by being rendered through the same component, which is
the drift section 23 predicts: a token is used by whoever writes the next screen, on
whatever it seems to fit.

---

Decision 0124 of 155, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-26 — Advice printed at the moment of a decision, and a fix claimed but not made](0123-advice-printed-at-the-moment-of-a-decision-and-a-fix-claimed.md) | Next: [2026-08-27 — Every tab of one browser profile is one session](0125-every-tab-of-one-browser-profile-is-one-session.md)
