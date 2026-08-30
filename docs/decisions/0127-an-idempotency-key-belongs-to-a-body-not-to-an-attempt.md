# 2026-08-27 — An idempotency key belongs to a body, not to an attempt


Escalated by the second review of the people screens, and it is a rule §22
implied and never stated — which is how the first fix for it inverted into a
permanent block on creating a Person.

**A client holds one key for as long as what it will send is unchanged. A changed
body is a different logical write and takes a new key. Only a bare retry of an
unchanged body reuses one.**

The reasoning is entirely inside §22 already: a 4xx is stored against the key,
and the same key with a different body is `IDEMPOTENCY_KEY_REUSED`, which §22
makes permanent and never to be retried. Put together, a client that holds one
key across a change to its own request locks itself out with nothing it can do
next.

**The duplicate-acknowledgement flow is where it bites first, and it looks like
one write when it is two.** The refusal asking for acknowledgement is a 409, so
it is stored; the resubmission adds `acknowledged_duplicate_ids`, so the
fingerprint differs and the second request is refused for ever. The Person can
never be created — which is exactly the block §3 says must never happen, and
which the 2026-08-23 ruling calls worse than the duplicate it guards against.

Every refusal that leaves something to correct behaves the same way: a
`SCOPE_DENIED` on the pastoral leader, a cross-Network refusal, a validation
failure on one field. The client mints a new key on each of them.

**Recorded as a rule rather than a fix because it is not discoverable from a
green test suite.** The defect was invisible to 79 browser tests: the mock
answers 409 to every POST and models no idempotency store, so the second request
never reaches the outcome that fails. Three client surfaces consume this API and
the native ones cannot be force-updated, so each would have rebuilt it.

Written to `SKILL.md` §22, checked by grep rather than asserted.

---

Decision 0127, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-27 — `field-invalid` follows the field, not the error code](0126-field-invalid-follows-the-field-not-the-error-code.md) | Next: [2026-08-27 — A re-presentation whose replacement was never used is a retry](0128-a-re-presentation-whose-replacement-was-never-used-is-a.md)
