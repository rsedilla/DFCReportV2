'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { EquippingFrame, TermPicker } from '@/components/equipping-frame';
import { Button } from '@/components/ui/button';
import { SearchResults } from '@/components/search-results';
import { Dialog, DialogActions } from '@/components/ui/dialog';
import { FailureNotice } from '@/components/ui/failure-notice';
import { Field, SearchField } from '@/components/ui/field';
import { CONTROL_BAR } from '@/components/ui/frame';
import { SelectField } from '@/components/ui/select-field';
import { HeaderCell, Table, rowClasses } from '@/components/ui/table';
import { TextLink } from '@/components/ui/text-link';
import { timeLabel } from '@/lib/cells';
import {
  DAY_NAMES,
  currentTerm,
  listClassStudents,
  nameGuide,
  removeGuide,
  searchGuides,
  swapGuide,
  listCoordinatedClasses,
  listCoordinatorSeasons,
  openClass,
  searchTeachers,
  setTeacher,
  teacherClash,
  termLabel,
  type CellClash,
  type ClassGuide,
  type ClassStudent,
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
                <p className="text-sm">
                  <span className="text-muted">Guides </span>
                  <GuidesLine each={each} />
                </p>
                <p className="text-sm">
                  <span className="text-muted">Attendance </span>
                  <AttendanceLine each={each} />
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
                <HeaderCell>Guides</HeaderCell>
                <HeaderCell>Students</HeaderCell>
                <HeaderCell>Attendance</HeaderCell>
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
                  <td className="px-3 py-3">
                    <GuidesLine each={each} />
                  </td>
                  <td className="px-3 py-3">{each.enrolled}</td>
                  <td className="px-3 py-3">
                    <AttendanceLine each={each} />
                  </td>
                  <td className="px-3 py-3">{STATUS_LABELS[each.status]}</td>
                  <td className="px-3 py-1">
                    {/* Stacked below 1536px, so a 1024px laptop or a sideways iPad keeps the table
                        on screen with the Guides column (decision 0501, point 22). */}
                    <div className="flex flex-col gap-2 2xl:flex-row">
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

/**
 * The class's attendance in words (decision 0501, point 22): the lessons late, or *Up to date*,
 * opening the class's lessons and register (decision 0503).
 */
function AttendanceLine({ each }: { each: CoordinatedClass }) {
  const late = each.lessons?.late ?? [];
  const missing = each.lessons?.not_recorded ?? [];
  const said = [
    missing.length > 0 ? `${missing.map((n) => `L${n}`).join(', ')} not recorded` : null,
    late.length > 0 ? `${late.map((n) => `L${n}`).join(', ')} late` : null,
  ].filter((part): part is string => part !== null);
  return (
    <TextLink href={`/equipping/teach/${each.id}`}>
      {said.length > 0 ? (
        <span className="text-field-invalid font-semibold">{said.join(' · ')}</span>
      ) : (
        'Up to date'
      )}
    </TextLink>
  );
}

/** How many Guides, and how many more are needed, said in words (decision 0501, point 8). */
function GuidesLine({ each }: { each: CoordinatedClass }) {
  const named = each.guides?.named ?? 0;
  const men = each.guides?.short_men ?? 0;
  const women = each.guides?.short_women ?? 0;
  // Each sex said apart, a man guiding men and a woman women (section 29).
  const needed = [
    men > 0 ? `${men} more for men` : null,
    women > 0 ? `${women} more for women` : null,
  ].filter((part): part is string => part !== null);
  return (
    <span>
      {named}
      {needed.length > 0 ? (
        <span className="text-field-invalid font-semibold"> · {needed.join(' · ')}</span>
      ) : null}
    </span>
  );
}

function clashLine(name: string, clash: CellClash, tail = ' You may still save.'): string {
  return `Clash: ${name} leads a Cell on ${DAY_NAMES[clash.day_of_week - 1]}s at ${timeLabel(
    clash.time_of_day,
  )}, less than two hours from this class.${tail}`;
}

/** Search for a current Cell Leader in the tree (decision 0499, point 10). */
function TeacherSearch({ onChoose }: { onChoose: (person: FoundPerson) => void }) {
  return (
    <PersonSearch
      label="Teacher"
      description="A current Cell Leader. At least three letters of their name."
      empty="No current Cell Leader with that name."
      purpose="name as Teacher"
      search={searchTeachers}
      onChoose={onChoose}
    />
  );
}

/** A church-wide picker of the school's, bounded and recorded on the server (decision 0303). */
function PersonSearch({
  label,
  description,
  empty,
  purpose,
  search,
  onChoose,
}: {
  label: string;
  description: string;
  empty: string;
  /** What choosing does, finishing "Choose the person to …". */
  purpose: string;
  search: (term: string, signal?: AbortSignal) => Promise<{ data: FoundPerson[] }>;
  onChoose: (person: FoundPerson) => void;
}) {
  const [query, setQuery] = useState('');
  const [searched, setSearched] = useState<string | null>(null);
  const found = useQuery({
    queryKey: ['equipping', 'search', label, searched],
    queryFn: ({ signal }) => search(searched!, signal),
    enabled: searched !== null,
  });
  return (
    <div>
      <SearchField
        label={label}
        description={description}
        autoComplete="off"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        // Enter searches, as the Search button does; this sits inside another form, so it
        // cannot be a form of its own.
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            setSearched(query.trim());
          }
        }}
        action={
          <Button type="button" variant="secondary" onClick={() => setSearched(query.trim())}>
            Search
          </Button>
        }
      />
      <FailureNotice failure={found.isError ? describeFailure(found.error) : null} />
      {found.isSuccess && found.data.data.length === 0 ? (
        <p className="text-muted mt-2 text-sm">{empty}</p>
      ) : null}
      {found.data && found.data.data.length > 0 ? (
        <SearchResults
          people={found.data.data}
          purpose={purpose}
          detail={(each) => each.qualifies ?? null}
          onChoose={onChoose}
        />
      ) : null}
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
  // A Teacher named on opening is checked against their week by the opening itself, which
  // answers with any clash (decision 0501); the dialog then says so rather than closing.
  const [openedClash, setOpenedClash] = useState<{ name: string; clash: CellClash } | null>(null);

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
    onSuccess: async (opened) => {
      renewWriteKey();
      await queryClient.invalidateQueries({ queryKey: ['equipping'] });
      if (opened.clash && teacher) {
        setOpenedClash({ name: teacher.full_name, clash: opened.clash });
        return;
      }
      onClose();
    },
  });
  const complete = name.trim() !== '' && firstLesson !== '' && season !== '';
  const close = () => {
    setOpenedClash(null);
    onClose();
  };

  if (openedClash) {
    return (
      <Dialog open={open} onClose={close} title="Class opened">
        <p role="status" className="text-field-invalid text-sm font-semibold">
          {clashLine(openedClash.name, openedClash.clash, '')}
        </p>
        <p className="text-muted mt-2 text-sm">Change the Teacher under Edit if they cannot teach at this time.</p>
        <DialogActions>
          <Button type="button" onClick={close}>
            Done
          </Button>
        </DialogActions>
      </Dialog>
    );
  }

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
            <p className="text-muted mt-1 text-sm">Their week is checked when the class is opened.</p>
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
        <DialogActions>
          <Button type="submit" disabled={save.isPending}>
            Open the class
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </DialogActions>
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
    queryFn: ({ signal }) => teacherClash(cls!.id, chosen!.id, signal),
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
        {cls ? <GuidesSection classId={cls.id} /> : null}
        <DialogActions>
          <Button type="button" disabled={chosen === null || save.isPending} onClick={() => save.mutate()}>
            Save Teacher
          </Button>
          <Button type="button" variant="secondary" onClick={close}>
            Close
          </Button>
        </DialogActions>
      </div>
    </Dialog>
  );
}

/**
 * A class's Guides (decision 0501, points 4 and 8): each with Remove, and *Add a Guide*, which
 * finds only who may guide. Each change is saved at once, and DREAMS shares out the students
 * with no Guide, men to men and women to women, the Guide with the fewest first.
 */
function GuidesSection({ classId }: { classId: string }) {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  // One key per body until a save lands (decision 0127), so a retry replays rather than repeats.
  const [writeKey, renewWriteKey] = useWriteKey();
  const read = useQuery({
    queryKey: ['equipping', 'coordinate', 'students', classId],
    queryFn: ({ signal }) => listClassStudents(classId, signal),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['equipping'] });
  const add = useMutation({
    mutationFn: (personId: string) =>
      nameGuide(classId, personId, idempotencyKeyFor('equipping-name-guide', writeKey, { classId, personId })),
    onSuccess: async () => {
      renewWriteKey();
      setAdding(false);
      await refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (guideId: string) =>
      removeGuide(classId, guideId, idempotencyKeyFor('equipping-remove-guide', writeKey, { classId, guideId })),
    onSuccess: async () => {
      renewWriteKey();
      await refresh();
    },
  });
  const guides = read.data?.guides ?? [];
  const bySex = (sex: 'MALE' | 'FEMALE') => (read.data?.data ?? []).filter((s) => s.sex === sex).length;

  return (
    <section className="border-line border-t pt-4" aria-label="Guides">
      <h3 className="font-semibold">Guides</h3>
      <p className="text-muted text-sm">
        {bySex('MALE')} {bySex('MALE') === 1 ? 'man' : 'men'} and {bySex('FEMALE')}{' '}
        {bySex('FEMALE') === 1 ? 'woman' : 'women'} enrolled. A Guide follows up students of their own sex,
        3 or 4 each, and DREAMS shares them out.
      </p>
      <ul className="mt-2 flex flex-col">
        {guides.map((g) => (
          <li key={g.id} className="border-line flex min-h-11 items-center justify-between gap-3 border-b text-sm">
            <span>
              {g.person.full_name} <span className="text-muted">· {g.sex === 'FEMALE' ? 'women' : 'men'}</span>
              {g.archived ? <span className="text-muted"> · archived, takes no new students</span> : null}
            </span>
            <Button type="button" variant="secondary" disabled={remove.isPending} onClick={() => remove.mutate(g.id)}>
              Remove
            </Button>
          </li>
        ))}
      </ul>
      <FailureNotice failure={add.isError ? describeFailure(add.error) : remove.isError ? describeFailure(remove.error) : null} />
      {adding ? (
        <div className="mt-2">
          <PersonSearch
            label="Add a Guide"
            description="Somebody who has passed SOL 1. At least three letters of their name."
            empty="Nobody who may guide has that name."
            purpose="add as a Guide"
            search={searchGuides}
            onChoose={(person) => add.mutate(person.id)}
          />
        </div>
      ) : (
        <Button type="button" variant="secondary" className="mt-2" onClick={() => setAdding(true)}>
          Add a Guide
        </Button>
      )}
    </section>
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
          <StudentRow
            key={each.person.id}
            each={each}
            guides={students.data?.guides ?? []}
          />
        ))}
      </ul>
      <DialogActions>
        <Button type="button" variant="secondary" onClick={onClose}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/**
 * One student: their Cell leader, shown for every student whatever branch (owner, 2026-11-20),
 * their Guide, and *Swap Guide* among the class's Guides of their sex (decision 0501, point 8).
 */
function StudentRow({ each, guides }: { each: ClassStudent; guides: ClassGuide[] }) {
  const queryClient = useQueryClient();
  const [writeKey, renewWriteKey] = useWriteKey();
  const swap = useMutation({
    mutationFn: (guideId: string) =>
      swapGuide(
        each.enrollment_id,
        guideId,
        idempotencyKeyFor('equipping-swap-guide', writeKey, { enrollment: each.enrollment_id, guideId }),
      ),
    onSuccess: async () => {
      renewWriteKey();
      await queryClient.invalidateQueries({ queryKey: ['equipping'] });
    },
  });
  // Swap offers the Guides of the student's sex who take new students (decision 0502).
  const others = guides.filter((g) => g.id !== each.guide?.id && g.sex === each.sex && !g.archived);
  // A sex corrected after pairing leaves the pairing for the Coordinator to swap (decision 0502).
  const current = guides.find((g) => g.id === each.guide?.id);
  const otherSex = current !== undefined && each.sex !== null && current.sex !== each.sex;
  return (
    <li className="border-line border-b py-2 text-sm last:border-b-0">
      <p className="font-semibold">{each.person.full_name}</p>
      <p className="text-muted">
        Cell leader: {each.cell_leader?.full_name ?? 'none'} · Guide:{' '}
        {each.guide ? each.guide.full_name : <span className="text-field-invalid font-semibold">No Guide yet</span>}
      </p>
      {otherSex ? (
        <p className="text-field-invalid text-sm font-semibold">Their Guide is not the same sex. Swap to a Guide of theirs.</p>
      ) : null}
      {others.length > 0 ? (
        <div className="mt-1">
          <SelectField
            label={`Swap Guide for ${each.person.full_name ?? 'this student'}`}
            value=""
            disabled={swap.isPending}
            onChange={(event) => {
              if (event.target.value) {
                swap.mutate(event.target.value);
              }
            }}
          >
            <option value="">Keep {each.guide?.full_name ?? 'no Guide'}</option>
            {others.map((g) => (
              <option key={g.id} value={g.id}>
                {g.person.full_name}
              </option>
            ))}
          </SelectField>
        </div>
      ) : null}
      <FailureNotice failure={swap.isError ? describeFailure(swap.error) : null} />
    </li>
  );
}
