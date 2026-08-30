# 2026-08-24 — Three rulings the accounts work needed, settled before the code


§6 describes account provisioning, activation and password reset in enough detail
to build, and leaves three things undefined that an endpoint cannot avoid
answering. Each is amended into `SKILL.md` in the same change.

**A password is twelve characters minimum, 128 maximum, with no composition rule.**
§6 requires the holder to set their own password and §23 requires password managers
unobstructed, and neither states a length. Nothing in the system could refuse a
one-character password.

Length rather than complexity, because the accessibility conformance rests on the
managers. §23's criterion 3.3.8 permits a password only where a mechanism assists
in completing it, and support for managers is that mechanism — so a rule forcing a
symbol works against the thing conformance depends on, by pushing people toward
something short enough to retype. The maximum exists only to bound a hash, and
**the password is never truncated to fit**: hashing a prefix silently makes a long
password no stronger than its first *n* characters, and the holder cannot tell.

Refused with `VALIDATION_FAILED` on the request that sets it, never at sign-in,
where the stored password is whatever it was when it was set.

**An account is provisioned together with the role that qualifies it, and until
`cells` exists that means `ADMIN` or `SENIOR_PASTOR` only.** §6 ties a Leader
account to Cell leadership, which is Stage 3, so a provisioning endpoint built now
has nothing to check a Leader against.

Deferring the check was rejected. It is the shape this project keeps correcting —
a guard written as a comment — and the 2026-08-20 ruling on submission rolling up
to the nearest upline already refused to widen §6 for exactly this, on the grounds
that an account for someone who has not opened a Cell detaches "leader" from
"leads a Cell", which §11 makes non-negotiable. A `LEADER` provisioning request is
therefore refused with `INVARIANT_VIOLATION` rather than accepted: it is a rule
about what may be recorded, whoever submits it, which is the distinction §22 draws
against `SCOPE_DENIED`.

No new error code. §22's table is a minimum and adding to it is client-visible, and
`INVARIANT_VIOLATION` already means what this refusal means.

The two exceptions §6 names — Senior Pastor and Administrator — are exceptions to
the *qualification* and never to the workflow: each still gets an account created,
an activation email sent, and a password the holder sets. The first Admin account
remains the one exception to all of it, created by a system action because there is
no account above it (§7, `granted_by`).

**Provisioning is `POST /api/v1/accounts`, a new area in §22, and deliberately not
under `/auth`.** Everything under `/auth` is either on §7's closed unauthenticated
list or acts solely on the caller's own session, which is what makes that prefix's
exemption from the capability guard readable in one place. Provisioning is neither —
it is an administrative action on somebody else's Account, carrying
`accounts.manage` — and putting it there would mean the prefix no longer describes
one thing.

`POST /api/v1/auth/activate` joins the two reset routes §22 already documented,
because those three *are* on the unauthenticated list.

---

Decision 0104 of 155, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-24 — "Never by layer" is about modules, not about files inside one](0103-never-by-layer-is-about-modules-not-about-files-inside-one.md) | Next: [2026-08-24 — Four rulings the accounts review forced, and the escalation that prompted them](0105-four-rulings-the-accounts-review-forced-and-the-escalation.md)
