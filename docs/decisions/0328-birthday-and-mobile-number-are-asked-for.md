# 2026-10-10 — A birthday and a mobile number are asked for, unless not given yet

Owner ruling, 2026-10-10, at Bishop Oriel's request. It amends Section 3's rule that both
fields are optional, Section 9's registration steps 4 and 5, and the sentences in Sections 2 and
28 that rested on it.

## The ruling

**1. Adding a Person requires a birthday and a mobile number, each unless the person adding
them ticks *Not given yet*.** `POST /api/v1/people` refuses a request that leaves either field
blank without its tick, as `VALIDATION_FAILED` naming the field. The ticks travel as
`birth_date_not_given` and `mobile_number_not_given`, both booleans, both optional, both on
that route alone. A value sent together with its tick is refused the same way, because the
request then says two things about one field.

**2. Nothing is stored about the tick.** A Person added with *Not given yet* is recorded with
no birthday or no mobile number, exactly as one is today. Their page shows the field as not
recorded and offers to add it (decision 0272). Whether *asked and not given* should be a state
of its own stays an open question.

**3. Existing records are untouched.** A Person already recorded without either field stays
valid, nothing is backfilled, and the columns stay nullable. No migration.

**4. An edit does not require them.** `PATCH /api/v1/people/{id}` keeps its current rules, so a
name can be corrected on a record that has no birthday. An explicit null is still refused for a
birthday (Section 3).

**5. The leadership-tree import is not a way of adding somebody at first contact, and is
unchanged.** It ran once, from a file nobody holds birthdays for (Section 2).

**6. On screen** the two labels read *Birthday (required)* and *Mobile number (required)*,
with a *Not given yet* tick under each and no further explanation.

## Why

The Bishop wants both asked for every time somebody is added. Section 3's reason for leaving
them optional still holds: a field that must be filled gets filled with a guess, and two people
carrying one guessed birthday block each other at Tier 1. The tick keeps the honest answer
available, so asking is required and inventing is still never needed.

The route is narrowed rather than versioned. Section 22 versions a change that breaks a client,
and the only client of `/api/v1` today is the web application, which ships the screen change
with it; no native client exists yet (Section 2).

Decision 0328, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-10-09 — The Senior Pastors' screens, as the owner reviewed them](0327-the-senior-pastors-screens-as-reviewed.md)
