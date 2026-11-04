-- migrate:up

-- ---------------------------------------------------------------------------
-- A browser session ends after a spell without activity (SKILL.md section 6,
-- decision 0435)
--
-- `idle_expires_at` is the instant a browser session's refresh token stops being
-- renewable if nobody has used it. It is set on a session begun in a browser and
-- carried to each replacement a rotation issues, a fixed span after the rotation;
-- it is null for a session begun in the installed app, which keeps the thirty days.
--
-- Additive: one nullable column and its check. Existing rows stay null, so a session
-- signed in before this carries no server deadline until it signs in again (the web
-- client still signs a browser out when idle): nothing says whether an existing row is a
-- browser's or the installed app's, and nothing is backdated. A refresh token is not
-- history, so the down drops the column.
-- ---------------------------------------------------------------------------

ALTER TABLE refresh_tokens ADD COLUMN idle_expires_at timestamptz;

ALTER TABLE refresh_tokens ADD CONSTRAINT refresh_tokens_idle_after_issue
  CHECK (idle_expires_at IS NULL OR idle_expires_at > issued_at);

-- migrate:down

ALTER TABLE refresh_tokens DROP CONSTRAINT refresh_tokens_idle_after_issue;
ALTER TABLE refresh_tokens DROP COLUMN idle_expires_at;
