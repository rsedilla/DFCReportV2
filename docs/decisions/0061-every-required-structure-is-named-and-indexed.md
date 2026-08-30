# 2026-08-20 — Every required structure is named and indexed

Six entities were required by rules and had no shape, of which five would naturally have been built as a column on their parent — losing history the specification guarantees, with nothing failing to warn anyone. `person_lifecycle` is the clearest: a state column plus audit rows satisfies every sentence in §3 and still cannot answer who was `CURRENT` on a given past date.

Shapes now sit in the section owning each rule, and §26 carries an index of all twenty structures to be checked against a migration. Adding to that index is part of the change introducing the rule, never a follow-up. Written to `SKILL.md` §3, §4, §10, §13, §20, §26.

---

Decision 0061, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-20 — Nine modules, each owning its tables](0060-nine-modules-each-owning-its-tables.md) | Next: [2026-08-20 — The guard checks one target; the rest is domain layer](0062-the-guard-checks-one-target-the-rest-is-domain-layer.md)
