# 2026-10-14 — The title field, the rate limits and the retry window are written down

Three things the application already does that `SKILL.md` did not say. The owner chose on
14 Oct to write all three into the specification as they stand, changing no behaviour.

## The ruling

**Section 3's `persons` field list names `title`**, the optional field decision 0271 added:
blank is stored as null, it is shown before the name, and duplicate matching and search
never read it.

**A rate-limited request answers `RATE_LIMITED`, with HTTP 429** (Section 22). It is refused
before any idempotency key is claimed, so it is retried after a short delay with the same
key. Section 24 states the limits: 120 requests a minute by default; 10 a minute on each sign-in step
(sign-in, the second step and its setup), on activation and its username suggestion, on
setting a password from a reset link, and on reading a suggested username or setting one;
5 a minute on asking for a password reset; 30 a minute on refreshing a session; and 30
church-wide searches a minute (decision 0303). Each limit counts the requests made to one
route; the church-wide search has its own count, beside the 120 its route allows. A request
carrying a valid access token is counted against its account, and every other request,
including every request to a route that needs no sign-in, against its address.

**The refresh retry window is sixty seconds** (Section 6, decision 0128), and a client may
rely on that figure.

## Why

Each was a number a client or a reader needed and could find only in the code, and two were
recorded as open questions for that reason: which code a rate-limited request answers, and
what window a client may rely on. Section 2's native clients cannot be updated at once, so a
figure they depend on belongs in the specification rather than in a constant. The figures
are the ones in force; choosing different ones would be a separate decision.

Decision 0344, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-10-14 — Three things shown twice are removed](0343-three-things-shown-twice-are-removed.md)
