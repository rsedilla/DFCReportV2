-- migrate:up

-- ---------------------------------------------------------------------------
-- Who opened a person's record (SKILL.md sections 8 and 21, decision 0414)
--
-- Each time somebody reads another person's full record, from that person's page or any other
-- screen, who and when is kept, and the Admin sees it at the bottom of the person's page,
-- newest first. A row is kept for a year and then removed: this is a record of reading, which
-- the owner chose to keep for a year, not history the audit log keeps for ever.
--
-- The viewer is a Person rather than an account, so the page can name them from `people`'s
-- own table. A second read of the same record by the same person within ten minutes writes
-- nothing.
--
-- `person_view_alerts` keeps when the Admin was emailed that one person opened more than a
-- hundred person pages in an hour, so that the email goes at most once a day for one viewer
-- and twenty times a day in all, as decision 0413 caps the sign-in alert.
-- ---------------------------------------------------------------------------

CREATE TABLE person_views (
  person_id        uuid NOT NULL REFERENCES persons (id),
  viewer_person_id uuid NOT NULL REFERENCES persons (id),
  viewed_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX person_views_person ON person_views (person_id, viewed_at DESC);
CREATE INDEX person_views_viewer ON person_views (viewer_person_id, viewed_at);
CREATE INDEX person_views_viewed_at ON person_views (viewed_at);

CREATE TABLE person_view_alerts (
  viewer_person_id uuid NOT NULL REFERENCES persons (id),
  sent_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX person_view_alerts_sent_at ON person_view_alerts (sent_at);

-- migrate:down

-- Rows that are removed after a year anyway, and an alert ledger: dropping them loses no
-- history a report or the audit log reads.
DROP TABLE person_view_alerts;
DROP TABLE person_views;
