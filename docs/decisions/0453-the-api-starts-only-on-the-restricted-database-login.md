# 2026-11-07 — The API starts only on the restricted database login

Section 24 requires least-privilege database credentials, and Section 5 leans on them: `TRUNCATE`
fires no row trigger, so it empties a table past the rule that records are never deleted, and the
protection is meant to be that the application's login cannot run it. Production has such a login,
set up by hand. The security audit of 2026-11-02 found that nothing in the repository set it up or
checked it: a server rebuilt from the README would connect as the tables' owner and nobody would
know, and a migration that added a table needed a grant nobody was reminded of. The owner chose,
from the three options shown on 2026-11-07, all three of these.

## The ruling

**In production the API refuses to start unless its database login is the restricted one.** It
checks, in one query when it starts:

- **Too much:** the login is a superuser; owns the database, the `public` schema or a table
  (directly or through a role it belongs to); can create in `public`; or can `TRUNCATE` a table.
  An owner of the schema or the database can drop a table outright, which no trigger sees.
- **Too little:** it lacks `SELECT`, `INSERT`, `UPDATE` or `DELETE` on a table, or the use of a
  sequence. The migration runner's own history is left out, because the API never reads it.

The message names the login and each problem, as a missing secret's does, so a deploy shows it at
its health check before anybody signs in.

**`api/scripts/restricted-login.sql` sets the login up**, run once per database as a superuser,
naming the API's login and the tables' owner. It gives the API's login read and write on every
table and the use of every sequence, nothing on the migration history, and **the same on every table
and sequence a later migration creates**, so no grant is made by hand again. Running it twice changes
nothing. Creating the login itself, with its password, stays a step on the server, because a password
does not belong in the repository.

**The commands run on the server are checked too.** `generate:dcc`, `bootstrap:admin`,
`import:tree` and the second-step reset start the same application, so with `NODE_ENV=production`
they refuse on the same logins and must run on the API's login. Only the migrations run on the
owner's.

**The script runs before the restart that deploys this.** The production login's grants were made
by hand table by table, and if one was missed the API now refuses to start until the script has run.

**A development machine and the test suite are not checked.** They connect as the tables' owner,
which is how the suite empties them between cases.

## Why

Refusing rather than warning: a warning sits in a log nobody reads while the protection it reports is
missing, and the API already refuses to start without a valid `NODE_ENV`, `JWT_SECRET` or `DateStyle`.
Checking too little as well as too much: a forgotten grant otherwise surfaces as an error on whichever
screen first reaches the new table, in front of a leader rather than at the deploy.

---

Decision 0453, indexed in [CLAUDE.md](../../CLAUDE.md) and amended into [SKILL.md](../../SKILL.md)
Sections 5 and 24. It retires the Open item on the application's database role.

Previous: [2026-11-07 — A person is archived, never removed](0452-a-person-is-archived-never-removed.md)
