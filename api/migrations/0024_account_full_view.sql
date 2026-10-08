-- migrate:up

-- ---------------------------------------------------------------------------
-- Full view on an account (SKILL.md section 7, decision 0323)
--
-- An administrator ticks it on a Leader account; without it the account holds no
-- `reports.view_subtree` and no Training or Conquest capability, and sees the recording
-- screens (section 19). It means nothing on an account that also holds `SENIOR_PASTOR`
-- or `ADMIN`.
--
-- Additive: one column with a default, so every existing account starts without it,
-- as a new one does. No effective date is set, so this is not backdating (section 5).
-- ---------------------------------------------------------------------------

ALTER TABLE accounts ADD COLUMN full_view boolean NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- The launch step (decision 0323, point 6): the two roots and their direct leaders who
-- hold a Leader account start with Full view, taken once from the tree as it stands when
-- this runs. Nothing keeps it up afterwards. Each tick is audit logged as a system action
-- (`actor_id` null, which section 21 and migration 0002 allow), with its previous and
-- new value, as an administrator's tick is.
--
-- A root holding `SENIOR_PASTOR` alone is not ticked: Full view changes only what the
-- Leader role gives. On a database with no tree this ticks nobody.
-- ---------------------------------------------------------------------------

WITH ticked AS (
  UPDATE accounts a
     SET full_view = true, updated_at = now()
   WHERE EXISTS (
           SELECT 1
             FROM pastoral_assignments own
             LEFT JOIN pastoral_assignments root
               ON root.person_id = own.leader_id
              AND root.ended_at IS NULL
              AND root.leader_id IS NULL
            WHERE own.person_id = a.person_id
              AND own.ended_at IS NULL
              AND (own.leader_id IS NULL OR root.id IS NOT NULL)
         )
     AND EXISTS (
           SELECT 1
             FROM account_roles r
            WHERE r.account_id = a.id
              AND r.role = 'LEADER'
              AND r.revoked_at IS NULL
         )
  RETURNING a.id
)
INSERT INTO audit_log (actor_id, action, target_type, target_id, before, after, reason)
SELECT NULL,
       'account.full_view_changed',
       'account',
       ticked.id::text,
       '{"full_view": false}'::jsonb,
       '{"full_view": true}'::jsonb,
       'Launch of Full view: a direct leader of a Network root (decision 0323).'
  FROM ticked;

-- migrate:down

-- Removes the column and with it every tick. The launch step's audit entries stay:
-- the audit log is append-only (section 21), and they remain true of what happened.
ALTER TABLE accounts DROP COLUMN full_view;
