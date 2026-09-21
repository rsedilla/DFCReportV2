# 2026-09-21 — Why a person has no pastoral leader is derived, and the server says it

Section 5 makes zero pastoral assignments legitimate in three situations — not yet assigned,
archived, and an administrator outside the pastoral structure — and nothing said which one a
person is in. The person page and the Network screen read "No pastoral leader yet" for all
three, so the demo administrator looked like somebody waiting for a leader. The owner chose
this answer from a drawing of the three beside each other.

## The ruling

**Nothing new is stored. The API derives which situation a person is in from what is**:
*archived* where their lifecycle says so; *outside the pastoral tree* where they hold an `ADMIN`
account and have never held a pastoral assignment; otherwise *no pastoral leader yet*.

**`GET /api/v1/people/{id}/pastoral-path` carries it as `no_leader_reason`** — `ARCHIVED`,
`OUTSIDE_TREE` or null — and null wherever the path has a leader or the person is a root. A
client shows it and never works it out.

## Why

The facts were already there: lifecycle is recorded, and an account's roles and a person's
assignment history are recorded. A stored reason would be a second copy of them, free to
disagree.

**"Never held an assignment" is narrower than holding `ADMIN`, on purpose.** A leader who also
holds `ADMIN` and whose own assignment ends is waiting for a leader like anybody else, and
reads that way. The list of people awaiting reassignment still excludes on `ADMIN` alone, which
stays open in `CLAUDE.md`, and so does whether the path may disclose these facts to a reader
whose scope reaches the person from outside their tree.

---

Decision 0270, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-21 — A sender reads the Cell leadership requests they sent, with no capability](0269-a-sender-reads-the-requests-they-sent.md)
