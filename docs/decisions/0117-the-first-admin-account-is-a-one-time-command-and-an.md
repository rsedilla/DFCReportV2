# 2026-08-25 — The first Admin account is a one-time command, and an administrator need not be in the tree


Every account is provisioned by somebody holding `accounts.manage`, which only
Admin holds (§7). So the first Admin cannot be provisioned by anybody, and nothing
in the system could create it. §7 and §21 both left a nullable column justified by
this exact moment — `account_roles.granted_by` "for the first Admin account,
granted by a system action", and `audit_log.actor_id` "only for a system action" —
and no code had ever used either.

**A command, not an endpoint.** §7 keeps a closed list of routes reachable without
authentication, and an unauthenticated route that mints the most powerful account
in the system is the wrong thing to add to it: if its emptiness check is ever wrong,
or two requests race it, whoever reaches the server first holds the church's
records. That is a well-known way to lose an application, and the convenience it
buys is used once in the lifetime of an installation.

A command has no such surface, and rests on the argument §2 already accepts for the
import script: whoever can run it can reach the database directly, so it is not
authentication. What it buys is that the one write nobody can be named for happens
deliberately, once, and is recorded as what it was.

**It writes rows rather than calling the domain services**, which both require an
actor and an idempotency claim that do not exist yet. §2's rule that imports run
through the services exists because a script "bypasses every service-layer check" —
but this repository has since moved the §5 invariants into constraint triggers and
partial unique indexes, so a direct write meets every one of them. What is reused is
everything a second implementation would drift from: token minting and hashing, the
audit row shape, and the sex-to-Network mapping.

The alternative was a "system actor" value passed to the services, and it was
rejected rather than merely not chosen. It means introducing an actor that *passes
authorization checks* into services whose whole job is enforcing them — a permanent
concept, readable by everyone, added for a need that arises once. The first person
to reuse it "just for this script" has a back door.

**It refuses while any account exists, and takes the lock before it looks.** The
refusal is what makes it one-time rather than a standing privilege. The lock is
because two runs would otherwise both find an empty table and both create an Admin,
which is the failure the refusal exists to prevent — the same shape as the
`SENIOR_PASTOR` counting trigger recorded on 2026-08-21, and avoided here rather
than after a review found it. The check is "any account", not "any Admin": a system
already in use is not a fresh installation whatever roles it holds.

**It prints the activation token rather than emailing it**, which is a deliberate
departure. §6 keeps activation tokens out of API responses because an administrator
must not learn another person's — and here the operator *is* the holder, standing
at the machine. The reason is recovery: if delivery failed for this one account
there would be no Admin to re-send from and no way back, since the command refuses
to run twice. The cost is a token in terminal scrollback, accepted for one that is
single-use, short-lived, and read by the person who just typed the command.

**§5 invariant 3 gains a third legitimate case.** It said zero open assignments is
legitimate in "exactly two situations" — not yet assigned, and archived. Both are
transient: a Person in either is one something will eventually happen to. An
administrator who is not discipled by anyone is in the correct *permanent* state,
and calling that "not yet assigned" invites somebody to go looking for the missing
leader and attach one — putting a person in the pastoral tree who does not belong
to it, counted in a subtree that does not contain them, with no report ever saying
so.

Neither placement is preferred. An administrator who *is* part of the church is an
ordinary Person under their own leader, and the command takes a leader for that.
What is forbidden is inventing one so that a record looks complete.

**The writing lives in `src/admin/bootstrap/first-admin.ts` rather than in the
script**, split the same way and at the same seam as the tree-CSV validator,
because a script cannot be tested and §6 now states four rules that would otherwise
have nothing able to fail on them. Nine cases pin them.

**One implementation lesson, recorded because it cost three blind runs.**
`NestFactory.createApplicationContext(AppModule, { logger: false })` reports a
failure to build the context *through the logger it was just told to silence*, and
then exits — so a missing `JWT_SECRET` produced exit code 1 and no output at all,
before any `catch` in the file could run. It is `['error', 'warn']` now, and the
comment says why rather than leaving the next person to rediscover it.

**And the writes go through the modules that own the tables**, which the first
version did not. It inserted into `persons`, `person_lifecycle`,
`network_assignments`, `accounts` and `account_roles` directly, justified against
§2's *imports* rule — a different sentence from "a module owns its tables. No other
module reads or writes them directly", which carries no exemption and which this
repository defended once already at the cost of restructuring the module graph
(2026-08-24). `people` and `auth` each gained one narrow method with one caller;
`admin/bootstrap` now writes no table at all, which is greppable rather than
asserted.

**That change surfaced a second thing, and it is the more useful lesson.** The
script ran under `tsx`, whose esbuild backend does not implement
`emitDecoratorMetadata` — so Nest cannot read the constructor parameter types it
resolves providers by, and every dependency injected without an explicit
`@Inject(...)` arrives `undefined`. It runs under `ts-node` now.

The first version appeared to work only because the three services it happened to
use inject everything explicitly. Routing through `PeopleService`, which does not,
is what exposed it — a whole class of silent failure that no test could see,
because `ts-jest` compiles the tests properly and only the *script* was affected.
`migrate.ts` and `validate-tree-csv.ts` stay on `tsx`: neither builds a Nest
context.

Written to `SKILL.md` §5 (invariant 3) and §6 (*The first Admin account*), and
verified by grep rather than asserted.

---

Decision 0117 of 155, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-25 — A generational suffix lives in `last_name`, and a title lives nowhere](0116-a-generational-suffix-lives-in-lastname-and-a-title-lives.md) | Next: [2026-08-26 — A module's tables are never written by another, and read by one only where the query is rooted elsewhere](0118-a-modules-tables-are-never-written-by-another-and-read-by.md)
