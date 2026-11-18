'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { EquippingFrame, TermPicker, TextBox, Tick } from '@/components/equipping-frame';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { FailureNotice } from '@/components/ui/failure-notice';
import { Field, SearchField } from '@/components/ui/field';
import { CONTROL_BAR, FRAME } from '@/components/ui/frame';
import { SelectField } from '@/components/ui/select-field';
import { timeLabel } from '@/lib/cells';
import { HeaderCell, Table, rowClasses } from '@/components/ui/table';
import {
  DAY_NAMES,
  currentTerm,
  enroll,
  getClass,
  listClasses,
  listSeasons,
  moveEnrollment,
  openClass,
  searchPeople,
  termLabel,
  withdrawEnrollment,
  type ClassDetail,
  type FoundPerson,
  type Term,
} from '@/lib/equipping';
import { describeFailure } from '@/lib/messages';
import { cn } from '@/lib/utils';

/**
 * Enrollment (SKILL.md section 29, decision 0499, points 10 and 11): the term's classes, and
 * putting registered people into one.
 *
 * **Two checks are never overridden**: a birthday recorded, and 15 on the first day of the
 * person's own Network's Encounter weekend. Somebody failing either has no tick box, and the
 * row says why. Several are enrolled at once; a move keeps them in the term, and a
 * withdrawal is kept with its reason.
 */
export default function EnrollmentPage() {
  const [term, setTerm] = useState<Term>(() => currentTerm());
  const [chosen, setChosen] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  const classes = useQuery({
    queryKey: ['equipping', 'classes', term],
    queryFn: ({ signal }) => listClasses(term, signal),
  });
  // A class chosen in another term is not one of this term's, so the first is shown instead.
  const classId =
    (chosen !== null && classes.data?.data.some((each) => each.id === chosen) ? chosen : null) ??
    classes.data?.data[0]?.id ??
    null;

  return (
    <EquippingFrame current="/equipping/enrollment" title="Enrollment" lead="Put registered people into a class.">
      <div className={CONTROL_BAR}>
        <TermPicker term={term} onChange={setTerm} />
        <div className="flex flex-wrap gap-2" role="group" aria-label="Classes">
          {(classes.data?.data ?? []).map((each) => (
            <Button
              key={each.id}
              type="button"
              variant={each.id === classId ? 'primary' : 'secondary'}
              aria-pressed={each.id === classId}
              className="py-1.5"
              onClick={() => setChosen(each.id)}
            >
              {/* Two lines (owner, 2026-11-18): the name, then when it meets and how many are in
                  it, the count saying what it counts. */}
              <span className="flex flex-col items-start leading-tight">
                <span>{each.name}</span>
                <span className="text-xs font-normal">
                  {DAY_NAMES[each.day_of_week - 1].slice(0, 3)} {timeLabel(each.time_of_day)} · {each.enrolled}{' '}
                  enrolled
                </span>
              </span>
            </Button>
          ))}
        </div>
        <div className="lg:ml-auto">
          <Button type="button" variant="secondary" onClick={() => setOpening(true)}>
            Open a class
          </Button>
        </div>
      </div>
      <FailureNotice failure={classes.isError ? describeFailure(classes.error) : null} />
      {classes.data && classes.data.data.length === 0 ? (
        <p className="text-muted mt-4 text-sm">No Life Class is open in {termLabel(term)} yet. Open one first.</p>
      ) : null}
      {classId ? <ClassView key={classId} classId={classId} classes={classes.data?.data ?? []} /> : null}
      <OpenClassDialog
        term={term}
        open={opening}
        onClose={() => setOpening(false)}
        onOpened={(id) => setChosen(id)}
      />
    </EquippingFrame>
  );
}

function ClassView({
  classId,
  classes,
}: {
  classId: string;
  classes: { id: string; name: string }[];
}) {
  const queryClient = useQueryClient();
  const detail = useQuery({
    queryKey: ['equipping', 'class', classId],
    queryFn: ({ signal }) => getClass(classId, signal),
  });
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [moving, setMoving] = useState<ClassDetail['enrolled'][number] | null>(null);
  const [withdrawing, setWithdrawing] = useState<ClassDetail['enrolled'][number] | null>(null);
  // Who the last Enroll placed, said back once it has saved (owner, 2026-11-18).
  const [justEnrolled, setJustEnrolled] = useState<string[]>([]);

  const save = useMutation({
    mutationFn: (names: string[]) => enroll(classId, [...ticked], key).then(() => names),
    onSuccess: async (names) => {
      setJustEnrolled(names);
      setTicked(new Set());
      setKey(crypto.randomUUID());
      await queryClient.invalidateQueries({ queryKey: ['equipping'] });
    },
  });

  if (detail.isError) {
    return <FailureNotice failure={describeFailure(detail.error)} />;
  }
  if (!detail.data) {
    return <p className="text-muted mt-4 text-sm">Loading&hellip;</p>;
  }
  const cls = detail.data.class;
  const enrollable = detail.data.ready.filter((row) => row.blocked === null);
  const waiting = detail.data.ready.filter((row) => row.blocked !== null);
  const tick = (registrationId: string, checked: boolean) => {
    setJustEnrolled([]);
    const next = new Set(ticked);
    if (checked) {
      next.add(registrationId);
    } else {
      next.delete(registrationId);
    }
    setTicked(next);
  };

  return (
    <>
      <div className={cn(FRAME, 'mt-4')}>
        <h2 className="text-lg font-semibold">{cls.name}</h2>
        <p className="text-muted mt-1 text-sm">
          {DAY_NAMES[cls.day_of_week - 1]}s, {timeLabel(cls.time_of_day)}
          {cls.place ? ` · ${cls.place}` : ''} · Teacher: {cls.teacher.full_name} · Starts {cls.first_lesson_on}
          {' · '}Encounter weekend: men {cls.encounter_weekends.mens}, women {cls.encounter_weekends.womens}
        </p>
        <p className="text-muted mt-1 text-sm">Run by: the church (Equipping)</p>
      </div>

      <h2 className="mt-6 text-lg font-semibold">
        Ready to enroll <span className="text-muted text-sm font-normal">· registered for Life Class, in no class yet</span>
      </h2>
      {justEnrolled.length > 0 ? (
        <p role="status" className="border-accent text-ink bg-surface mt-2 rounded-xl border px-4 py-3 text-sm font-semibold">
          Enrolled in {cls.name}: {justEnrolled.join(', ')}.
        </p>
      ) : null}
      {detail.data.ready.length === 0 ? (
        <p className="text-muted mt-2 text-sm">Nobody registered is waiting for a class.</p>
      ) : (
        <>
          {/* Those who can be enrolled first, with the Enroll button under them, and those
              who cannot after, in a group of their own (owner, 2026-11-18). */}
          {enrollable.length > 0 ? (
            <>
              {enrollable.length > 1 ? (
                <Button
                  type="button"
                  variant="quiet"
                  className="mt-1"
                  onClick={() => {
                    setJustEnrolled([]);
                    setTicked(new Set(enrollable.map((row) => row.registration_id)));
                  }}
                >
                  Tick all who can be enrolled ({enrollable.length})
                </Button>
              ) : null}
              <ReadyRows rows={enrollable} caption={`Ready to enroll in ${cls.name}`} ticked={ticked} onTick={tick} />
              <FailureNotice failure={save.isError ? describeFailure(save.error) : null} />
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  disabled={ticked.size === 0 || save.isPending}
                  onClick={() =>
                    save.mutate(
                      enrollable.filter((row) => ticked.has(row.registration_id)).map((row) => row.person.full_name ?? 'someone'),
                    )
                  }
                >
                  Enroll {ticked.size} in {cls.name}
                </Button>
                <p className="text-muted text-sm">
                  {ticked.size} of the {enrollable.length} who can be enrolled {ticked.size === 1 ? 'is' : 'are'}{' '}
                  ticked
                </p>
              </div>
            </>
          ) : (
            <p className="text-muted mt-2 text-sm">Nobody waiting can be enrolled yet.</p>
          )}
          {waiting.length > 0 ? (
            <>
              <h3 className="mt-6 font-semibold">
                Can&rsquo;t enroll yet{' '}
                <span className="text-muted text-sm font-normal">
                  · {waiting.length} · their leader fixes what is missing
                </span>
              </h3>
              <ReadyRows rows={waiting} caption={`Can't enroll in ${cls.name} yet`} ticked={ticked} onTick={tick} />
            </>
          ) : null}
        </>
      )}

      <h2 className="mt-8 text-lg font-semibold">
        In this class <span className="text-muted text-sm font-normal">· {detail.data.enrolled.length} enrolled</span>
      </h2>
      {detail.data.enrolled.length === 0 ? (
        <p className="text-muted mt-2 text-sm">Nobody yet.</p>
      ) : (
        <ul className="border-line mt-2 rounded-md border">
          {detail.data.enrolled.map((row) => (
            <li key={row.enrollment_id} className="border-line flex flex-wrap items-center justify-between gap-2 border-b px-3 py-1 last:border-b-0">
              <span>{row.person.full_name}</span>
              <span className="flex gap-1">
                {classes.length > 1 ? (
                  <Button type="button" variant="quiet" onClick={() => setMoving(row)}>
                    Move<span className="sr-only"> {row.person.full_name}</span>
                  </Button>
                ) : null}
                <Button type="button" variant="quiet" onClick={() => setWithdrawing(row)}>
                  Withdraw<span className="sr-only"> {row.person.full_name}</span>
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <MoveDialog
        enrolled={moving}
        classes={classes.filter((each) => each.id !== classId)}
        onClose={() => setMoving(null)}
      />
      <WithdrawDialog enrolled={withdrawing} onClose={() => setWithdrawing(null)} />
    </>
  );
}

function MoveDialog({
  enrolled,
  classes,
  onClose,
}: {
  enrolled: ClassDetail['enrolled'][number] | null;
  classes: { id: string; name: string }[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [to, setTo] = useState('');
  const [key, setKey] = useState(() => crypto.randomUUID());
  const move = useMutation({
    mutationFn: () => moveEnrollment(enrolled!.enrollment_id, to, key),
    onSuccess: async () => {
      setKey(crypto.randomUUID());
      setTo('');
      await queryClient.invalidateQueries({ queryKey: ['equipping'] });
      onClose();
    },
  });
  return (
    <Dialog open={enrolled !== null} onClose={onClose} title={`Move ${enrolled?.person.full_name ?? ''}`}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (to !== '') {
            move.mutate();
          }
        }}
      >
        <SelectField label="To class" value={to} onChange={(event) => setTo(event.target.value)} required>
          <option value="">Choose a class</option>
          {classes.map((each) => (
            <option key={each.id} value={each.id}>
              {each.name}
            </option>
          ))}
        </SelectField>
        <FailureNotice failure={move.isError ? describeFailure(move.error) : null} />
        <div className="flex flex-col gap-3 lg:flex-row">
          <Button type="submit" disabled={move.isPending}>
            Move
          </Button>
          <Button type="button" variant="quiet" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function WithdrawDialog({
  enrolled,
  onClose,
}: {
  enrolled: ClassDetail['enrolled'][number] | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [key, setKey] = useState(() => crypto.randomUUID());
  const withdraw = useMutation({
    mutationFn: () => withdrawEnrollment(enrolled!.enrollment_id, reason.trim(), key),
    onSuccess: async () => {
      setKey(crypto.randomUUID());
      setReason('');
      await queryClient.invalidateQueries({ queryKey: ['equipping'] });
      onClose();
    },
  });
  return (
    <Dialog open={enrolled !== null} onClose={onClose} title={`Withdraw ${enrolled?.person.full_name ?? ''}`}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (reason.trim() !== '') {
            withdraw.mutate();
          }
        }}
      >
        <TextBox label="Why" value={reason} onChange={setReason} required />
        <FailureNotice failure={withdraw.isError ? describeFailure(withdraw.error) : null} />
        <div className="flex flex-col gap-3 lg:flex-row">
          <Button type="submit" disabled={withdraw.isPending}>
            Withdraw
          </Button>
          <Button type="button" variant="quiet" onClick={onClose} data-autofocus>
            Keep them
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function OpenClassDialog({
  term,
  open,
  onClose,
  onOpened,
}: {
  term: Term;
  open: boolean;
  onClose: () => void;
  onOpened: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const seasons = useQuery({
    queryKey: ['equipping', 'seasons'],
    queryFn: ({ signal }) => listSeasons(signal),
    enabled: open,
  });
  const [name, setName] = useState('');
  const [day, setDay] = useState('2');
  const [time, setTime] = useState('19:00');
  const [place, setPlace] = useState('');
  const [firstLesson, setFirstLesson] = useState('');
  const [season, setSeason] = useState('');
  const [teacherQuery, setTeacherQuery] = useState('');
  const [searched, setSearched] = useState<string | null>(null);
  const [teacher, setTeacher] = useState<FoundPerson | null>(null);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [showErrors, setShowErrors] = useState(false);

  const found = useQuery({
    queryKey: ['equipping', 'search', searched],
    queryFn: ({ signal }) => searchPeople(searched!, signal),
    enabled: searched !== null,
  });
  const save = useMutation({
    mutationFn: () =>
      openClass(
        {
          ...term,
          name: name.trim(),
          day_of_week: Number(day),
          time_of_day: time,
          ...(place.trim() ? { place: place.trim() } : {}),
          first_lesson_on: firstLesson,
          teacher_person_id: teacher!.id,
          encounter_season_id: season,
        },
        key,
      ),
    onSuccess: async (created) => {
      setKey(crypto.randomUUID());
      await queryClient.invalidateQueries({ queryKey: ['equipping', 'classes'] });
      onOpened(created.id);
      onClose();
    },
  });
  const complete = name.trim() !== '' && firstLesson !== '' && season !== '' && teacher !== null;

  return (
    <Dialog open={open} onClose={onClose} title="Open a class">
      <p className="text-muted text-sm">
        Life Class, {termLabel(term)}. You add the other faculty on the Faculty page.
      </p>
      <form
        className="mt-4 flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          setShowErrors(true);
          if (complete) {
            save.mutate();
          }
        }}
      >
        <p className="text-sm">
          <span className="field-label">Run by</span>
          <br />
          The church (Equipping). Later, a Primary can run classes for the people in their care.
        </p>
        <Field label="Class name" autoComplete="off" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required />
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField label="Day" value={day} onChange={(event) => setDay(event.target.value)}>
            {DAY_NAMES.map((each, index) => (
              <option key={each} value={String(index + 1)}>
                {each}
              </option>
            ))}
          </SelectField>
          <Field label="Time" type="time" autoComplete="off" value={time} onChange={(event) => setTime(event.target.value)} required />
        </div>
        <Field label="Place" autoComplete="off" value={place} onChange={(event) => setPlace(event.target.value)} maxLength={80} />
        <Field label="First lesson" type="date" autoComplete="off" value={firstLesson} onChange={(event) => setFirstLesson(event.target.value)} required />
        {teacher === null ? (
          <div>
            <SearchField
              label="Teacher"
              description="At least three letters of their name."
              autoComplete="off"
              value={teacherQuery}
              onChange={(event) => setTeacherQuery(event.target.value)}
              action={
                <Button type="button" variant="secondary" onClick={() => setSearched(teacherQuery.trim())}>
                  Search
                </Button>
              }
            />
            <FailureNotice failure={found.isError ? describeFailure(found.error) : null} />
            <ul className="mt-2 flex flex-col gap-1">
              {(found.data?.data ?? []).map((each) => (
                <li key={each.id}>
                  <Button type="button" variant="quiet" className="w-full justify-start" onClick={() => setTeacher(each)}>
                    {each.full_name} · {each.member_id}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div>
            <p className="field-label">Teacher</p>
            <div className="border-edge mt-1.5 flex items-center justify-between rounded-md border px-3 py-1">
              <span className="font-semibold">{teacher.full_name}</span>
              <Button type="button" variant="quiet" onClick={() => setTeacher(null)}>
                Change
              </Button>
            </div>
            <p className="text-muted mt-1 text-sm">
              Later, {teacher.full_name} types this class&rsquo;s weekly grades from their own account.
            </p>
          </div>
        )}
        <SelectField label="Encounter weekend" value={season} onChange={(event) => setSeason(event.target.value)} required>
          <option value="">Choose a season</option>
          {(seasons.data?.data ?? []).map((each) => (
            <option key={each.id} value={each.id}>
              Men {each.mens_encounter_on} · Women {each.womens_encounter_on}
            </option>
          ))}
        </SelectField>
        {showErrors && !complete ? (
          <p className="text-field-invalid text-sm">Fill in the name, first lesson, Teacher and Encounter weekend.</p>
        ) : null}
        <FailureNotice failure={save.isError ? describeFailure(save.error) : null} />
        <div className="flex flex-col gap-3 lg:flex-row">
          <Button type="submit" disabled={save.isPending}>
            Open class
          </Button>
          <Button type="button" variant="quiet" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

type ReadyRow = ClassDetail['ready'][number];

/**
 * Why a person cannot be enrolled, said as what is missing and who mends it. The API's
 * reason is the source; this only words it for the Equipper (owner, 2026-11-18).
 */
function blockedText(blocked: string): string {
  const age = /^(\d+) on (\S+), under (\d+) for the Encounter$/.exec(blocked);
  if (age) {
    return `${age[1]} on ${age[2]}, the Encounter weekend. Must be ${age[3]}.`;
  }
  if (blocked === 'no birthday recorded') {
    return 'No birthday recorded. Ask their leader to add it.';
  }
  return `${blocked.charAt(0).toUpperCase()}${blocked.slice(1)}.`;
}

/**
 * The people waiting for a class: a table on a wider screen and a card each on a phone
 * (owner, 2026-11-18). The name is the tick box's label; somebody who cannot be enrolled has
 * no box, and the reason sits under their name.
 */
function ReadyRows({
  rows,
  caption,
  ticked,
  onTick,
}: {
  rows: ReadyRow[];
  caption: string;
  ticked: ReadonlySet<string>;
  onTick: (registrationId: string, checked: boolean) => void;
}) {
  return (
    <>
      <Table caption={caption} className="mt-2 hidden sm:block" tableClassName="table-fixed">
        <thead>
          <tr>
            <HeaderCell className="w-16">
              <span className="sr-only">Choose</span>
            </HeaderCell>
            <HeaderCell className="w-[34%]">Name</HeaderCell>
            <HeaderCell>Leader</HeaderCell>
            <HeaderCell className="w-44">Age at the Encounter</HeaderCell>
            <HeaderCell>Registration</HeaderCell>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.registration_id} className={rowClasses}>
              <td className="px-3 py-2 align-top">
                {row.blocked === null ? (
                  <Tick
                    checked={ticked.has(row.registration_id)}
                    onChange={(checked) => onTick(row.registration_id, checked)}
                  >
                    <span className="sr-only">Enroll {row.person.full_name}</span>
                  </Tick>
                ) : null}
              </td>
              <td className="px-3 py-3 align-top">
                {row.person.full_name}
                {row.blocked ? (
                  <span className="text-field-invalid block text-sm">{blockedText(row.blocked)}</span>
                ) : null}
              </td>
              <td className="px-3 py-3 align-top">{row.leader_name ?? 'No leader yet'}</td>
              <td className="px-3 py-3 align-top">{row.age_at_encounter ?? '—'}</td>
              <td className="px-3 py-3 align-top">{row.with_exception ? 'Registered with exception' : 'Registered'}</td>
            </tr>
          ))}
        </tbody>
      </Table>
      <ul aria-label={caption} className="border-line divide-line bg-surface mt-2 divide-y rounded-xl border sm:hidden">
        {rows.map((row) => (
          <li key={row.registration_id} className="px-3 py-2">
            {row.blocked === null ? (
              <Tick checked={ticked.has(row.registration_id)} onChange={(checked) => onTick(row.registration_id, checked)}>
                {row.person.full_name}
              </Tick>
            ) : (
              <>
                <p className="pt-2 text-sm font-semibold">{row.person.full_name}</p>
                <p className="text-field-invalid text-sm">{blockedText(row.blocked)}</p>
              </>
            )}
            <p className="text-muted pb-1 text-sm">
              {row.leader_name ?? 'No leader yet'}
              {row.age_at_encounter !== null ? ` · ${row.age_at_encounter} at the Encounter` : ''}
              {' · '}
              {row.with_exception ? 'Registered with exception' : 'Registered'}
            </p>
          </li>
        ))}
      </ul>
    </>
  );
}
