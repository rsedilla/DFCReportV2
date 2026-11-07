-- migrate:up

-- ---------------------------------------------------------------------------
-- A session ends a fixed time after its sign-in (SKILL.md section 6, decision 0450)
--
-- `session_ends_at` is the instant a session stops being renewable however often it
-- is used: thirty days after signing in, seven for an account holding `ADMIN` or
-- `SENIOR_PASTOR`. It is set when a session is signed in and carried unchanged to
-- every replacement a rotation issues, and a refresh token's own `expires_at` never
-- passes it. Before this, each renewal moved the thirty days forward, so a session in
-- the installed app, which has no idle limit, never ended.
--
-- Additive: one nullable column and its check. The backfill gives each session still
-- renewable an end counted **from now**, never from its sign-in, which no row records:
-- it moves no effective date and backdates nothing, and a session older than the limit
-- is not ended at deployment but on the day the limit runs from it. Rows already
-- revoked or expired stay null and can never be renewed. A refresh token is not
-- history, so the down drops the column; the shortened `expires_at` it leaves is a
-- session ending sooner, which is the safe direction.
-- ---------------------------------------------------------------------------

ALTER TABLE refresh_tokens ADD COLUMN session_ends_at timestamptz;

UPDATE refresh_tokens AS t
SET session_ends_at = now() + (
      CASE WHEN EXISTS (
        SELECT 1 FROM account_roles AS r
        WHERE r.account_id = t.account_id
          AND r.revoked_at IS NULL
          AND r.role IN ('ADMIN', 'SENIOR_PASTOR')
      ) THEN interval '7 days' ELSE interval '30 days' END
    )
WHERE t.revoked_at IS NULL AND t.expires_at > now();

UPDATE refresh_tokens
SET expires_at = session_ends_at
WHERE session_ends_at IS NOT NULL AND expires_at > session_ends_at;

ALTER TABLE refresh_tokens ADD CONSTRAINT refresh_tokens_expire_by_session_end
  CHECK (session_ends_at IS NULL OR expires_at <= session_ends_at);

-- migrate:down

ALTER TABLE refresh_tokens DROP CONSTRAINT refresh_tokens_expire_by_session_end;
ALTER TABLE refresh_tokens DROP COLUMN session_ends_at;
