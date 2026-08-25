# Preparing the leadership-tree CSV

Non-normative. `SKILL.md` is the source of truth — section 2 (*Initial data load*
and *How the tree import runs*), section 3 (Person model), section 4 (Networks),
section 5 (Network roots). Where this file disagrees with it, it is wrong.

This is the operator's guide to producing the file the import consumes, and to
reading what the validator says about it.

## The file must never enter this repository

**This repository is public and the church holds records for minors.** The tree
file carries names and birthdays for several thousand people.

- Keep it outside the repository entirely. The validator and the import both take
  a path, so there is no reason for it to live here.
- Never paste it, or an unredacted validator report, into a chat, an issue, or a
  pull request. `--redact` exists for exactly that: it prints line numbers,
  `row_id`s and finding codes with every name, birthday and quoted value removed,
  and the report stays actionable without them.
- `.gitignore` refuses `*.tree.csv` and a `tree-data/` directory as a backstop. A
  backstop is not a plan — keep the file somewhere else.

## The format

```text
row_id,first_name,last_name,birth_date,sex,civil_status,leader_row_id
1,Andres,Batungbakal,1968-04-12,MALE,MARRIED,
2,Perlita,Batungbakal,1970-09-03,FEMALE,MARRIED,
7,Marisol,Ventura,1985-06-15,FEMALE,SINGLE,2
11,Elena,Rivas,1990-01-22,FEMALE,MARRIED,7
```

| Column | Rule |
| --- | --- |
| `row_id` | Required, unique within the file, no whitespace. It is how other rows name this person, and nothing else. It is not the Member ID — the server assigns that from a sequence (section 3). |
| `first_name`, `last_name` | Required. Spaces, hyphens, apostrophes and any Unicode are fine (section 3 forbids "letters only" validation). |
| `birth_date` | Optional, and exactly `YYYY-MM-DD` where given. Never invented — see below. |
| `sex` | Exactly `MALE` or `FEMALE`. Network follows from it (section 4). |
| `civil_status` | Exactly `SINGLE`, `MARRIED` or `WIDOWED`. |
| `leader_row_id` | Another row's `row_id`, or empty for a Network root. Never a name. |

`middle_name` and `mobile_number` are Person fields (section 3) and are
deliberately not columns. Section 2 names what the import loads, and a column
that cannot be filled from the central record is a column that gets filled with
something.

**Exactly two rows have an empty `leader_row_id`** — one `MALE` and one `FEMALE`,
the two Network roots (section 5). A root is a row, not a missing row.

**Every leader-to-disciple edge is same-Network**, so a row's `sex` must equal its
leader's `sex` (sections 4 and 5).

## Two things to get right, because nothing downstream will catch them

### The birthday is optional, and is never invented

Section 2 used to require one here, on the ground that the import reads a central
record that already holds them. No such record exists for this church, so that
requirement is gone and section 3 governs: a birthday where it is known, absent
where it is not.

**Never fill a blank in to make the validator quieter.** It reports a missing
birthday as a *warning* precisely so that nobody is tempted to. Two of the three
Tier 1 duplicate rules read the birthday, and **Tier 1 blocks creation**
(section 3) — so two unrelated people carrying the same invented date match each
other, and the system then refuses to record one of them on the strength of a value
nobody meant. Absence is honest and costs a little matching reach; invention is
dishonest and blocks real people.

It is added later by an ordinary edit, by the leader who holds the person or
anyone upline.

### A leader is named by `row_id`, never by name

If the source names leaders by name — which is the usual shape — the conversion has
to resolve each name to a `row_id`, and **that resolution is the one thing the
validator cannot check**. It will catch an id that resolves to nothing, a cycle,
and a cross-Network edge; it cannot catch a name resolved to the wrong Marisol
Ventura, and nothing afterwards will either. The failure is silent, pastoral, and
invisible until somebody asks why a person's attendance rolls up under the wrong
branch.

The validator's `AMBIGUOUS_AS_LEADER` warning lists every set of rows sharing a
first and last name. **Check each `leader_row_id` pointing at any of them by hand.**
That warning is the whole of your protection against this class of error.

## Converting from a spreadsheet

1. **One row per person, one header row, and no merged cells.** A merged cell
   exports as a value on the first row and blanks below it.
2. **Add `row_id`.** The spreadsheet row number is the obvious choice and is a
   fine one — it survives sorting only if you paste it as a value first, so do
   that before you sort anything.
3. **Resolve leader names to `row_id`.** A lookup against the name column does
   most of it. Whatever it cannot resolve uniquely is a name shared by two people,
   and is decided by a person who knows the tree, not by picking the first match.
4. **Fix the date column before exporting.** This is where most of the errors come
   from. Format the column as text already in ISO, or as a date the export writes
   as ISO — a column exported as a number becomes a serial like `31213`, and one
   exported as a display format becomes `15/06/1985`, which is indistinguishable
   from `06/15/1985` wherever the day is 12 or less. The validator names which
   shape it found; it will never guess the order.
5. **Uppercase the two enums.** They are case-sensitive.
6. **Export as CSV UTF-8.** The byte-order mark Excel writes is handled. Names with
   commas must be quoted, which every spreadsheet does automatically.

### `civil_status` values that are not in the list

`DIVORCED`, `SEPARATED`, `ANNULLED` and similar are common in a Philippine church
record and are **not** in section 3's list, which is closed. Which permitted value
one of them becomes is a decision about what the record means — a specification
question, raised before the import runs (`CLAUDE.md`, Stop Conditions). It is not
a mapping for whoever is preparing the file to choose.

## Running the validator

```bash
cd api && npm run validate:tree -- /path/to/tree.csv
```

Options: `--redact` to share the report, `--no-duplicates` to skip the duplicate
pass while iterating on something else, `--json` for machine-readable output.

Exit codes: `0` clean, `1` findings the import will refuse, `2` unreadable or
unparseable.

**Warnings are not failures.** The duplicate warnings in particular are not defects
in the file: section 3 forbids the system from ever blocking creation, and the
import's dry run and adjudication step exist to have a person decide each one. They
are surfaced here because it is far cheaper to notice two rows are one person while
the source records are still open.

**The validator is not the dry run.** It checks everything decidable from the file
alone, which is what section 2 puts on the dry run — cycles, the root count, every
`leader_row_id` resolving, sex present and mapping to a Network, and every edge
same-Network. The dry run additionally matches every row against People already in
the database, which needs the database, an Admin account, and an open
initial-encoding phase. A file this validator passes can still meet duplicates
there.
