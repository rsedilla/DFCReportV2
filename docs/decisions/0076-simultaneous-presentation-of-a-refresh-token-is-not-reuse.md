# 2026-08-21 — Simultaneous presentation of a refresh token is not reuse

Two requests presenting the same live refresh token at the same instant: one wins the rotation, the other is refused, and nothing else happens. The winner's session survives and no account-wide revocation follows.

§6 defines the reuse signal as a presentation **after** use, and that case is unchanged — a token that already reads as revoked and carries a replacement still revokes every session on the account. Simultaneity is different: two calls hitting 401 together is what an ordinary mobile HTTP interceptor does, and treating it as theft signed a leader out of every device for behaving normally, on clients §2 says cannot be force-updated.

The cost is real and is written into §6 rather than glossed: an attacker racing a stolen token within the same instant is not caught at that moment. They are caught on the next presentation, which is the case the specification actually describes.

Two rules that make the marker work are written to §6 alongside it, because both were found only after they had been got wrong: `issued_at` is stamped by the API process rather than by a database default, so the comparison spans one clock; and rotation is ordered against revocation by a row lock on the account, taken first by both paths, because a marker read outside the rotation's transaction cannot see a revocation still in flight — and two paths taking the same pair of locks in opposite orders deadlock, with the revocation the likely victim. Written to `SKILL.md` §6.

---

Decision 0076 of 155, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-21 — Migration 0001 may be corrected in place until first deployment](0075-migration-0001-may-be-corrected-in-place-until-first.md) | Next: [2026-08-21 — `account_roles` gains `senior_pastor_slot`](0077-accountroles-gains-seniorpastorslot.md)
