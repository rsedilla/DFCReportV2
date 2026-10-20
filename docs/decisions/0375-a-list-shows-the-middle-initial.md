# 2026-10-20 — A list shows a person's middle name as its initial

A person's name was shown with the middle name whole everywhere: `Juan Santos Dela Cruz`. On
20 Oct the owner asked for the names in the application's tables to read first name, middle
initial and last name, `Juan S. Dela Cruz`, and chose from real screenshots where the whole
middle name should stay.

## The ruling

1. **Every list, table and picker shows the middle name as its initial**: the middle name's
   first letter, raised, with a full stop. `dela Rosa` gives `D.`, a middle name already
   entered as `S.` stays `S.`, and with no middle name the name is first and last alone. A
   title still comes first (decision 0271): `Pastor Juan S. Dela Cruz`.
2. **The person's own page and Add a Person's possible matches keep the middle name whole.**
   Where somebody is deciding who one person is, the middle name, often the mother's
   surname, is what tells two people of one name apart.
3. **Only the display changes.** Nothing stored changes; search still finds a person by their
   whole middle name; first-name order (decision 0359) and duplicate matching read the name
   fields as before.

## Where

The server composes a name for every screen, so the change is made where it composes:
`composeName` in `people.shared.ts` and the pastoral path's copy in `hierarchy.service.ts`,
which give the initial, and `composeFullName` for the person's own record. The duplicate check
composes its names with the matcher's own function and keeps them whole. A Cell meeting's
roster carried the first and last name alone and was joined on the page; it now carries the
name as a list shows it, `full_name`, an added field (Section 22).

A conflict message naming who recorded something says first and last name in a sentence, and
is unchanged.

Decision 0375, indexed in [CLAUDE.md](../../CLAUDE.md) and amended into [SKILL.md](../../SKILL.md)
Section 3.

Previous: [2026-10-20 — Only the Admin gives a title](0374-only-the-admin-gives-a-title.md)