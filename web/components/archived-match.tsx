import { TextLink } from '@/components/ui/text-link';
import { isWithheld, type DuplicateCandidate } from '@/lib/people';

/**
 * What a duplicate candidate says beneath their name and Member ID (SKILL.md section 3).
 *
 * An archived candidate carries an *Archived* tag and asks for a restore rather than a second
 * record (decision 0404), in place of the reasons or the possible-match line. `adding` picks the
 * wording: on Edit details nobody is being added.
 */
export function MatchNote({
  candidate,
  adding,
  withheldLine,
  className,
}: {
  candidate: DuplicateCandidate;
  adding: boolean;
  withheldLine: string;
  className: string;
}) {
  if (candidate.archived) {
    return (
      <p className={`text-muted text-sm leading-relaxed ${className}`}>
        <span className="border-ink text-ink mr-2 inline-block border px-1.5 text-xs font-bold tracking-[0.06em] uppercase">
          Archived
        </span>
        This person was archived.{' '}
        {adding
          ? 'Ask the Admin to restore them instead of adding them again.'
          : 'If this is them, ask the Admin to restore them.'}
      </p>
    );
  }

  if (isWithheld(candidate)) {
    return <p className={`text-muted text-sm leading-relaxed ${className}`}>{withheldLine}</p>;
  }

  return candidate.reasons?.length ? (
    <ul className={`text-muted list-inside list-disc text-sm ${className}`}>
      {candidate.reasons.map((reason) => (
        <li key={reason}>{reason}</li>
      ))}
    </ul>
  ) : null;
}

/**
 * The link to a candidate's record, left out for an archived candidate whose details are
 * withheld: the page would show the reader only what the list already does (decision 0404).
 */
export function MatchLink({
  candidate,
  className,
}: {
  candidate: DuplicateCandidate;
  className: string;
}) {
  if (candidate.archived && isWithheld(candidate)) {
    return null;
  }

  return (
    <TextLink href={`/people/${candidate.id}`} className={className}>
      Open this record
    </TextLink>
  );
}
