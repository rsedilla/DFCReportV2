import { TextLink } from '@/components/ui/text-link';
import { isWithheld, type DuplicateCandidate, type ShownCandidate } from '@/lib/people';

const TAG_CLASS =
  'border-ink text-ink mr-2 inline-block border px-1.5 text-xs font-bold tracking-[0.06em] uppercase';

/**
 * What a candidate the reader may see in full says beneath their name and Member ID
 * (SKILL.md section 3).
 *
 * An archived candidate carries an *Archived* tag and asks for a restore rather than a
 * second record (decision 0404), with the reasons it matched beneath it. `adding` picks
 * the wording: on Edit details nobody is being added.
 */
export function MatchNote({
  candidate,
  adding,
  className,
}: {
  candidate: ShownCandidate;
  adding: boolean;
  className: string;
}) {
  const reasons = candidate.reasons.length ? (
    <ul className={`text-muted list-inside list-disc text-sm ${className}`}>
      {candidate.reasons.map((reason) => (
        <li key={reason}>{reason}</li>
      ))}
    </ul>
  ) : null;

  if (candidate.archived) {
    return (
      <>
        <p className={`text-muted text-sm leading-relaxed ${className}`}>
          <span className={TAG_CLASS}>Archived</span>
          This person was archived.{' '}
          {adding
            ? 'Ask the Admin to restore them instead of adding them again.'
            : 'If this is them, ask the Admin to restore them.'}
        </p>
        {reasons}
      </>
    );
  }

  return reasons;
}

/** The link to a candidate's record. */
export function MatchLink({
  candidate,
  className,
}: {
  candidate: ShownCandidate;
  className: string;
}) {
  return (
    <TextLink href={`/people/${candidate.id}`} className={className}>
      Open this record
    </TextLink>
  );
}

/**
 * The matches outside the reader's branch, as at most two lines naming nobody (decision
 * 0405): one if any of them is archived, which asks for a restore, and one if any is
 * not. The API sends each such match without a name, so there is nothing to tell two
 * of them apart by, and one line says what the reader needs: ask the Admin.
 */
export function OtherBranchMatches({
  candidates,
  adding,
  itemClassName,
}: {
  candidates: readonly DuplicateCandidate[];
  adding: boolean;
  itemClassName: string;
}) {
  const withheld = candidates.filter(isWithheld);
  const archived = withheld.some((candidate) => candidate.archived === true);
  const current = withheld.some((candidate) => candidate.archived !== true);

  return (
    <>
      {current ? (
        <li className={itemClassName}>
          <p className="text-muted text-sm leading-relaxed">
            Someone with a similar name is already recorded in another branch.{' '}
            {adding ? 'Ask the Admin before adding them.' : 'Ask the Admin before saving.'}
          </p>
        </li>
      ) : null}
      {archived ? (
        <li className={itemClassName}>
          <p className="text-muted text-sm leading-relaxed">
            <span className={TAG_CLASS}>Archived</span>
            Someone with a similar name in another branch was archived.{' '}
            {adding
              ? 'Ask the Admin to restore them instead of adding them again.'
              : 'If this is them, ask the Admin to restore them.'}
          </p>
        </li>
      ) : null}
    </>
  );
}
