-- migrate:up

-- ---------------------------------------------------------------------------
-- The verse on Record (SKILL.md section 7, decision 0425)
--
-- A fourth church-wide setting: the verse shown under the welcome on Record, set by
-- an administrator under `settings.manage`. Its value is an object holding the text
-- and its reference, or both null where no verse is shown.
--
-- Seeded rather than left absent, as `dcc_calendar_start` was (migration 0011),
-- because `settings_key_is_known` is a closed list and a key written without a row
-- would need an INSERT where the others need an UPDATE. Seeded with the verse the
-- owner chose on 2026-11-02, by a system action, so `updated_by` is null. Additive:
-- one row, and the check widened to name it.
-- ---------------------------------------------------------------------------

ALTER TABLE settings DROP CONSTRAINT settings_key_is_known;

ALTER TABLE settings ADD CONSTRAINT settings_key_is_known
  CHECK (key IN ('cell_attention_months', 'initial_encoding_open', 'dcc_calendar_start',
                 'record_verse'));

INSERT INTO settings (key, value, updated_by) VALUES
  ('record_verse',
   jsonb_build_object(
     'text', 'Be shepherds of God’s flock that is under your care, watching over them—not because you must, but because you are willing, as God wants you to be; not pursuing dishonest gain, but eager to serve.',
     'reference', '1 Peter 5:2 (NIV)'),
   NULL);

-- migrate:down

-- The key ceases to exist with this change, so its row goes with it, the no-delete
-- trigger stood down for the one statement as migration 0011's down does.
ALTER TABLE settings DISABLE TRIGGER settings_no_delete;
DELETE FROM settings WHERE key = 'record_verse';
ALTER TABLE settings ENABLE TRIGGER settings_no_delete;

ALTER TABLE settings DROP CONSTRAINT settings_key_is_known;

ALTER TABLE settings ADD CONSTRAINT settings_key_is_known
  CHECK (key IN ('cell_attention_months', 'initial_encoding_open', 'dcc_calendar_start'));
