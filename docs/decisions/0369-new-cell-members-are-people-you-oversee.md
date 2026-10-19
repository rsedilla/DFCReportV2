# 2026-10-19 — A new Cell's three members are people the leader asking oversees

Decision 0353 asks every new-Cell request, a restart included, to name three members besides
the prospective leader, each a current Person in that leader's Network. Nothing asked whether
the leader sending the request had anything to do with them. Their search reached the whole
Network (decisions 0299 and 0244), and the server checked the Network alone, so a Cell leader
could find, and name, people in another leader's branch. On 19 Oct the owner, looking at the
*Ask for a new Cell* dialog on My Cell, ruled that a leader searches only those under them.

## The ruling

1. **Each member must be beneath the leader asking**, by their own reach: the scope of the
   `cell.request_leadership` grant that sends the request. Every role holds it over its own
   subtree excluding itself (Section 7), the Admin's included, so for a Cell leader that is
   the people under them and for a Primary their branch; only an explicit wider grant, which
   an Admin issues, reaches further. A member outside it is refused `SCOPE_DENIED`, naming the
   line, with the scope checks and so before any check about the person (Section 7's
   contents ordering, decision 0193).
2. **Nobody names themselves as one of the three**, at any scope, refused `SCOPE_DENIED`:
   "beneath the leader asking" excludes the leader asking, and a wider explicit grant, which
   may cover its own holder, must not undo that.
3. **Approval re-checks it.** The state at approval governs (Section 10, *Approval
   revalidates the target*), so a member who has since moved out of the requester's reach
   refuses the approval `SCOPE_DENIED`, naming the person and the requester, as a prospective
   leader who has moved out of it already does.
4. **The search reaches only the asker's own people.** The three member pickers search the
   searcher's own scope, narrowed to the prospective leader's Network, and no longer the
   church-wide directory, so a leader sees only those under them. Somebody not yet in the
   application is added first, through Add People.
5. **Everything else about the members stands**: three different people other than the
   prospective leader, each a current Person in the prospective leader's Network now, and
   somebody already in another Cell may be named and moves at approval (decision 0357).

## Why

A leader asks for a new Cell for people they care for. Naming people from another branch put
somebody else's members into a request that branch's leaders were never asked about, and the
request carried them across at approval. The search and the rule now say the same thing, and
the rule is enforced where Section 1, Principle 4 puts every such decision: the API.

The refusals about a member, archived or in the other Network, now come after this one, so a
leader learns nothing about a person outside their reach from a refusal to name them, which
narrows the question `CLAUDE.md` records about what those refusals may disclose.

Decision 0369, indexed in [CLAUDE.md](../../CLAUDE.md) and amended into [SKILL.md](../../SKILL.md)
Sections 8 and 10.

Previous: [2026-10-18 — Pending CG Records laid out as Pending DCC Records, and Late only](0368-pending-records-one-design.md)
