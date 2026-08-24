-- The grant-making capabilities are never held by a Senior Pastor, however
-- granted (SKILL.md section 7).
--
-- Additive: two functions and two constraint triggers. No column dropped, no data
-- rewritten, reversible (CLAUDE.md, Definition of Done -> Migration policy).
--
-- Why it exists. Migration 0005 stops one account holding ADMIN and
-- SENIOR_PASTOR, and closed only one route to that authority. Section 7's role
-- catalog says "Anything beyond a role's defaults requires an explicit,
-- Admin-issued grant" and names no exception, so an explicit Whole Church grant of
-- `roles.manage` reached the same place with no ADMIN row and nothing violated --
-- and invisibly to the identity check, which filters role rows and not grants.
--
-- Why two capabilities and not the seven the table withholds. The seven are not
-- alike, and treating them alike was a simplification rather than section 7's
-- position:
--
--   * `roles.manage` and `accounts.manage` are the grant-making pair. A holder can
--     grant themselves the rest and revoke everyone else's roles, so the second
--     party section 7 requires is present when the grant is issued and never
--     again. That is self-perpetuating and unrecoverable by anybody but the
--     holder, which is what earns a constraint.
--   * `records.backdate_effective_date` and `people.merge` are argued by section 7
--     on different grounds -- they move totals for periods already reported -- and
--     each use is one audited operation that an Admin can still reverse the
--     authority for.
--   * `people.correct_sex`, `settings.manage` and `cell.approve_creation` are
--     withheld by the table and argued nowhere in section 7 at all.
--
-- So the five remain ordinary Admin-issued grants: audited, revocable, and needing
-- a second party every time. Only the pair that removes the second party
-- permanently is refused outright.
--
-- Why both directions. A rule enforced on `capability_grants` alone is walkable
-- from the other side: grant `roles.manage` to an ordinary account first, then add
-- the SENIOR_PASTOR row. Both triggers exist so that whichever row arrives second
-- is the one refused.
--
-- **Why the account row is locked, which is the part that is re-derived rather
-- than copied.** A deferred trigger sees only its own transaction's commit-time
-- state, so two concurrent transactions -- one inserting the role row, one
-- inserting the grant -- would each look, see nothing, and both commit. That is
-- exactly the defect the 2026-08-21 ruling records in the SENIOR_PASTOR counting
-- trigger, and the remedy there was a unique index. No index is available here,
-- because the rule spans two tables. So both paths take `FOR NO KEY UPDATE` on the
-- account first and are thereby serialized against each other.
--
-- `FOR NO KEY UPDATE` rather than `FOR UPDATE`: it conflicts with itself, which is
-- all that is needed, and does not conflict with the `FOR KEY SHARE` a foreign key
-- check takes -- so ordinary writes referencing the account are not blocked behind
-- it. That is the same reasoning section 6 records for the revocation lock.
--
-- A transaction touching several accounts locks them in the order its rows fire,
-- so two such transactions can deadlock and PostgreSQL will choose the victim.
-- Accepted rather than sorted: both writers act on one account at a time, and the
-- alternative is a statement-level trigger that cannot see per-row NEW.
--
-- Why DEFERRABLE INITIALLY DEFERRED, and the reason is **not** section 4's. There,
-- neither order works and an immediate trigger makes a mandated operation
-- unperformable. Here every conflict has a legal order -- revoke the grant, then
-- add the role -- so an immediate trigger would be satisfiable. It is deferred so
-- that the order is not a trap: a transaction that revokes a conflicting grant and
-- adds the role in the other order is doing nothing wrong, and reading final state
-- also means a row inserted and revoked within one transaction has nothing left to
-- validate.
--
-- Validated against existing data before enforcing, per the migration policy: no
-- deployed database exists, and no API path can have produced the state --
-- `roles.manage` has no endpoint, no endpoint issues a capability grant at all,
-- and provisioning is the only writer of `account_roles`.

-- migrate:up

-- The pair, in one place. A capability joins it only by amending SKILL.md section
-- 7, which is where the argument for refusing it outright has to be made.
CREATE FUNCTION is_grant_making(p_capability capability) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT p_capability IN ('roles.manage', 'accounts.manage');
$$;

CREATE FUNCTION holds_senior_pastor(p_account_id uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM account_roles ar
     WHERE ar.account_id = p_account_id
       AND ar.role = 'SENIOR_PASTOR'
       AND ar.revoked_at IS NULL
  );
$$;

CREATE FUNCTION holds_grant_making(p_account_id uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM capability_grants cg
     WHERE cg.account_id = p_account_id
       AND is_grant_making(cg.capability)
       AND cg.revoked_at IS NULL
  );
$$;

-- On a write to capability_grants: a grant-making capability may not stand
-- against an account holding SENIOR_PASTOR.
CREATE FUNCTION assert_grant_not_for_senior_pastor() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_row capability_grants%ROWTYPE;
BEGIN
  -- Deferred to commit, so read the row as it finally stands. A grant issued and
  -- revoked within one transaction has nothing left to validate.
  SELECT * INTO v_row FROM capability_grants WHERE id = NEW.id;
  IF NOT FOUND OR v_row.revoked_at IS NOT NULL THEN
    RETURN NULL;
  END IF;

  IF NOT is_grant_making(v_row.capability) THEN
    RETURN NULL;
  END IF;

  -- Serializes this against a concurrent insert of the role row. See the header:
  -- without it both transactions look, see nothing, and commit.
  PERFORM 1 FROM accounts WHERE id = v_row.account_id FOR NO KEY UPDATE;

  IF holds_senior_pastor(v_row.account_id) THEN
    RAISE EXCEPTION
      'account % holds SENIOR_PASTOR and may not be granted %',
      v_row.account_id, v_row.capability
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$;

-- On a write to account_roles: SENIOR_PASTOR may not be held by an account that
-- already carries a grant-making capability. The mirror of the above, so that
-- whichever row arrives second is refused.
CREATE FUNCTION assert_senior_pastor_makes_no_grants() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_row account_roles%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM account_roles WHERE id = NEW.id;
  IF NOT FOUND OR v_row.revoked_at IS NOT NULL THEN
    RETURN NULL;
  END IF;

  IF v_row.role <> 'SENIOR_PASTOR' THEN
    RETURN NULL;
  END IF;

  PERFORM 1 FROM accounts WHERE id = v_row.account_id FOR NO KEY UPDATE;

  IF holds_grant_making(v_row.account_id) THEN
    RAISE EXCEPTION
      'account % holds a grant-making capability and may not hold SENIOR_PASTOR',
      v_row.account_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER capability_grants_not_for_senior_pastor
  AFTER INSERT OR UPDATE ON capability_grants
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_grant_not_for_senior_pastor();

CREATE CONSTRAINT TRIGGER account_roles_senior_pastor_makes_no_grants
  AFTER INSERT OR UPDATE ON account_roles
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_senior_pastor_makes_no_grants();

-- migrate:down

DROP TRIGGER IF EXISTS account_roles_senior_pastor_makes_no_grants ON account_roles;
DROP TRIGGER IF EXISTS capability_grants_not_for_senior_pastor ON capability_grants;
DROP FUNCTION IF EXISTS assert_senior_pastor_makes_no_grants();
DROP FUNCTION IF EXISTS assert_grant_not_for_senior_pastor();
DROP FUNCTION IF EXISTS holds_grant_making(uuid);
DROP FUNCTION IF EXISTS holds_senior_pastor(uuid);
DROP FUNCTION IF EXISTS is_grant_making(capability);
