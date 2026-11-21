'use client';

import Link from 'next/link';

import { TeachFrame } from '@/components/teach-frame';
import { timeLabel } from '@/lib/cells';
import { DAY_NAMES, type MyClass } from '@/lib/equipping';
import { useMyClasses } from '@/lib/my-classes';

/**
 * The classes the reader teaches or guides (decision 0501, point 21), each opening its lessons
 * and register. **Grouped by what the reader does in each**, *Classes you teach* first, as Google
 * Classroom splits Teaching from Enrolled and Canvas lists a teacher's courses before the rest.
 * The item is drawn only while there is one.
 */
export default function TeachPage() {
  const { classes: unsorted, loading } = useMyClasses();
  const classes = [...unsorted].sort((a, b) => a.name.localeCompare(b.name));
  const teaching = classes.filter((each) => each.role === 'TEACHER');
  const guiding = classes.filter((each) => each.role === 'GUIDE');
  return (
    <TeachFrame title="Equipping" lead="The classes you teach or guide.">
      {loading ? (
        <p className="text-muted text-sm">Loading…</p>
      ) : classes.length === 0 ? (
        <p className="text-muted text-sm">You do not teach or guide a class this term.</p>
      ) : (
        <div className="flex flex-col gap-6">
          <ClassGroup title="Classes you teach" note="You record each lesson and its make-ups." classes={teaching} />
          <ClassGroup title="Classes you guide" note="You see your own students. You record nothing." classes={guiding} />
        </div>
      )}
    </TeachFrame>
  );
}

function ClassGroup({ title, note, classes }: { title: string; note: string; classes: MyClass[] }) {
  if (classes.length === 0) {
    return null;
  }
  return (
    <section aria-label={title}>
      <h2 className="font-semibold">
        {title} · {classes.length}
      </h2>
      <p className="text-muted text-sm">{note}</p>
      <ul className="mt-3 flex flex-col gap-3">
        {classes.map((each) => (
          <li key={each.id}>
            <Link
              href={`/equipping/teach/${each.id}`}
              className="border-line bg-surface hover:bg-raised flex min-h-13 flex-col rounded-xl border px-4 py-3"
            >
              <span className="font-semibold">{each.name}</span>
              <span className="text-muted text-sm">
                {DAY_NAMES[each.day_of_week - 1]} {timeLabel(each.time_of_day)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
