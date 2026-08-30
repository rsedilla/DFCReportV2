# 2026-08-24 — The authorization seam is its own module, and a cycle was the reason a rule was being broken


Escalated by `architecture-guardian`: `auth` was reading `persons` directly, which
§2 forbids. The obvious fix — ask `people` through its service — closed a module
cycle, because `PeopleModule` imported `AuthModule`.

**`src/auth/authorization/` becomes `AuthorizationModule`.** `people` imports that
rather than the whole of `auth`, and `auth` may then import `people`. The graph runs
`people → authorization`, `auth → people`, `authorization → {hierarchy, networks}`,
with nothing pointing back.

The point is not that it dodges a `forwardRef`. It is that **`people` never needed
`auth`** — it needed `AuthorizationService`, and importing a module of accounts,
tokens, controllers and provisioning to ask an authorization question was the defect
that made everything downstream awkward. `AccessTokenGuard` stays in `AuthModule`
because it needs `TokensService` and `AccountsRepository`: it authenticates, which is
a different question from what an authenticated actor may do.

**No §2 amendment is needed.** `AuthorizationModule` owns no tables; it reads
`account_roles` and `capability_grants`, which §2 gives to `auth`, and the ruling
above on intra-module seams puts an arrangement of files inside one module outside
§2's reach.

Two things are worth recording beyond the fix.

**The cycle was causing the violation, not merely blocking its repair.** Three
direct `persons` reads had accumulated in `auth`, each individually the path of least
resistance. `PeopleReadService.forDecisionWithin` replaces them, returning identity
and two lifecycle facts rather than a `PersonRecord` — a cross-module reader that
cannot receive a birthday or a mobile number cannot leak one.

**The split compiled, type-checked, linted, passed 117 unit tests, and broke every
authenticated request.** Nest resolves a provider's dependencies in the context of
the module that *registers* it, not the one its class lives in, and `CapabilityGuard`
is registered globally in `AppModule` — which imported `AuthModule`, which imports
`AuthorizationModule` without re-exporting it. `AppModule` imports it directly now;
re-exporting from `AuthModule` was rejected, because it would put the authorization
providers back into the surface the split had just removed them from and let the
cycle return unnoticed.

`test/unit/module-graph.spec.ts` closes the gap that let this reach CI at all.
Nothing running without a database built the application: `tsc` checks imports and
says nothing about the injector, and the unit suite never constructed `AppModule`.
`Test.createTestingModule(...).compile()` builds the injector without opening a
connection, so the whole class of wiring failure now fails on a developer's machine
in seconds. It is verified against the real mutation rather than assumed — removing
the import reproduces CI's exact message.

Stage 3 will ask this question again when `cells` needs authorization, and the
answer is that it imports `AuthorizationModule`.

---

Decision 0106, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-24 — Four rulings the accounts review forced, and the escalation that prompted them](0105-four-rulings-the-accounts-review-forced-and-the-escalation.md) | Next: [2026-08-24 — Who the two Senior Pastors are is read from configuration, and checked twice](0107-who-the-two-senior-pastors-are-is-read-from-configuration.md)
