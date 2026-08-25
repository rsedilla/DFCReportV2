-- A Person's birthday is optional (SKILL.md section 3, Required personal
-- information).
--
-- Additive in the sense the migration policy cares about: a constraint is
-- relaxed, no column is dropped and no data is rewritten (CLAUDE.md, Definition
-- of Done -> Migration policy).
--
-- Why it exists. Section 3 required a birthday and `persons.birth_date` was
-- NOT NULL, which is the same argument section 3 rejects two subsections earlier
-- for email: a mandatory field that people cannot fill is filled with fictions,
-- which corrupts both the data and duplicate matching.
--
-- For a birthday the corruption is worse than the general case, and that is what
-- makes this a rule rather than a convenience. Two of the three Tier 1 duplicate
-- rules read the birthday -- the third reads a mobile number, so absence does not
-- put a person beyond Tier 1 -- and Tier 1 *blocks* creation. So two unrelated
-- people carrying the same invented date match each other at Tier 1, and the
-- system refuses to record one of them on the strength of a value nobody meant.
-- Requiring the field does not protect the matcher; it poisons it and then acts
-- on the poison.
--
-- Two situations produce a Person with no birthday. A leader meeting somebody for
-- the first time may not have asked. Or somebody may decline to give it, which is
-- a decision rather than a gap, and no later gate may coerce it.
--
-- The matcher needed nothing: `Subject.birthDate` and `Candidate.birthDate` in
-- `duplicate-matching.ts` were already `string | null`, and section 3 already
-- carried a Tier 2 rule naming an absent birthday.
--
-- **The edit path did need something, and this migration is why.** A first version
-- of this header said nothing else changes, because `PATCH /api/v1/people/{id}`
-- already accepted `birth_date`. It accepted an explicit null too -- inert while
-- the column was NOT NULL, since the database refused the write. Relaxing the
-- column turned that into a working destructive edit which answered 200 and erased
-- a recorded date. `EditPersonDto` refuses an explicit null now (`@ValidateIf`
-- rather than `@IsOptional`), because section 3 defines adding a birthday and does
-- not define removing one.
--
-- Worth keeping as a shape rather than an instance: relaxing a constraint can hand
-- an existing endpoint a capability nobody decided on, and that endpoint's own code
-- does not change, so nothing draws attention to it.
--
-- The initial leadership-tree import still requires one (section 2). It loads
-- from a central record that holds them, so a gap there is an omission rather
-- than a person's decision.
--
-- **Reversible, with a deadline.** The down re-adds NOT NULL, which succeeds only
-- while no row lacks a birthday. That is true today and stops being true the first
-- time somebody is recorded without one — at which point reverting means finding
-- those people and asking. Stated rather than discovered: the migration policy
-- asks for reversible or explicitly marked, and this is reversible only for now.

-- migrate:up

ALTER TABLE persons
  ALTER COLUMN birth_date DROP NOT NULL;

-- migrate:down

ALTER TABLE persons
  ALTER COLUMN birth_date SET NOT NULL;
