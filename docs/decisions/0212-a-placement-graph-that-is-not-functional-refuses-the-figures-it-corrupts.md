# 2026-09-05 — A placement graph that is not functional refuses the figures it corrupts

`reportingSubtree`'s whole-graph cycle check rests on a premise nothing enforces: that the placement
graph is **functional**, one out-edge per person. Two `pastoral_assignments` rows in force at one
instant break it. This settles what the report does when the premise fails.

It does **not** settle whether non-overlap is a rule of Section 5 or an accident of the backdate
floor. That is a separate Stop Condition, it stays open, and its remedy is at the write.

## What the premise buys, and the two ways it fails

`grounded` is reachability from a terminal: a person is grounded where **any** of their out-edges
leads to a root or to somebody holding no edge. `has_cycle` is then "some person holding an edge has
no terminating chain". Where the graph is functional that is exactly "is in or beneath a cycle",
which is what makes whole-graph detection sound — and whole-graph detection is required, because a
cycle in a functional graph is a *closed component* no walk from above can enter.

Both failures were reproduced against the database and are pinned in `reporting-subtree.spec.ts` as
the behaviour the method currently has:

- **A cycle grounded by a second edge is invisible.** A cycle member holding another, grounded edge
  grounds itself and so grounds the whole cycle, and `has_cycle` is false. A leader beside the cycle
  is then answered cleanly over a graph that holds one.
- **A person reached by two distinct paths is returned twice.** Neither flag fires: every chain
  reaches a root, and PostgreSQL's `CYCLE` clause marks a key repeated on a row's **own path**, not
  a person visited twice. Principle 10 makes a total of people distinct, so a caller counting that
  list counts them twice.

*The commit that added the walk's `CYCLE` flag justified it by the second case. It closes the
narrower one where the second edge points inside the first's subtree, and not this.*

## The ruling: refuse, and scope the refusal to the walk

**Where a walk's own result contains a person more than once, the figure refuses**, on the terms
Section 20 already gives a detected cycle: a data-integrity defect, reported rather than retried.

**Scoped to the walk, and not church-wide — which is the opposite of the cycle rule, deliberately.**
The two defects differ in exactly the property that decides blast radius:

- A **cycle** is a closed component. Its members are absent from a total that should contain them,
  and nothing in that total shows it, so only whole-graph detection can see it. Detection has to
  reach past the walk because the damage does.
- A **duplicate** corrupts only a total that contains it. A leader whose subtree holds no duplicated
  person has a figure that is correct and complete, and refusing it would punish them for another
  branch's state — which is the ground decision 0209 gave for refusing "refuse the whole report" for
  the dangling-parent case, applied here where it fits.

**And scoping loses nothing, checked rather than assumed.** Any walk that reaches a person beneath a
cycle must pass through the cycle to get there, so a walk whose result is affected always touches the
condition. The two rules are therefore not in tension: each is scoped to where its own damage
reaches.

## Why refuse rather than pick a row

The obvious repair is a `DISTINCT ON (person_id)` over the in-force set, which makes the graph
functional and every argument above sound. It is refused.

Choosing between two in-force rows is choosing **which of two leaders the person belongs to**, for
the period, permanently, in a report. Nothing in Section 5 or Section 20 decides that, so a tiebreak
written into a query would be a placement rule invented at a keyboard — and it would be invisible,
because the figure it produced would look right. Section 20's standard for a data-integrity defect is
that the figure refuses rather than silently truncating; silently *choosing* is the same failure with
a better disguise.

## The real remedy is at the write, and is not this ruling

`CLAUDE.md`'s overlap Stop Condition already proposes it: an exclusion constraint,

```sql
EXCLUDE USING gist (person_id WITH =, tstzrange(started_at, ended_at) WITH &&)
```

which makes the premise a property of the data rather than an assumption of one query, and closes
all three consequences that bullet now records. That is a Section 5 amendment with a migration
attached — a code-owner change, and a decision about whether historical overlap is legal at all —
so it belongs to whoever settles the Stop Condition. **This ruling makes the report honest until it
exists**, and it stops being reachable when it does.

## Alternatives refused

- **Leave it.** A report that returns a person twice is a wrong unique-people total with nothing
  failing, which Principle 10 and Section 20 both forbid.
- **De-duplicate the result.** Hides the defect one layer later and still has to choose a leader for
  the drill-down.
- **Refuse church-wide, as the cycle does.** Disproportionate for a defect whose damage does not
  leave the total that contains it, and refused on decision 0209's own argument.

---

Decision 0212, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-05 — The placement graph authorizes a leader-scoped report, and one edge definition serves both directions](0211-the-placement-graph-authorizes-a-leader-scoped-report.md)
