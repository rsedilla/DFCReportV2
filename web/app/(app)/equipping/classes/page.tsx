'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';

import { EquippingFrame, LevelPicker, TermPicker } from '@/components/equipping-frame';
import { Button, buttonClasses } from '@/components/ui/button';
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
  LEVEL_LABELS,
  listCoordinatorLevels,
  cancelClass,
  correctClass,
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
  type EquippingLevel,
  type FoundPerson,
  type Term,
  listName,
} from '@/lib/equipping';
import { idempotencyKeyFor, useWriteKey } from '@/lib/idempotency';
import { shortDate } from '@/lib/lifecycle';
import { describeFailure } from '@/lib/messages';

/**
 * The Coordinator's *Classes* (SKILL.md section 29, decision 0501, point 22): a level's classes
 * in a term, laid out like Mapúa's COMS as the owner chose on 2026-11-20. The Coordinator opens
 * a class and names its Teacher; a problem is said in words, never by colour alone (section 19).
 * Guides and attendance join the table with the steps that build them.
 */
type StatusFilter = 'ALL' | CoordinatedClass['status'];

/** Who may guide each level, one level ahead (decision 0501, point 4; decisions 0516 and 0517). */
const GUIDE_PASSED: Record<EquippingLevel, string> = {
  LIFE_CLASS: 'SOL 1',
  SOL_1: 'SOL 2',
  SOL_2: 'SOL 3',
  SOL_3: 'SOL 3 and has three of their own disciples each leading a Cell',
};

const STATUS_LABELS: Record<CoordinatedClass['status'], string> = {
  NOT_STARTED: 'Not started',
  RUNNING: 'Running',
  CANCELLED: 'Cancelled',
};

/** *All* is the classes not started and running; a cancelled one only under *Cancelled* (0510). */
function listedUnder(status: StatusFilter, each: CoordinatedClass): boolean {
  return status === 'ALL' ? each.status !== 'CANCELLED' : each.status === status;
}

/** *Cancelled 23 Nov 2026*, the status a cancelled class reads (decision 0510). */
function cancelledLabel(each: CoordinatedClass): string {
  return each.cancelled_on ? `Cancelled ${shortDate(each.cancelled_on)}` : 'Cancelled';
}

export default function ClassesPage() {
  const [term, setTerm] = useState<Term>(() => currentTerm());
  const [status, setStatus] = useState<StatusFilter>('ALL');
  const [opening, setOpening] = useState(false);
  const [editing, setEditing] = useState<CoordinatedClass | null>(null);
  const [viewing, setViewing] = useState<CoordinatedClass | null>(null);
  const [cancelling, setCancelling] = useState<CoordinatedClass | null>(null);

  // The levels the reader coordinates (decision 0514): a picker only when there is more than one.
  const levels = useQuery({
    queryKey: ['equipping', 'coordinate', 'levels'],
    queryFn: ({ signal }) => listCoordinatorLevels(signal),
  });
  const mine = levels.data?.data ?? [];
  const level: EquippingLevel = mine.includes(term.level) ? term.level : (mine[0] ?? term.level);
  const shownTerm = { ...term, level };
  const classes = useQuery({
    queryKey: ['equipping', 'coordinate', 'classes', shownTerm],
    queryFn: ({ signal }) => listCoordinatedClasses(shownTerm, signal),
    enabled: levels.isSuccess,
  });
  const others = classes.data?.other_coordinators ?? [];
  const lead =
    others.length > 0
      ? `${LEVEL_LABELS[level]}, which you coordinate with ${others.join(' and ')}.`
      : `${LEVEL_LABELS[level]}, which you coordinate.`;
  const shown = (classes.data?.data ?? []).filter((each) => listedUnder(status, each));
  // The open dialog reads the class as last listed, so a correction shows at once.
  const editingNow = (editing && classes.data?.data.find((each) => each.id === editing.id)) ?? editing;

  return (
    <EquippingFrame current="/equipping/classes" title="Classes" lead={lead}>
      <div className={CONTROL_BAR}>
        <TermPicker term={shownTerm} onChange={setTerm} />
        <SelectField
          label="Status"
          value={status}
          onChange={(event) => setStatus(event.target.value as StatusFilter)}
        >
          <option value="ALL">All</option>
          <option value="NOT_STARTED">Not started</option>
          <option value="RUNNING">Running</option>
          <option value="CANCELLED">Cancelled</option>
        </SelectField>
        {mine.length > 1 ? (
          <LevelPicker
            levels={mine}
            value={level}
            onChange={(next) => setTerm({ ...shownTerm, level: next })}
          />
        ) : null}
        <div className="lg:ml-auto">
          <Button type="button" onClick={() => setOpening(true)}>
            Open a class
          </Button>
        </div>
      </div>
      <FailureNotice
        failure={
          levels.isError
            ? describeFailure(levels.error)
            : classes.isError
              ? describeFailure(classes.error)
              : null
        }
      />
      {classes.data && shown.length === 0 ? (
        <p className="text-muted mt-4 text-sm">
          {!classes.data.data.some((each) => listedUnder('ALL', each)) && status === 'ALL'
            ? `No ${LEVEL_LABELS[level]} class is open in ${termLabel(term)} yet.`
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
                  <span className="text-muted text-sm">
                    {each.status === 'CANCELLED' ? cancelledLabel(each) : STATUS_LABELS[each.status]}
                  </span>
                </div>
                {each.status === 'CANCELLED' ? (
                  <>
                    <p className="text-muted text-sm">{when(each)}</p>
                    <p className="mt-2 text-sm">
                      <span className="text-muted">Reason </span>
                      {each.cancel_reason}
                    </p>
                  </>
                ) : (
                  <>
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
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      <Button type="button" variant="secondary" onClick={() => setEditing(each)}>
                        Edit
                      </Button>
                      <Button type="button" variant="secondary" onClick={() => setViewing(each)}>
                        Students
                      </Button>
                      <GradesLink each={each} />
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
          <Table caption={`${LEVEL_LABELS[level]} classes, ${termLabel(term)}`} className="mt-4 hidden lg:block">
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
              {shown.map((each) =>
                each.status === 'CANCELLED' ? (
                  <CancelledRow key={each.id} each={each} />
                ) : (
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
                        <GradesLink each={each} />
                      </div>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </Table>
        </>
      ) : null}
      <OpenClassDialog term={shownTerm} open={opening} onClose={() => setOpening(false)} />
      <TeacherDialog
        level={level}
        cls={editingNow}
        onClose={() => setEditing(null)}
        onCancelClass={(each) => {
          setEditing(null);
          setCancelling(each);
        }}
      />
      <CancelClassDialog cls={cancelling} onClose={() => setCancelling(null)} />
      <StudentsDialog cls={viewing} onClose={() => setViewing(null)} />
    </EquippingFrame>
  );
}

/** A cancelled class's row: its date and reason, dashes, and no action (decision 0510). */
function CancelledRow({ each }: { each: CoordinatedClass }) {
  const dash = <span className="text-muted">—</span>;
  return (
    <tr className={rowClasses}>
      <th scope="row" className="px-3 py-3 text-left font-semibold">
        {each.name}
      </th>
      <td className="px-3 py-3">{when(each)}</td>
      <td className="px-3 py-3">{dash}</td>
      <td className="px-3 py-3">{dash}</td>
      <td className="px-3 py-3">{each.enrolled}</td>
      <td className="px-3 py-3">{dash}</td>
      <td className="px-3 py-3">
        {cancelledLabel(each)}
        <br />
        <span className="text-muted text-sm">{each.cancel_reason}</span>
      </td>
      <td className="text-muted px-3 py-3 text-sm">No action</td>
    </tr>
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
    enabled: open && term.level === 'LIFE_CLASS',
  });
  const life = term.level === 'LIFE_CLASS';
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
  const [openedClash, setOpenedClash] = useState<{
    name: string;
    clash: CellClash | null;
    account: 'ACTIVE' | 'PENDING_ACTIVATION' | 'DISABLED' | 'NONE' | null | undefined;
  } | null>(null);

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
        // SOL has no Encounter (decision 0514).
        ...(life ? { encounter_season_id: season } : {}),
      };
      return openClass(body, idempotencyKeyFor('equipping-coordinator-open-class', writeKey, body));
    },
    onSuccess: async (opened) => {
      renewWriteKey();
      await queryClient.invalidateQueries({ queryKey: ['equipping'] });
      const cannotRecord = opened.account !== undefined && opened.account !== null && opened.account !== 'ACTIVE';
      if ((opened.clash || cannotRecord) && teacher) {
        setOpenedClash({ name: teacher.full_name, clash: opened.clash ?? null, account: opened.account });
        return;
      }
      onClose();
    },
  });
  const complete = name.trim() !== '' && firstLesson !== '' && (!life || season !== '');
  const close = () => {
    setOpenedClash(null);
    onClose();
  };

  if (openedClash) {
    return (
      <Dialog open={open} onClose={close} title="Class opened">
        <div role="status">
          {openedClash.clash ? (
            <p className="text-field-invalid text-sm font-semibold">
              {clashLine(openedClash.name, openedClash.clash, '')}
            </p>
          ) : null}
          <AccountWarning name={openedClash.name} account={openedClash.account} />
        </div>
        <p className="text-muted mt-2 text-sm">
          {openedClash.clash
            ? 'Change the Teacher under Edit if they cannot teach at this time.'
            : 'You may change the Teacher under Edit.'}
        </p>
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
      <p className="text-muted text-sm">
        {LEVEL_LABELS[term.level]}, {termLabel(term)}. The Teacher may be named now or later.
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
        {life ? (
        <SelectField label="Encounter weekend" value={season} onChange={(event) => setSeason(event.target.value)} required>
          <option value="">Choose a season</option>
          {(seasons.data?.data ?? []).map((each) => (
            <option key={each.id} value={each.id}>
              Men {each.mens_encounter_on} · Women {each.womens_encounter_on}
            </option>
          ))}
        </SelectField>
        ) : null}
        {showErrors && !complete ? (
          <p className="text-field-invalid text-sm">
            {life ? 'Fill in the name, first lesson and Encounter weekend.' : 'Fill in the name and first lesson.'}
          </p>
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
 * *When and where* on Edit (decision 0510, points 1 and 2): the day, time, place and first lesson
 * are corrected until a lesson is saved, then the box says why they no longer change. A clash
 * with the Teacher's own Cell is said after saving and never stops it.
 */
function WhenAndWhere({ cls }: { cls: CoordinatedClass }) {
  const queryClient = useQueryClient();
  const [day, setDay] = useState(String(cls.day_of_week));
  const [time, setTime] = useState(cls.time_of_day.slice(0, 5));
  const [place, setPlace] = useState(cls.place ?? '');
  const [firstLesson, setFirstLesson] = useState(cls.first_lesson_on);
  const [writeKey, renewWriteKey] = useWriteKey();
  const save = useMutation({
    mutationFn: () => {
      const body = {
        day_of_week: Number(day),
        time_of_day: time,
        place: place.trim() || null,
        first_lesson_on: firstLesson,
      };
      return correctClass(cls.id, body, idempotencyKeyFor('equipping-correct-class', writeKey, { id: cls.id, ...body }));
    },
    onSuccess: async () => {
      renewWriteKey();
      await queryClient.invalidateQueries({ queryKey: ['equipping'] });
    },
  });

  return (
    <section aria-labelledby={`when-${cls.id}`} className="border-line rounded-lg border p-4">
      <h3 id={`when-${cls.id}`} className="font-semibold">
        When and where
      </h3>
      {cls.lesson_saved ? (
        <p className="text-muted mt-1 text-sm">
          A lesson is saved, so the day, time, place and first lesson can no longer change.
        </p>
      ) : (
        <form
          className="mt-1 flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (time && firstLesson) {
              save.mutate();
            }
          }}
        >
          <p className="text-muted text-sm">May be corrected until the first lesson is saved.</p>
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
          <FailureNotice failure={save.isError ? describeFailure(save.error) : null} />
          {save.data ? (
            <p role="status" className={save.data.clash ? 'text-field-invalid text-sm font-semibold' : 'text-sm'}>
              {save.data.corrected ? 'Saved.' : 'Nothing changed.'}
              {save.data.clash && cls.teacher?.full_name
                ? ` ${clashLine(cls.teacher.full_name, save.data.clash, '')}`
                : ''}
            </p>
          ) : null}
          <div>
            <Button type="submit" disabled={save.isPending}>
              Save when and where
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}

/**
 * *Cancel class* at the foot of Edit (decision 0510, point 3): offered only while nobody is
 * enrolled and no lesson is saved, and otherwise saying why not.
 */
function CancelSection({ cls, onCancelClass }: { cls: CoordinatedClass; onCancelClass: () => void }) {
  const why =
    cls.enrolled > 0
      ? `${cls.enrolled} ${cls.enrolled === 1 ? 'student is' : 'students are'} enrolled`
      : cls.lesson_saved
        ? 'a lesson is saved'
        : null;
  return (
    <section aria-labelledby={`cancel-${cls.id}`} className="border-line rounded-lg border p-4">
      <h3 id={`cancel-${cls.id}`} className="font-semibold">
        Cancel class
      </h3>
      {why === null ? (
        <>
          <p className="text-muted mt-1 text-sm">
            No students and no lesson saved. The class is kept as cancelled and leaves this list; it is never deleted.
          </p>
          <div className="mt-3">
            <Button type="button" variant="secondary" onClick={onCancelClass}>
              Cancel class…
            </Button>
          </div>
        </>
      ) : (
        <p className="text-muted mt-1 text-sm">
          Not offered: {why}. A class may be cancelled only while it has no students and no lesson saved.
        </p>
      )}
    </section>
  );
}

/**
 * The confirm step (decision 0510, point 4): names the class, says what happens, takes a reason,
 * and offers *Keep the class* beside *Cancel the class*, neither chosen first.
 */
function CancelClassDialog({ cls, onClose }: { cls: CoordinatedClass | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  const [writeKey, renewWriteKey] = useWriteKey();
  const save = useMutation({
    mutationFn: () =>
      cancelClass(cls!.id, reason.trim(), idempotencyKeyFor('equipping-cancel-class', writeKey, { id: cls!.id, reason: reason.trim() })),
    onSuccess: async () => {
      renewWriteKey();
      await queryClient.invalidateQueries({ queryKey: ['equipping'] });
      close();
    },
  });
  const close = () => {
    setReason('');
    setShowErrors(false);
    save.reset();
    onClose();
  };
  const missing = reason.trim() === '';

  return (
    <Dialog open={cls !== null} onClose={close} title={`Cancel ${cls?.name ?? ''}?`}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          setShowErrors(true);
          if (!missing) {
            save.mutate();
          }
        }}
      >
        <div className="flex flex-col gap-3 text-sm">
          <p>
            <strong>{cls?.name}</strong>
            {cls
              ? ` · ${DAY_NAMES[cls.day_of_week - 1]}s ${timeLabel(cls.time_of_day)}${cls.place ? ` · ${cls.place}` : ''} · first lesson ${shortDate(cls.first_lesson_on)}`
              : ''}
          </p>
          <p>
            No students are enrolled and no lesson is saved. The class leaves the list of classes and is kept under{' '}
            <strong>Status: Cancelled</strong>. It cannot be reopened; open a new class instead.
          </p>
          {cls?.guides && cls.guides.named > 0 ? (
            <p>
              {cls.guides.named === 1 ? 'Its Guide is' : `Its ${cls.guides.named} Guides are`} removed from it.
            </p>
          ) : null}
        </div>
        <Field
          label="Reason"
          autoComplete="off"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={500}
          aria-required="true"
          description="Required. Shown beside the class under Cancelled."
          descriptionBelow
          error={showErrors && missing ? 'Give the reason the class is cancelled.' : undefined}
        />
        <FailureNotice failure={save.isError ? describeFailure(save.error) : null} />
        <DialogActions>
          <Button type="submit" disabled={save.isPending}>
            Cancel the class
          </Button>
          <Button type="button" variant="secondary" onClick={close}>
            Keep the class
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
/**
 * **A Teacher who cannot record is said so when named** (decision 0503, owner ruling of
 * 2026-11-20): with no account, one not yet activated, or one disabled, they cannot tick a
 * lesson. A warning only; the Coordinator may save, and the Admin gives or restores the account.
 */
function AccountWarning({
  name,
  account,
}: {
  name: string;
  account: 'ACTIVE' | 'PENDING_ACTIVATION' | 'DISABLED' | 'NONE' | null | undefined;
}) {
  const why =
    account === 'NONE'
      ? 'has no account yet'
      : account === 'PENDING_ACTIVATION'
        ? 'has not activated their account yet'
        : account === 'DISABLED'
          ? 'has a disabled account'
          : null;
  if (why === null) {
    return null;
  }
  return (
    <p className="text-field-invalid mt-2 text-sm font-semibold">
      {name} {why}, so they cannot record attendance. Ask the Admin.
    </p>
  );
}

function TeacherDialog({
  level,
  cls,
  onClose,
  onCancelClass,
}: {
  level: EquippingLevel;
  cls: CoordinatedClass | null;
  onClose: () => void;
  onCancelClass: (cls: CoordinatedClass) => void;
}) {
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
        {cls ? <WhenAndWhere key={cls.id} cls={cls} /> : null}
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
            {clash.data ? <AccountWarning name={chosen.full_name} account={clash.data.account} /> : null}
          </div>
        )}
        <FailureNotice failure={save.isError ? describeFailure(save.error) : null} />
        {cls ? <GuidesSection level={level} classId={cls.id} /> : null}
        {cls ? <CancelSection cls={cls} onCancelClass={() => onCancelClass(cls)} /> : null}
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
function GuidesSection({ level, classId }: { level: EquippingLevel; classId: string }) {
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
        {level === 'LIFE_CLASS' ? ' 3 or 4 each' : ' up to 5 each'}, and DREAMS shares them out.
      </p>
      <ul className="mt-2 flex flex-col">
        {guides.map((g) => (
          <li key={g.id} className="border-line flex min-h-11 items-center justify-between gap-3 border-b text-sm">
            <span>
              {listName(g.person)} <span className="text-muted">· {g.sex === 'FEMALE' ? 'women' : 'men'}</span>
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
            description={`Somebody who has passed ${GUIDE_PASSED[level]}. At least three letters of their name.`}
            empty="Nobody who may guide has that name."
            purpose="add as a Guide"
            search={(term, signal) => searchGuides(term, signal, level)}
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
      <p className="font-semibold">{listName(each.person)}</p>
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
                {listName(g.person)}
              </option>
            ))}
          </SelectField>
        </div>
      ) : null}
      <FailureNotice failure={swap.isError ? describeFailure(swap.error) : null} />
    </li>
  );
}

/** A class's final grades, for the Coordinator to check (decision 0508). */
function GradesLink({ each }: { each: { id: string; name: string } }) {
  return (
    <Link
      href={`/equipping/classes/${each.id}/grades`}
      aria-label={`Grades of ${each.name}`}
      className={buttonClasses('secondary')}
    >
      Grades
    </Link>
  );
}
