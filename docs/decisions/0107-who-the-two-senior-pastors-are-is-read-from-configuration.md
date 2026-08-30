# 2026-08-24 — Who the two Senior Pastors are is read from configuration, and checked twice


The domain half of the `SENIOR_PASTOR` rule, which had no owning stage until Stage
2 and no source of truth at all. §7 caps the count in the database, says **which
two Persons** hold it is checked in `auth`, and rules out the obvious answers by
name — a flag on the Person, a reserved identifier — because either "would make
the two most consequential accounts in the church depend on a row somebody could
edit". It did not say what the check reads instead, so nothing could be built.

**It reads deployment configuration**, naming the two by Person identifier.

The test is not "is this outside the database" but **whether editing the source
would be an escalation for whoever can edit it**, and that disposes of the
alternatives without appeal to taste. A flag on the Person is editable under
`people.edit_basic`, which an ordinary Leader holds over their own subtree. A
`settings` row is editable under `settings.manage`, which is Admin's — and Admin
deliberately holds neither seat, so a setting is a route by which Admin names
themselves into one, collapsing the separation §7 builds by keeping
`accounts.manage` and `roles.manage` away from the Senior Pastors. Hard-coding the
two **names** from §4 and matching them against `persons` is the same defect one
indirection out, and additionally fights §3, which says a name is not an identity
and that a woman's surname may change.

The environment is editable by whoever deploys the API, and that person already
holds `JWT_SECRET` and can therefore mint a session for any account that exists.
Configuration is the only candidate whose editor gains nothing from it.

**Enforced at grant time and again at authority assembly.** Provisioning refuses a
`SENIOR_PASTOR` request for an unnamed Person with `INVARIANT_VIOLATION`, and
`AuthorizationService` drops a `SENIOR_PASTOR` row whose account belongs to anyone
else — so it yields no role default and no §5 invariant-4 exemption.

The second point exists for the reason the 2026-08-21 slot ruling gives for
preferring an index to a counting trigger: `pg_restore --disable-triggers` skips a
check that runs. A check made only where the row is written is skipped by a restore
in exactly the same way, so the identity half needs an enforcement point on the
path every request takes.

**A refused row therefore answers `CAPABILITY_DENIED` — where the capability it
would have carried is what the request needed.** *That qualifier was missing for two
review passes, and it was copied unqualified into `SKILL.md` §7 by the batch written
to close the false "written to §x" claim below.* A refused row has two consequences,
and the sentence covered one: it also withholds the §5 invariant-4 exemption, and an
actor holding the capability by any other route — a second role's defaults, or an
explicit grant at any scope that capability permits — reaches that check and
is refused `SCOPE_DENIED` — which §22 already settles for a domain-layer statement
about an actor's authority over a target, and which this branch's own test asserted
the whole time. §7 now states both, and the principle they share: the code names the
half that failed. Recorded because the rule was moved into the specification by
copying a sentence rather than re-deriving it against the two paths it governs, which
is §25 rule 19 inside the batch citing §25 rule 19.

*The first version of this
entry cited `single-scope.ts` as the precedent for the shape — "a row that cannot
mean what it appears to mean is honoured as nothing rather than in part" — and that
is the one thing `single-scope.ts` does not do.* `grantCoversNothing` is applied in
the **scope** half of `authorize`, and the 2026-08-24 ruling above records dropping
it at assembly as a live defect precisely because the account then looked as though
it held no such capability, turning a `SCOPE_DENIED` into a `CAPABILITY_DENIED`.
Citing that file while doing the thing it had removed is §25 rule 19 failing inside
the sentence claiming to apply it — the eighth time on this project, and the second
inside a batch written to observe it. Found by `architecture-guardian`.

The code is nonetheless right, for a reason of its own. The two cases differ on
whether the capability is held at all, which is the distinction §22's two codes
exist to draw. A narrow grant of a Whole Church capability **names** it, so the
account holds it and only the scope is unusable. A refused `SENIOR_PASTOR` row names
nothing, so it contributes none of the role's capabilities at any scope, and where
the account has no other source for the one being asked about, `SCOPE_DENIED` would
send an administrator to widen a scope that does not exist. An account holding a
second role keeps whatever that names.

*That qualifier was missing here from the day this paragraph was written, and the
paragraph then stood unrevised through both later correction batches — each of which
edited the text immediately above or below it.* A first attempt to record that said
it had been "dropped by three successive versions of this paragraph, including the
two written to correct it", which is false twice over: the paragraph had exactly one
earlier version, and neither correction batch touched it. Getting the history of a
wrong claim wrong is the same fault one layer out, and the true version is the worse
one — two passes read around this paragraph without reading it.
The cost is that on the accepted failure mode, configuration lost, a real Senior
Pastor is told they hold nothing while `account_roles` says otherwise; what resolves
that is the error logged at the refusal, which names both causes, and the code is
pinned by a test rather than left to be inferred.

*This rule reached `SKILL.md` §7 on the following review pass, not in the batch that
settled it — which is the **fourth** false "written to §x" claim on this project, and
the second in this entry's own vicinity.* It matters more than the others did: an
error code is client-visible and §7 states the contrasting `SCOPE_DENIED` rule
explicitly, so the specification carried one half of a distinction and not the other.
Nothing checks such a claim, which is why they keep happening; what would is a
reviewer grepping §7 for the rule rather than reading the sentence asserting it is
there.

**Absent configuration fails closed and the process still starts; malformed
configuration stops it.** A fresh installation must boot and run the import (§2)
before either Person exists to be named, so this cannot be a required value.
Absent, no `SENIOR_PASTOR` can be provisioned and an existing row confers nothing,
which is logged at startup. The availability cost is real and is accepted in
writing: a deployment that loses the variable strips both Senior Pastors of their
authority until it is restored. Fail-open was rejected — it would mean the check
protects nothing in exactly the circumstance where nobody has noticed it is gone.
A malformed value stops the process, because a typo produces the same silent
stripping and would be noticed last.

**The free-seat read stays unfiltered**, because the partial unique index it has to
agree with is. A row this rule refuses to honour still occupies its slot, and
offering that seat to a provisioning request would hand it a seat the insert then
rejects — replacing an answer with a constraint violation, which is the failure
§4's backdate floor and §22's error codes exist to prevent.

Written to `SKILL.md` §7 in the same change.

**One question is raised and deliberately not answered here.** Whether the mapping
is exclusive the other way — whether Bishop Oriel or Pastora Geraldine may hold an
`ADMIN` role on the same account — is not stated by §7, and an `ADMIN` row beside a
`SENIOR_PASTOR` one would defeat the separation §7 builds. It is a separate ruling
and is listed as unsettled below rather than decided in passing.

---

Decision 0107 of 155, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-24 — The authorization seam is its own module, and a cycle was the reason a rule was being broken](0106-the-authorization-seam-is-its-own-module-and-a-cycle-was-the.md) | Next: [2026-08-24 — Naming a Senior Pastor takes effect on the next restart](0108-naming-a-senior-pastor-takes-effect-on-the-next-restart.md)
