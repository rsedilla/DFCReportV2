-- An account holds at most one of ADMIN and SENIOR_PASTOR (SKILL.md section 7).
--
-- Additive: one partial unique index, no column dropped and no data rewritten
-- (CLAUDE.md, Definition of Done -> Migration policy). Reversible.
--
-- Why it exists. Section 7 keeps `roles.manage`, `accounts.manage`,
-- `records.backdate_effective_date`, `people.merge` and `people.correct_sex` away
-- from SENIOR_PASTOR, and says why: the church's two highest-visibility accounts
-- cannot escalate their own authority, and every permission change involves a
-- second party. An account's effective authority is the union of its roles'
-- defaults, and ADMIN's set is a superset of SENIOR_PASTOR's -- so one extra row
-- makes that union ADMIN's own and every one of those exclusions void, for
-- exactly the two accounts they were written for.
--
-- It is self-perpetuating, which is what makes it worth a constraint rather than
-- a convention: such an account holds `roles.manage`, so it can grant itself
-- anything further and revoke anyone else's roles. No second party remains.
--
-- It would also neutralise the identity check on the same table. Where
-- SENIOR_PASTOR_PERSON_IDS is lost, that check refuses the SENIOR_PASTOR row and
-- the account falls to nothing, which is the deliberate fail-closed behaviour; an
-- ADMIN row beside it keeps the account at full authority and the control never
-- bites.
--
-- Why an index rather than a check in `auth`. The identity half of the
-- SENIOR_PASTOR rule has to live in the application because the database holds no
-- durable representation of who those two Persons are (section 7). This rule has
-- no such gap: role combination is entirely inside this table, so an index makes
-- the state unrepresentable rather than merely detected. It is also what survives
-- `pg_restore --disable-triggers`, which is the reason the SENIOR_PASTOR cap is a
-- unique index and not a counting trigger.
--
-- Validated against existing data before enforcing, per the migration policy: no
-- deployed database exists, and no path in the API can have produced this state
-- in any case -- provisioning creates exactly one role on a new account and
-- refuses a Person who already has one, and `roles.manage` has no endpoint yet.
-- The rule is written before that endpoint rather than after it.
--
-- LEADER is deliberately outside the set. It confers strictly less than either
-- and carries none of the excluded capabilities, so it escalates nothing; and an
-- account may legitimately hold it beside a governing role.

-- migrate:up

CREATE UNIQUE INDEX account_roles_one_governing_role
  ON account_roles (account_id)
  WHERE revoked_at IS NULL AND role IN ('ADMIN', 'SENIOR_PASTOR');

-- migrate:down

DROP INDEX IF EXISTS account_roles_one_governing_role;
