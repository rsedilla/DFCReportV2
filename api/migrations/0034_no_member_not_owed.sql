-- migrate:up

-- ---------------------------------------------------------------------------
-- Stored months follow decision 0409 (SKILL.md sections 12 and 20)
--
-- A Cell meeting dated when the Cell had no member is no longer owed, and the owner ruled
-- that this reaches months already reported. The rule lives in the queries, so no data
-- row changes and nothing moves a stored month by itself: a closed month's stored figures
-- would keep counting such meetings while every live surface did not. Moving every month's
-- version, as a Person Merge does, makes each stored month be computed again the next
-- time it is read. No row of history is written or removed.
-- ---------------------------------------------------------------------------

SELECT report_months_move_from('0001-01-01'::date);

-- migrate:down

-- Nothing to undo: a moved version only makes a stored month be computed again, which is
-- right under either rule.
SELECT 1;
