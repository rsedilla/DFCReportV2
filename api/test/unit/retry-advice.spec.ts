import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Advice must sit on the same side of section 22's store/release split as the status
 * carrying it (the ruling of 2026-08-31, written into section 22).
 *
 * **Why a scan over the source rather than a case per refusal.** The rule is decided per
 * call site, and of the four refusals the 2026-08-31 ruling moved, three cannot be reached
 * by any request this API accepts — and no single argument covers them, which is worth
 * stating because one of the reasons is weaker than the rest:
 *
 * - the pre-read comparison in `approve` guards three values. `requested_by` is frozen
 *   by `cell_leadership_request_is_final`, and `cell_id`'s *nullness* is tied to a
 *   frozen `kind` by a check constraint — both enforced in the database. `cell_id`'s
 *   **value** on a PENDING handover is frozen by nothing; it is unreached because no
 *   code writes it, and whether it should be frozen is on `CLAUDE.md`'s open list;
 * - the two refusals in `assertHandoverApprovableWithin` rest on none of that: a closed
 *   Cell is refused earlier by `state`, `cell_leadership_requests_one_pending_handover`
 *   permits one pending handover per Cell, and both callers of `insert-cell.ts` write a
 *   different Cell.
 *
 * An end-to-end case cannot pin what it cannot reach, and a fixture contrived to reach
 * them would assert against a state the database refuses.
 *
 * *A first version of this docblock gave one argument — the trigger and the check
 * constraint — for all of them. It covers two of the three values in the first site and
 * nothing in the other two, which is the shape section 25 rule 19 is about.*
 *
 * What *is* checkable is the pairing, and it is checkable everywhere at once —
 * including at sites Stage 4 has not written yet, which is the point. The defect this
 * catches is the one `floorBreach` carried and documented against itself: a 409 whose
 * message says "retry", where section 22 stores the 409 and replays it for the whole
 * retention, so the client's retry is answered with the refusal.
 *
 * **The two halves are not one rule stated twice.**
 *
 * A stored refusal (4xx) may not tell the client to retry, because a retry of that key
 * replays the refusal. What it owes instead is what to change; section 22 deliberately
 * does *not* also require it to say that a new key is needed, because the rule that a
 * key belongs to a body already settles that for a client changing one.
 *
 * A released refusal (5xx) may not tell the client to mint a new key, because the key
 * was released and is the right one to reuse. Sending the client to mint one is not
 * merely redundant: section 22 makes a key belong to a body, so a client minting a new
 * key for an unchanged body has been pointed at the dead end from the other side.
 */
describe('retry advice matches the status carrying it (section 22)', () => {
  const SOURCE = join(__dirname, '..', '..', 'src');

  /** Every `.ts` under `src`, so a service added later is covered without being listed. */
  function sourceFiles(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = join(directory, entry.name);

      if (entry.isDirectory()) return sourceFiles(path);
      return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
    });
  }

  /**
   * The single-quoted string literals inside each `new <constructor>(...)` call, joined,
   * which for every refusal in this codebase is the message it was given.
   *
   * Scanned rather than parsed, and deliberately naive: it reads what a reviewer reads.
   * A message assembled from a variable escapes it. That is a limit worth stating rather
   * than engineering around — every refusal here writes its message inline, and one that
   * stops doing so should be noticed rather than silently exempted.
   */
  function messagesOf(source: string, constructor: string): string[] {
    const messages: string[] = [];
    const opener = `new ${constructor}(`;

    for (let at = source.indexOf(opener); at !== -1; at = source.indexOf(opener, at + 1)) {
      const literals: string[] = [];
      let depth = 1;
      let index = at + opener.length;

      while (index < source.length && depth > 0) {
        const character = source[index];

        if (character === "'") {
          // Walk the literal, honouring an escaped quote so that a message containing
          // one does not end the scan early.
          let literal = '';
          index += 1;

          while (index < source.length && source[index] !== "'") {
            if (source[index] === '\\') index += 1;
            literal += source[index];
            index += 1;
          }

          literals.push(literal);
        } else if (character === '(') {
          depth += 1;
        } else if (character === ')') {
          depth -= 1;
        }

        index += 1;
      }

      messages.push(literals.join(''));
    }

    return messages;
  }

  const files = sourceFiles(SOURCE).map((path) => ({
    path,
    source: readFileSync(path, 'utf8'),
  }));

  it('finds the refusals it is scanning, so a rename cannot make it vacuous', () => {
    // **The disjunction-with-no-members guard.** Both cases below pass over an empty
    // set, so a scanner that stopped matching — a renamed error class, a call written
    // some other way — would turn this whole file green and silent. Asserted loosely,
    // as "there are several", so ordinary additions need not update a number.
    const invariant = files.flatMap((file) => messagesOf(file.source, 'InvariantViolationError'));
    const busy = files.flatMap((file) => messagesOf(file.source, 'ResourceBusyError'));

    expect(invariant.filter((message) => message !== '').length).toBeGreaterThan(10);
    expect(busy.filter((message) => message !== '').length).toBeGreaterThan(0);
  });

  /**
   * The imperative *Retry* — the word opening a sentence — which is what advising a
   * retry looks like in this codebase's messages.
   *
   * **Narrower than "mentions retrying", and the difference is not a tuning.** Three
   * messages name retrying in order to rule it out: two say "report it rather than
   * retrying" and one says "retrying will not help", all on refusals that are correctly
   * 4xx and correctly permanent. A predicate that flagged those would be flagging
   * messages for saying the right thing, and the way past it would have been an
   * exception list. The distinction the rule actually cares about is whether the client
   * is being *told to* retry, and an imperative is that.
   */
  const ADVISES_A_RETRY = /(^|[.;:!?]\s+)Retry\b/;

  it('never tells a client to retry a refusal that is stored against its key', () => {
    // A 4xx is stored and replayed for the retention (section 22), so "Retry" is advice
    // to receive this same refusal again.
    const offenders = files.flatMap((file) =>
      messagesOf(file.source, 'InvariantViolationError')
        .filter((message) => ADVISES_A_RETRY.test(message))
        .map((message) => `${file.path}: ${message}`),
    );

    expect(offenders).toEqual([]);
  });

  it('recognises the imperative it is looking for, against the messages that carry it', () => {
    // **Otherwise the case above is a predicate that matches nothing, passing.** The
    // four refusals the 2026-08-31 ruling moved all say "Retry in a moment", so the
    // scanner meets the phrase it is written for on the other side of the split; if it
    // stopped recognising it, the case above would go green over the exact defect it
    // exists for.
    const advising = files.flatMap((file) =>
      messagesOf(file.source, 'ResourceBusyError').filter((message) =>
        ADVISES_A_RETRY.test(message),
      ),
    );

    expect(advising.length).toBeGreaterThan(0);

    // And it does not fire on the three that mention retrying to forbid it, which is
    // the false positive the predicate was narrowed against.
    expect(ADVISES_A_RETRY.test('Report it; retrying will not help.')).toBe(false);
    expect(ADVISES_A_RETRY.test('This is a data defect: report it rather than retrying.')).toBe(
      false,
    );
  });

  it('never tells a client to mint a new key for a refusal that released the one it had', () => {
    // A 5xx releases the key, so the same key is the one to reuse.
    const offenders = files.flatMap((file) =>
      messagesOf(file.source, 'ResourceBusyError')
        .filter((message) => message.toLowerCase().includes('idempotency-key'))
        .map((message) => `${file.path}: ${message}`),
    );

    expect(offenders).toEqual([]);
  });
});
