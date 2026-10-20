# 2026-10-20 — Only the Admin gives a title

A title (decision 0271) is Bishop, Pastora and the like, shown before a person's name. Any
holder of `people.create` or `people.edit_basic` could set one, which is every Leader over
their own branch. On 19 Oct the owner asked for the Title box to be hidden from leaders on Add
a Person, as titles are rare (three pastors under the two Network roots carry one), and on
20 Oct confirmed that only the Admin should see it.

## The ruling

1. **A new capability, `people.set_title`, gives, changes or clears a title.** The Admin holds
   it at Whole Church; the Senior Pastors and Leaders do not. Like `people.correct_sex`, it
   exists at Whole Church only, and a grant of it at any narrower scope covers nothing.
2. **`people.edit_basic` no longer covers the title.** It keeps the other descriptive fields.
3. **The server refuses a title from anyone without it**, `CAPABILITY_DENIED` naming
   `people.set_title`, and writes nothing:
   - on Add a Person, a title with any text in it (a blank one is no title);
   - on Edit details, a title that differs from the one recorded, clearing one included. A
     title sent back unchanged, or not sent, is not refused, so a page opened before this
     change still saves the rest.
4. **Add a Person and Edit details show the Title box to a holder of `people.set_title`
   alone**, and send a title only from that holder. Nobody else sees the box at all.
5. **Titles already recorded stay**, and are shown before the name everywhere, as before.

## Why

A title is the church's recognition of an office, the same for a person whoever encodes
them, so it belongs with the account that administers the church's records rather than with
whichever leader is adding the person. Hiding the box alone would have left the API giving any
leader a title by request, and Section 7 makes the API the sole authority.

A capability of its own, rather than reading `people.edit_basic` at Whole Church, keeps what
an account may do separate from how far it reaches, as `people.correct_sex` does (decision
0083).

Decision 0374, indexed in [CLAUDE.md](../../CLAUDE.md) and amended into [SKILL.md](../../SKILL.md)
Sections 3 and 7. Migration `0031_people_set_title.sql` adds the value to the `capability`
type.

Previous: [2026-10-20 — Add a Person states the Sex as already decided for a leader under a leader](0373-add-a-person-states-the-sex-already-decided.md)
