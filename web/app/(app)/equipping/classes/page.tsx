'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { EquippingFrame, TermPicker } from '@/components/equipping-frame';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { FailureNotice } from '@/components/ui/failure-notice';
import { Field, SearchField } from '@/components/ui/field';
import { CONTROL_BAR } from '@/components/ui/frame';
import { SelectField } from '@/components/ui/select-field';
import { HeaderCell, Table, rowClasses } from '@/components/ui/table';
import { timeLabel } from '@/lib/cells';
import {
  DAY_NAMES,
  currentTerm,
  listClassStudents,
  listCoordinatedClasses,
  listCoordinatorSeasons,
  openClass,
  searchTeachers,
  setTeacher,
  teacherClash,
  termLabel,
  type CellClash,
  type CoordinatedClass,
  type FoundPerson,
  type Term,
} from '@/lib/equipping';
import { idempotencyKeyFor, useWriteKey } from '@/lib/idempotency';
import { describeFailure } from '@/lib/messages';

/**
 * The Coordinator's *Classes* (SKILL.md section 29, decision 0501, point 22): a level's classes
 * in a term, laid out like Mapúa's COMS as the owner chose on 2026-11-20. The Coordinator opens
 * a class and names its Teacher; a problem is said in words, never by colour alone (section 19).
 * Guides and attendance join the table with the steps that build them.
 */
type StatusFilter = 'ALL' | CoordinatedClass['status'];

const STATUS_LABELS: Record<CoordinatedClass['status'], string> = {
  NOT_STARTED: 'Not started',
  RUNNING: 'Running',
};

export default function ClassesPage() {
  const [term, setTerm] = useState<Term>(() => currentTerm());
  const [status, setStatus] = useState<StatusFilter>('ALL');
  const [opening, setOpening] = useState(false);
  const [editing, setEditing] = useState<CoordinatedClass | null>(null);
  const [viewing, setViewing] = useState<CoordinatedClass | null>(null);

  const classes = useQuery({
    queryKey: ['equipping', 'coordinate', 'classes', term],
    queryFn: ({ signal }) => listCoordinatedClasses(term, signal),
  });
  const shown = (classes.data?.data ?? []).filter((each) => status === 'ALL' || each.status === status);

  return (
    <EquippingFrame current="/equipping/classes" title="Classes" lead="Life Class, which you coordinate.">
      <div className={CONTROL_BAR}>
        <TermPicker term={term} onChange={setTerm} />
        <SelectField
          label="Status"
          value={status}
          onChange={(event) => setStatus(event.target.value as StatusFilter)}
        >
          <option value="ALL">All</option>
          <option value="NOT_STARTED">Not started</option>
          <option value="RUNNING">Running</option>
        </SelectField>
        <div className="lg:ml-auto">
          <Button type="button" onClick={() => setOpening(true)}>
            Open a class
          </Button>
        </div>
      </div>
      <FailureNotice failure={classes.isError ? describeFailure(classes.error) : null} />
      {classes.data && shown.length === 0 ? (
        <p className="text-muted mt-4 text-sm">
          {classes.data.data.length === 0
            ? `No Life Class is open in ${termLabel(term)} yet.`
            : 'No class has that status.'}
        </p>
      ) : null}
      {shown.length > 0 ? (
        <>
          {/* A card a class on a phone, as the owner chose for the installed app (decision 0501). */}
          <ul className="mt-4 flex flex-col gap-3 lg:hidden">
            {shown.map((each) => (
              <li key={each.id} className="border-line bg-surface rounded-xl border p-4 shadow-sm">
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="font-semibold">{each.name}</h2>
                  <span className="text-muted text-sm">{STATUS_LABELS[each.status]}</span>
                </div>
                <p className="text-muted text-sm">
                  {when(each)} · {each.enrolled} {each.enrolled === 1 ? 'student' : 'students'}
                </p>
                <p className="mt-2 text-sm">
                  <span className="text-muted">Teacher </span>
                  <TeacherName each={each} />
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Button type="button" variant="secondary" onClick={() => setEditing(each)}>
                    Edit
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => setViewing(each)}>
                    Students
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          <Table caption={`Life Class classes, ${termLabel(term)}`} className="mt-4 hidden lg:block">
            <thead>
              <tr>
                <HeaderCell>Class</HeaderCell>
                <HeaderCell>Day and time</HeaderCell>
                <HeaderCell>Teacher</HeaderCell>
                <HeaderCell>Students</HeaderCell>
                <HeaderCell>Status</HeaderCell>
                <HeaderCell>Action</HeaderCell>
              </tr>
            </thead>
            <tbody>
              {shown.map((each) => (
                <tr key={each.id} className={rowClasses}>
                  <th scope="row" className="px-3 py-3 text-left font-semibold">
                    {each.name}
                  </th>
                  <td className="px-3 py-3">{when(each)}</td>
                  <td className="px-3 py-3">
                    <TeacherName each={each} />
                  </td>
                  <td className="px-3 py-3">{each.enrolled}</td>
                  <td className="px-3 py-3">{STATUS_LABELS[each.status]}</td>
                  <td className="px-3 py-1">
                    <div className="flex gap-2">
                      <Button type="button" variant="secondary" onClick={() => setEditing(each)}>
                        Edit
                      </Button>
                      <Button type="button" variant="secondary" onClick={() => setViewing(each)}>
                        Students
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </>
      ) : null}
      <OpenClassDialog term={term} open={opening} onClose={() => setOpening(false)} />
      <TeacherDialog cls={editing} onClose={() => setEditing(null)} />
      <StudentsDialog cls={viewing} onClose={() => setViewing(null)} />
    </EquippingFrame>
  );
}

function when(each: Pick<CoordinatedClass, 'day_of_week' | 'time_of_day'>): string {
  return `${DAY_NAMES[each.day_of_week - 1].slice(0, 3)} ${timeLabel(each.time_of_day)}`;
}

/** A Teacher not named yet is said in words (decision 0501, point 22). */
function TeacherName({ each }: { each: CoordinatedClass }) {
  return each.teacher === null ? (
    <span className="text-field-invalid font-semibold">Not named yet</span>
  ) : (
    <span>{each.teacher.full_name}</span>
  );
}

function clashLine(name: string, clash: CellClash): string {
  return `Clash: ${name} leads a Cell on ${DAY_NAMES[clash.day_of_week - 1]}s at ${timeLabel(
    clash.time_of_day,
  )}, less than two hours from this class. You may still save.`;
}

/** Search for a current Cell Leader in the tree (decision 0499, point 10). */
function TeacherSearch({ onChoose }: { onChoose: (person: FoundPerson) => void }) {
  const [query, setQuery] = useState('');
  const [searched, setSearched] = useState<string | null>(null);
  const found = useQuery({
    queryKey: ['equipping', 'teachers', searched],
    queryFn: ({ signal }) => searchTeachers(searched!, signal),
    enabled: searched !== null,
  });
  return (
    <div>
      <SearchField
        label="Teacher"
        description="A current Cell Leader. At least three letters of their name."
        autoComplete="off"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        action={
          <Button type="button" variant="secondary" onClick={() => setSearched(query.trim())}>
            Search
          </Button>
        }
      />
      <FailureNotice failure={found.isError ? describeFailure(found.error) : null} />
      {found.isSuccess && found.data.data.length === 0 ? (
        <p className="text-muted mt-2 text-sm">No current Cell Leader with that name.</p>
      ) : null}
      <ul className="mt-2 flex flex-col gap-1">
        {(found.data?.data ?? []).map((each) => (
          <li key={each.id}>
            <Button type="button" variant="secondary" className="w-full justify-start" onClick={() => onChoose(each)}>
              {each.full_name} · {each.member_id}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function OpenClassDialog({ term, open, onClose }: { term: Term; open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const seasons = useQuery({
    queryKey: ['equipping', 'coordinate', 'seasons'],
    queryFn: ({ signal }) => listCoordinatorSeasons(signal),
    enabled: open,
  });
  const [name, setName] = useState('');
  const [day, setDay] = useState('2');
  const [time, setTime] = useState('19:00');
  const [place, setPlace] = useState('');
  const [firstLesson, setFirstLesson] = useState('');
  const [season, setSeason] = useState('');
  const [teacher, setTeacherChoice] = useState<FoundPerson | null>(null);
  const [writeKey, renewWriteKey] = useWriteKey();
  const [showErrors, setShowErrors] = useState(false);
  // A Teacher named on opening is checked against their week as on Edit (decision 0501).
  const clash = useQuery({
    queryKey: ['equipping', 'clash', teacher?.id, day, time],
    queryFn: ({ signal }) => teacherClash(teacher!.id, Number(day), time, signal),
    enabled: open && teacher !== null && /^\d{2}:\d{2}/.test(time),
  });

  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...term,
        name: name.trim(),
        day_of_week: Number(day),
        time_of_day: time,
        ...(place.trim() ? { place: place.trim() } : {}),
        first_lesson_on: firstLesson,
        ...(teacher ? { teacher_person_id: teacher.id } : {}),
        encounter_season_id: season,
      };
      return openClass(body, idempotencyKeyFor('equipping-coordinator-open-class', writeKey, body));
    },
    onSuccess: async () => {
      renewWriteKey();
      await queryClient.invalidateQueries({ queryKey: ['equipping'] });
      onClose();
    },
  });
  const complete = name.trim() !== '' && firstLesson !== '' && season !== '';

  return (
    <Dialog open={open} onClose={onClose} title="Open a class">
      <p className="text-muted text-sm">Life Class, {termLabel(term)}. The Teacher may be named now or later.</p>
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
          <TeacherSearch onChoose={setTeacherChoice} />
        ) : (
          <div>
            <p className="field-label">Teacher</p>
            <div className="border-edge mt-1.5 flex items-center justify-between rounded-md border px-3 py-1">
              <span className="font-semibold">{teacher.full_name}</span>
              <Button type="button" variant="secondary" onClick={() => setTeacherChoice(null)}>
                Change
              </Button>
            </div>
            {clash.data?.clash ? (
              <p role="status" className="text-field-invalid mt-2 text-sm font-semibold">
                {clashLine(teacher.full_name, clash.data.clash)}
              </p>
            ) : clash.data ? (
              <p role="status" className="mt-2 text-sm">
                ✓ Fits their week
              </p>
            ) : null}
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
          <p className="text-field-invalid text-sm">Fill in the name, first lesson and Encounter weekend.</p>
        ) : null}
        <FailureNotice failure={save.isError ? describeFailure(save.error) : null} />
        <div className="flex flex-col gap-3 lg:flex-row">
          <Button type="submit" disabled={save.isPending}>
            Open the class
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/**
 * Edit names the Teacher (decision 0501, point 2), showing whether the class fits their week.
 * A clash with their own Cell warns and the Coordinator may still save (owner, 2026-11-20).
 */
function TeacherDialog({ cls, onClose }: { cls: CoordinatedClass | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [chosen, setChosen] = useState<FoundPerson | null>(null);
  const [writeKey, renewWriteKey] = useWriteKey();
  const clash = useQuery({
    queryKey: ['equipping', 'clash', cls?.id, chosen?.id],
    queryFn: ({ signal }) => teacherClash(chosen!.id, cls!.day_of_week, cls!.time_of_day, signal),
    enabled: cls !== null && chosen !== null,
  });
  const save = useMutation({
    mutationFn: () => {
      const body = { teacher_person_id: chosen!.id };
      return setTeacher(cls!.id, chosen!.id, idempotencyKeyFor('equipping-set-teacher', writeKey, { id: cls!.id, ...body }));
    },
    onSuccess: async () => {
      renewWriteKey();
      await queryClient.invalidateQueries({ queryKey: ['equipping'] });
      close();
    },
  });
  const close = () => {
    setChosen(null);
    onClose();
  };

  return (
    <Dialog open={cls !== null} onClose={close} title={`Edit ${cls?.name ?? ''}`}>
      <p className="text-muted text-sm">
        {cls ? `${when(cls)} · starts ${cls.first_lesson_on}` : ''}
        {cls?.teacher ? ` · Teacher now: ${cls.teacher.full_name}` : ' · No Teacher named yet'}
      </p>
      <div className="mt-4 flex flex-col gap-4">
        {chosen === null ? (
          <TeacherSearch onChoose={setChosen} />
        ) : (
          <div>
            <p className="field-label">Teacher</p>
            <div className="border-edge mt-1.5 flex items-center justify-between rounded-md border px-3 py-1">
              <span className="font-semibold">{chosen.full_name}</span>
              <Button type="button" variant="secondary" onClick={() => setChosen(null)}>
                Change
              </Button>
            </div>
            {clash.data?.clash ? (
              <p role="status" className="text-field-invalid mt-2 text-sm font-semibold">
                {clashLine(chosen.full_name, clash.data.clash)}
              </p>
            ) : clash.data ? (
              <p role="status" className="mt-2 text-sm">
                ✓ Fits their week
              </p>
            ) : null}
          </div>
        )}
        <FailureNotice failure={save.isError ? describeFailure(save.error) : null} />
        <div className="flex flex-col gap-3 lg:flex-row">
          <Button type="button" disabled={chosen === null || save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
          <Button type="button" variant="secondary" onClick={close}>
            Cancel
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function StudentsDialog({ cls, onClose }: { cls: CoordinatedClass | null; onClose: () => void }) {
  const students = useQuery({
    queryKey: ['equipping', 'coordinate', 'students', cls?.id],
    queryFn: ({ signal }) => listClassStudents(cls!.id, signal),
    enabled: cls !== null,
  });
  return (
    <Dialog open={cls !== null} onClose={onClose} title={`${cls?.name ?? ''} · students`}>
      <FailureNotice failure={students.isError ? describeFailure(students.error) : null} />
      {students.data && students.data.data.length === 0 ? (
        <p className="text-muted text-sm">Nobody is enrolled yet.</p>
      ) : null}
      <ul className="flex flex-col">
        {(students.data?.data ?? []).map((each) => (
          <li key={each.person.id} className="border-line border-b py-2 text-sm last:border-b-0">
            <span className="font-semibold">{each.person.full_name}</span>
          </li>
        ))}
      </ul>
      <div className="mt-4">
        <Button type="button" variant="secondary" onClick={onClose}>
          Close
        </Button>
      </div>
    </Dialog>
  );
}
