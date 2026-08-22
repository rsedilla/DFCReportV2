-- A claim needs an identity (SKILL.md section 22, Idempotency).
--
-- Additive: one column with a default, and no data loss (CLAUDE.md, Definition
-- of Done -> Migration policy).
--
-- Why it exists. The claim lease lets a request take over a row whose holder is
-- past its lease, and taking over sets `state = 'IN_FLIGHT'` again. Every
-- completion and release matched on `state = 'IN_FLIGHT'` and nothing else, so
-- they could not tell one request's claim from another's:
--
--   A claims K and is slow.
--   A's lease expires; B takes K over and performs the write.
--   A finally finishes and completes -- matching B's claim, storing A's response.
--   B completes, matches nothing, and is discarded in silence.
--
-- The stored answer then belongs to A while B's client was handed B's, and a
-- later retry is replayed the wrong one. Worse, a takeover rewrites
-- `request_fingerprint`, so A's response can end up stored under B's fingerprint
-- -- a repeat of B's body replayed A's answer, which is the cross-request leak
-- section 22's account scoping exists to prevent, arriving by another door.
-- `release` had the same defect one column over: A's release deleted B's claim.
--
-- The identity is minted per claim, including on takeover, and every write
-- against the row carries the identity it was given. A request that has lost its
-- claim then matches nothing, which is the correct outcome: it no longer owns the
-- key and has nothing to say about it.

-- migrate:up

ALTER TABLE idempotency_keys
  ADD COLUMN claim_id uuid NOT NULL DEFAULT gen_random_uuid();

-- migrate:down

ALTER TABLE idempotency_keys
  DROP COLUMN IF EXISTS claim_id;
