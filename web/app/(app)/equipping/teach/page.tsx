'use client';

import Link from 'next/link';

import { TeachFrame } from '@/components/teach-frame';
import { timeLabel } from '@/lib/cells';
import { DAY_NAMES } from '@/lib/equipping';
import { useMyClasses } from '@/lib/my-classes';

/**
 * The classes the reader teaches or guides (decision 0501, point 21), each opening its lessons
 * and register. The item is drawn only while there is one.
 */
export default function TeachPage() {
  const { classes } = useMyClasses();
  return (
    <TeachFrame title="Equipping" lead="The classes you teach or guide.">
      {classes.length === 0 ? (
        <p className="text-muted text-sm">You do not teach or guide a class this term.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {classes.map((each) => (
            <li key={each.id}>
              <Link
                href={`/equipping/teach/${each.id}`}
                className="border-line bg-surface hover:bg-raised flex min-h-13 flex-col rounded-xl border px-4 py-3"
              >
                <span className="font-semibold">{each.name}</span>
                <span className="text-muted text-sm">
                  {DAY_NAMES[each.day_of_week - 1]} {timeLabel(each.time_of_day)} ·{' '}
                  {each.role === 'TEACHER' ? 'You teach this class' : 'You guide in this class'}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </TeachFrame>
  );
}
