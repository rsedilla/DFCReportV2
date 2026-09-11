# 2026-09-11 — `NODE_ENV` is required, and an absent one refuses to start

Decision 0236 recorded this as a Stop Condition, because a credential-writing decision had
come to hang on a variable nobody had to set: `loadConfig` resolved an absent `NODE_ENV` to
`development`, and the first two versions of that ruling's guard read the resolved value.

**`NODE_ENV` joins `DATABASE_URL` and `JWT_SECRET` as required.** An absent one refuses to
start.

## What actually changes, which is less than the bullet implied

Reading the loader is what narrowed this. `??` defaults on null and undefined and not on the
empty string, so a **blank** `NODE_ENV` already reached the validation and was already
refused, and so was any value outside the three names. The only case that silently meant
`development` was the variable being **absent entirely** — which the committed template never
produces, because `api/.env.example` ships the key.

So this changes one case. It is worth a ruling anyway, and the reason is below rather than
in the cost.

## The argument is that two ways of asking become one

**Nothing reads the resolved value.** `nodeEnv` is declared on `AppConfig`, computed,
validated, assigned, and consumed nowhere in `api/src` or `api/test` — the only mention
outside the loader is a test fixture supplying it to satisfy the type. The one environment
decision in the codebase, decision 0236's transport guard, reads `process.env.NODE_ENV`
directly, and its docblock exists to explain why.

That is the trap. A reader reaches for the resolved field because it is there, and it lies
about an absent variable. **It caught decision 0236 twice** — once refusing `production` by
name, once stating the rule positively against the same defaulted value.

**Requiring the variable makes the two identical.** The resolved value can no longer differ
from the raw one, so the guard may read either, the docblock explaining the difference
stops being needed, and a future consumer of `config.nodeEnv` is safe by construction
rather than by having read this ruling.

## What was rejected

**Removing the unused field.** It would have left an absent variable still meaning
`development`, and made every future caller re-decide what absent means at its own point of
decision. That is the same rule in many homes, which this project keeps paying for.

**Stating the rule and changing nothing.** It leaves a field nothing reads sitting exactly
where the next person reaches for it, which is what happened twice.

## The environment's own consequence

This is deployment work as much as configuration: no script sets `NODE_ENV`, and there is
no deployment artefact in this repository at all — no Dockerfile, and `docker-compose.yml`
defines only PostgreSQL. So the first deployment procedure written here must set it, and
now finds out at startup rather than by a transport binding it never intended.

---

Decision 0240, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-11 — A Cell coverage denominator is the month's whole schedule](0239-a-cell-coverage-denominator-is-the-months-whole-schedule.md)
