'use client';

import { useQuery } from '@tanstack/react-query';
import { useId } from 'react';

import { longDay } from '@/components/growth-controls';
import { FRAME } from '@/components/ui/frame';
import { TextLink } from '@/components/ui/text-link';
import { ApiRequestError } from '@/lib/api-client';
import {
  PROGRAM_LABELS,
  TRAINING_PROGRAMS,
  listSuynlPeople,
  listTrainingPeople,
  type SuynlPerson,
  type TrainingPerson,
} from '@/lib/growth';
import { getMe } from '@/lib/me';

/**
 * One person's SUYNL and Training, read-only (SKILL.md section 28; owner's choice of
 * 2026-09-24).
 *
 * **No route of its own.** Each half is the Growth tab's own list, searched by this
 * person's Member ID and matched by `person_id`, so it shows exactly what that tab shows
 * the reader and nothing more. A half the reader cannot see, or a person the list does
 * not return (an archived person is listed on no Growth tab, decision 0279), is left out
 * rather than explained, and the frame goes with both.
 *
 * **Nothing is graded or coloured** (sections 17 and 19): counts, days and marks only.
 */
export function PersonGrowth({ personId, memberId }: { personId: string; memberId: string }) {
  const headingId = useId();
  const me = useQuery({ queryKey: ['me'], queryFn: ({ signal }) => getMe(signal) });
  const holds = (capability: string) =>
    (me.data?.capabilities ?? []).some((grant) => grant.capability === capability);

  const suynl = useQuery({
    queryKey: ['person-suynl', memberId],
    queryFn: ({ signal }) => listSuynlPeople({ q: memberId, limit: 1 }, signal),
    enabled: holds('suynl.view_subtree'),
    retry: false,
  });
  const training = useQuery({
    queryKey: ['person-training', memberId],
    queryFn: ({ signal }) => listTrainingPeople({ q: memberId, limit: 1 }, signal),
    enabled: holds('training.view_subtree'),
    retry: false,
  });

  const suynlRow = suynl.data?.data.find((row) => row.person_id === personId);
  const trainingRow = training.data?.data.find((row) => row.person_id === personId);
  const suynlFailed = failed(suynl.error);
  const trainingFailed = failed(training.error);

  if (!suynlRow && !trainingRow && !suynlFailed && !trainingFailed) {
    return null;
  }

  const search = `?q=${encodeURIComponent(memberId)}`;

  return (
    <section aria-labelledby={headingId} className={FRAME}>
      <h2 id={headingId} className="field-label">
        Growth
      </h2>
      <dl className="mt-3 flex flex-col gap-4">
        {suynlRow ? (
          <Suynl row={suynlRow} href={`/growth/suynl${search}`} />
        ) : suynlFailed ? (
          <Unavailable label="SUYNL" />
        ) : null}
        {trainingRow ? (
          <Training row={trainingRow} href={`/growth/training${search}`} />
        ) : trainingFailed ? (
          <Unavailable label="Training" />
        ) : null}
      </dl>
    </section>
  );
}

/** A failure that is not a refusal: a refusal hides the half, a failure says so. */
function failed(error: unknown): boolean {
  return (
    error !== null &&
    !(
      error instanceof ApiRequestError &&
      (error.code === 'CAPABILITY_DENIED' || error.code === 'SCOPE_DENIED')
    )
  );
}

const LESSONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

function Suynl({ row, href }: { row: SuynlPerson; href: string }) {
  const latest = row.lessons.reduce<string | null>(
    (day, lesson) => (day === null || lesson.filed_on > day ? lesson.filed_on : day),
    null,
  );

  return (
    <div>
      <dt className="text-sm font-medium">SUYNL</dt>
      <dd className="mt-1 text-sm">
        {latest === null ? (
          <span className="text-muted">No lessons yet</span>
        ) : (
          <>
            {row.lessons.length} of 10 lessons · latest {longDay(latest)}
          </>
        )}
        <ul className="mt-2 flex flex-wrap gap-1" aria-label="Lessons">
          {LESSONS.map((lesson) => {
            const done = row.lessons.some((entry) => entry.lesson === lesson);

            return (
              <li
                key={lesson}
                className="border-edge inline-flex size-6 items-center justify-center border text-xs"
              >
                <span aria-hidden="true">{done ? '✓' : ''}</span>
                <span className="sr-only">
                  Lesson {lesson}: {done ? 'done' : 'not done'}
                </span>
              </li>
            );
          })}
        </ul>
        <p className="mt-2">
          <TextLink href={href}>Open SUYNL</TextLink>
        </p>
      </dd>
    </div>
  );
}

function Training({ row, href }: { row: TrainingPerson; href: string }) {
  const graduated = TRAINING_PROGRAMS.flatMap((program) =>
    row.graduations.filter((entry) => entry.program === program),
  );

  return (
    <div>
      <dt className="text-sm font-medium">Training</dt>
      <dd className="mt-1 text-sm">
        {graduated.length === 0 ? (
          <span className="text-muted">No graduations yet</span>
        ) : (
          <>
            {graduated.length} of 5
            <ul className="mt-1">
              {graduated.map((entry) => (
                <li key={entry.id}>
                  {PROGRAM_LABELS[entry.program]} ·{' '}
                  {entry.graduated_on ? (
                    longDay(entry.graduated_on)
                  ) : (
                    <span className="text-muted">no date</span>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
        <p className="mt-2">
          <TextLink href={href}>Open Training</TextLink>
        </p>
      </dd>
    </div>
  );
}

function Unavailable({ label }: { label: string }) {
  return (
    <div>
      <dt className="text-sm font-medium">{label}</dt>
      <dd className="text-muted mt-1 text-sm">Couldn&rsquo;t load this just now.</dd>
    </div>
  );
}
