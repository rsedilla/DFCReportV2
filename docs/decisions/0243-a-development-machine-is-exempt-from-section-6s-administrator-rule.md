# 2026-09-11 — A development machine is exempt from Section 6's administrator rule, and Section 6 says so

Section 6 states, among the password-reset rules: **"Do not let admins know or choose
another user's password."** Decision 0236 shipped a development email transport that writes
every message to a directory, activation and password-reset tokens included. A reset token
is a credential for somebody else's account, so whoever can read that directory can take
that account over without ever knowing a password.

That was recorded as a Stop Condition rather than fixed, because decision 0236 **assumed**
an answer instead of supplying one.

## The ruling

**A development machine is exempt, and Section 6 now states the exemption and its boundary
rather than leaving it implied.**

The rule binds deployed environments. It is about an administrator of a running church
system reaching a member's credential, which is a statement about people who are not the
operator and data the operator did not create.

## Why the exemption is real rather than convenient

**The operator already holds everything the outbox could give them.** A development machine
runs against a database the operator owns, with `DATABASE_URL` in their own `.env`. They can
read `account_tokens` directly, and they can mint a token by calling the service. The outbox
grants no access that was being withheld; it saves a query.

**The data is not the church's.** `CLAUDE.md` requires test fixtures to be invented, and a
development spine is one the operator loaded themselves. The person whose token is written
is a fixture or the operator's own demo account.

**The boundary is already enforced, positively.** `loadConfig` refuses to start unless
`NODE_ENV` is explicitly `development` when `EMAIL_TRANSPORT=outbox`, and decision 0240 made
`NODE_ENV` itself required so an absent one cannot resolve to `development` by default. The
exemption therefore has something that fails on it, which is the standard this repository
holds a conformance claim to.

## Why not the two narrower answers

**Restricting the outbox to activation and refusing a password reset** draws a real
distinction — activation is a first credential for an account nobody has used, a reset is a
takeover of one somebody is using. It was refused because the distinction does not survive
the premise: on a development machine the operator can mint either token directly, so
refusing to *write* one withholds nothing and costs the ability to exercise the reset flow
end to end. A rule that prevents nothing and blocks a test is decoration.

**Refusing to write the token at all** is the strictest reading and changes nothing about
who can do what, for the same reason. It would also remove the one thing the outbox was
built for: activating a development account, which is how the demo accounts became
reachable at all.

## What the exemption does not cover

**It is not an exemption for `test`.** `api/test/setup/env.ts` pins `NODE_ENV=test`, so no
end-to-end case can bind the outbox adapter. That stays true and is now deliberate rather
than incidental: the suite runs against a database it truncates before every case, and a
transport writing credentials to disk has no business in it.

**It is not an exemption for a shared development host.** The argument above rests on the
operator being the only person with access to the machine and to the database behind it. A
development environment several people reach is a deployed environment for this purpose,
whatever its `NODE_ENV` says, and Section 6's rule binds it.

**It changes nothing in production.** The transport cannot bind there, and a real provider
joins the switch rather than replacing it.

---

Decision 0243, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-11 — Section 2 argues the shape, and a derived ledger holds the instances](0242-section-2-argues-the-shape-and-a-ledger-holds-the-instances.md)
