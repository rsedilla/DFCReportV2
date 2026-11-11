-- migrate:up

-- ---------------------------------------------------------------------------
-- An account holding NETWORK_ADMIN holds no other role (SKILL.md section 7,
-- decision 0469).
--
-- One partial unique index per pairing rather than one over all four roles,
-- because LEADER may sit beside ADMIN or SENIOR_PASTOR and an index naming all
-- four would forbid that. An index rather than a trigger for section 7's reason:
-- `pg_restore --disable-triggers` skips a trigger and does not skip an index.
--
-- Nothing holds the role when this runs, so no existing row can fail these.
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX account_roles_network_admin_not_with_leader
  ON account_roles (account_id)
  WHERE revoked_at IS NULL AND role IN ('NETWORK_ADMIN', 'LEADER');

CREATE UNIQUE INDEX account_roles_network_admin_not_with_admin
  ON account_roles (account_id)
  WHERE revoked_at IS NULL AND role IN ('NETWORK_ADMIN', 'ADMIN');

CREATE UNIQUE INDEX account_roles_network_admin_not_with_senior_pastor
  ON account_roles (account_id)
  WHERE revoked_at IS NULL AND role IN ('NETWORK_ADMIN', 'SENIOR_PASTOR');

-- migrate:down

DROP INDEX account_roles_network_admin_not_with_senior_pastor;
DROP INDEX account_roles_network_admin_not_with_admin;
DROP INDEX account_roles_network_admin_not_with_leader;
