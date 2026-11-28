import { authenticatedRequest } from './session';

/**
 * The Admin's Audit Log (SKILL.md sections 19 and 21, decision 0428), read through
 * `GET /api/v1/audit-log` under `audit.view` at Whole Church.
 */

/** The chips, in the order the tab shows them; the server holds which action is which. */
export const AUDIT_KINDS = [
  'EVERYTHING',
  'PEOPLE',
  'MOVES',
  'CELLS',
  'ATTENDANCE',
  'GROWTH',
  'ACCOUNTS',
  'SETTINGS',
  // Searches and duplicate checks, which record a reading rather than a change (decision 0493).
  'LOOKUPS',
] as const;

export type AuditKind = (typeof AUDIT_KINDS)[number];

export const AUDIT_KIND_LABELS: Record<AuditKind, string> = {
  EVERYTHING: 'Everything',
  PEOPLE: 'People',
  MOVES: 'Moves',
  CELLS: 'Cells',
  ATTENDANCE: 'Attendance',
  GROWTH: 'Growth',
  ACCOUNTS: 'Accounts',
  SETTINGS: 'Settings',
  LOOKUPS: 'Lookups',
};

type Values = Record<string, unknown> | null;

export interface AuditEntry {
  id: string;
  occurred_at: string;
  action: string;
  kind: Exclude<AuditKind, 'EVERYTHING'> | null;
  /** Null for a system action. */
  actor: { account_id: string; person_id: string | null } | null;
  target: { type: string; id: string; person_id: string | null; cell_code: string | null };
  before: Values;
  after: Values;
  reason: string | null;
}

export interface AuditLogPage {
  data: AuditEntry[];
  /** Every Person the page mentions, by identifier. */
  names: Record<string, { name: string; member_id: string }>;
  /** The search matched more people than the server looks through (decision 0429). */
  truncated: boolean;
  next_cursor: string | null;
}

/** How many people a name search looks through, which the screen names when it is reached. */
export const SEARCH_PEOPLE_CEILING = 1000;

export async function listAuditLog(
  params: { q?: string; kind?: AuditKind; cursor?: string | null },
  signal?: AbortSignal,
): Promise<AuditLogPage> {
  const query = new URLSearchParams();
  if (params.q) query.set('q', params.q);
  if (params.kind && params.kind !== 'EVERYTHING') query.set('kind', params.kind);
  if (params.cursor) query.set('cursor', params.cursor);
  const suffix = query.toString();
  return authenticatedRequest(`/api/v1/audit-log${suffix ? `?${suffix}` : ''}`, { signal });
}

/** What happened, in words. An action the screen does not know yet is said plainly as one. */
const WHAT: Record<string, string> = {
  'person.created': 'Added a person',
  'person.updated': 'Changed a person’s details',
  'person.archived': 'Archived',
  'person.restored': 'Restored from the archive',
  'person.merged': 'Merged into another record',
  'network.changed': 'Network changed',
  'sex.corrected': 'Sex corrected',
  'effective_date.backdated': 'Dated in the past',
  'pastoral_assignment.transferred': 'Moved to another leader',
  'cell_membership.moved': 'Moved to another Cell',
  'setting.changed': 'Setting changed',
  'encounter_season.created': 'Encounter dates set',
  'encounter_season.changed': 'Encounter dates changed',
  'account.created': 'Gave an account',
  'account.activated': 'Account activated',
  'account.activation_resent': 'Activation email sent again',
  'account.password_reset_sent': 'Password reset sent',
  'account.email_corrected': 'Email address corrected',
  'account.email_changed': 'Email address changed',
  'account.email_replaced': 'Email address replaced',
  'account.disabled': 'Account disabled',
  'account.reactivated': 'Account enabled again',
  'account.full_view_changed': 'Full view changed',
  'account.approves_cells_changed': 'Approves Cells changed',
  'account.moves_people_changed': 'Moves people changed',
  'account.coordinates_life_class_changed': 'Life Class Coordinator changed',
  'account.coordinates_sol_1_changed': 'SOL 1 Coordinator changed',
  'account.coordinates_sol_2_changed': 'SOL 2 Coordinator changed',
  'account.coordinates_sol_3_changed': 'SOL 3 Coordinator changed',
  'account.username_set': 'Username set',
  'second_step.set_up': 'Second sign-in step set up',
  'second_step.reset': 'Second sign-in step reset',
  'second_step.recovery_code_used': 'Recovery code used',
  'second_step.paused': 'Second step paused after wrong codes',
  'directory.searched': 'Searched the whole church',
  'equipping_class.clash_checked': 'Checked a Teacher’s week',
  'directory.matched': 'Possible duplicate shown outside the searcher’s care',
  'password.reset': 'Password reset',
  'password.changed': 'Password changed',
  'sign_in.paused': 'Sign-in paused after wrong passwords',
  'current_password.paused': 'Paused after wrong current passwords on My Account',
  'role.granted': 'Role given',
  'cell.created': 'Cell created',
  'cell.closed': 'Cell closed',
  'cell_category.changed': 'Cell category changed',
  'cell_schedule.changed': 'Cell day or time changed',
  'cell_membership.added': 'Added to a Cell',
  'cell_membership.ended': 'Removed from a Cell',
  'cell_leadership.opened': 'Began leading the Cell',
  'cell_leadership.ended': 'Stopped leading the Cell',
  'cell_leadership.changed': 'Cell leader changed',
  'cell_leadership.account_pending': 'Leads a Cell, account still to give',
  'cell_leadership_request.submitted': 'Cell request sent',
  'cell_leadership_request.approved': 'Cell request approved',
  'cell_leadership_request.declined': 'Cell request declined',
  'dcc_event.created': 'Sunday added to the DCC calendar',
  'dcc_attendance.submitted_on_behalf': 'DCC recorded for the leader',
  'dcc_attendance.corrected': 'DCC corrected',
  'dcc_attendance.amended': 'DCC changed after its week closed',
  'cell_attendance.submitted_on_behalf': 'CG attendance recorded for the leader',
  'cell_attendance.corrected': 'CG attendance corrected',
  'cell_attendance.amended': 'CG attendance changed after its week closed',
  'cell_meeting.rescheduled': 'CG meeting moved to another day',
  'cell_meeting.not_held': 'CG meeting recorded as Did not meet',
  'cell_meeting.status_corrected': 'CG meeting status corrected',
  'cell_meeting.facilitator_recorded': 'Who ran the CG meeting recorded',
  'suynl_lesson.confirmed': 'SUYNL lesson filed',
  'suynl_lesson.corrected': 'SUYNL lesson corrected',
  'training_graduation.confirmed': 'Graduation filed',
  'training_graduation.corrected': 'Graduation corrected',
};

const CATEGORY: Record<string, string> = { YOUTH: 'Youth', YOUNG_PRO: 'Young Pro', COUPLE: 'Couple' };
const SETTING: Record<string, string> = {
  cell_attention_months: 'No meeting in (months)',
  record_verse: 'Verse on Record',
  initial_encoding_closed: 'Initial encoding',
  dcc_calendar_start: 'DCC calendar first Sunday',
};
const SEX: Record<string, string> = { MALE: 'Male', FEMALE: 'Female' };
const NETWORK: Record<string, string> = { MENS: 'Men’s', WOMENS: 'Women’s' };
const PROGRAM: Record<string, string> = {
  LIFE_CLASS: 'Life Class',
  ENCOUNTER: 'Encounter',
  SOL_1: 'SOL 1',
  SOL_2: 'SOL 2',
  SOL_3: 'SOL 3',
};

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value : null;

/** `MOVED_AWAY` as "Moved away". */
const words = (value: unknown): string | null => {
  const code = text(value);
  if (code === null) return null;
  const spaced = code.toLowerCase().replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};

/** 2026-09-20 as "20 September 2026". */
const day = (value: unknown): string | null => {
  const date = text(value);
  if (date === null || !/^\d{4}-\d{2}-\d{2}/.test(date)) return null;
  return new Date(`${date.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-GB', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
};

/** An entry in words: what happened, and the line beneath it, the reason last. */
export function describeEntry(
  entry: AuditEntry,
  names: AuditLogPage['names'],
): { what: string; detail: string | null } {
  const before = entry.before ?? {};
  const after = entry.after ?? {};
  const name = (id: unknown) => (typeof id === 'string' ? (names[id]?.name ?? null) : null);
  const change = (from: string | null, to: string | null) =>
    from !== null && to !== null ? `${from} to ${to}` : (to ?? from);

  let detail: string | null = null;
  switch (entry.action) {
    case 'pastoral_assignment.transferred': {
      const from = name(before.leader_id);
      const to = name(after.leader_id);
      detail = from !== null && to !== null ? `From ${from} to ${to}` : to !== null ? `To ${to}` : null;
      break;
    }
    case 'cell_membership.moved': {
      const from = text(before.cell_id);
      const to = text(after.cell_id);
      detail = from !== null && to !== null ? `From ${from} to ${to}` : to !== null ? `To ${to}` : null;
      break;
    }
    case 'cell_membership.added':
    case 'cell_leadership.account_pending':
      detail = text(after.cell_id);
      break;
    case 'cell_membership.ended':
      detail = text(before.cell_id);
      break;
    case 'cell.created':
      detail = [text(after.cell_id), CATEGORY[String(after.category)]].filter(Boolean).join(' · ') || null;
      break;
    case 'cell_category.changed':
      detail = change(CATEGORY[String(before.category)] ?? null, CATEGORY[String(after.category)] ?? null);
      break;
    case 'cell.closed':
      detail = words(after.closure_reason);
      break;
    case 'cell_leadership.opened':
    case 'cell_leadership.changed':
      detail = name(after.cell_leader_id);
      break;
    case 'cell_leadership.ended':
      detail = name(before.cell_leader_id);
      break;
    case 'sex.corrected':
      detail = change(SEX[String(before.sex)] ?? null, SEX[String(after.sex)] ?? null);
      break;
    case 'network.changed':
      detail = change(NETWORK[String(before.network)] ?? null, NETWORK[String(after.network)] ?? null);
      break;
    case 'person.created':
      detail = text(after.member_id);
      break;
    case 'person.archived':
      detail = words(after.reason);
      break;
    case 'setting.changed': {
      const from = before.value;
      const to = after.value;
      detail =
        (typeof from === 'number' || typeof from === 'boolean') &&
        (typeof to === 'number' || typeof to === 'boolean')
          ? `${String(from)} to ${String(to)}`
          : null;
      break;
    }
    case 'directory.searched':
      detail =
        text(after.term) === null
          ? null
          : `“${String(after.term)}”, ${String(after.returned ?? 0)} found`;
      break;
    case 'role.granted':
      detail = words(after.role);
      break;
    case 'dcc_event.created':
      detail = day(after.event_date);
      break;
    case 'dcc_attendance.corrected':
    case 'dcc_attendance.amended':
    case 'dcc_attendance.submitted_on_behalf': {
      const sunday = day(after.event_date);
      const mark = after.present === true ? 'present' : after.present === false ? 'absent' : null;
      detail = sunday === null ? null : `Sunday ${sunday}${mark === null ? '' : `, ${mark}`}`;
      break;
    }
    case 'cell_attendance.corrected':
    case 'cell_attendance.amended':
    case 'cell_attendance.submitted_on_behalf': {
      const meeting = day(after.meeting_id);
      detail = meeting === null ? null : `Meeting of ${meeting}`;
      break;
    }
    case 'suynl_lesson.confirmed':
    case 'suynl_lesson.corrected':
      detail = typeof after.lesson === 'number' ? `Lesson ${after.lesson}` : null;
      if (after.withdrawn === true && detail !== null) detail = `${detail}, withdrawn`;
      break;
    case 'training_graduation.confirmed':
    case 'training_graduation.corrected':
      detail = PROGRAM[String(after.program)] ?? null;
      if (after.withdrawn === true && detail !== null) detail = `${detail}, withdrawn`;
      break;
  }

  const reason = text(entry.reason);
  const line = [detail, reason === null ? null : `Reason: ${reason}`].filter(Boolean).join(' · ');
  return { what: WHAT[entry.action] ?? `Other change (${entry.action})`, detail: line || null };
}

/** Who did it: the person behind the account, or *System* for an entry nobody made. */
export function entryActor(entry: AuditEntry, names: AuditLogPage['names']): string {
  if (entry.actor === null) return 'System';
  const person = entry.actor.person_id === null ? undefined : names[entry.actor.person_id];
  return person?.name ?? 'An account';
}

/** What an entry was about, and where its link goes, if anywhere. */
export function entryAbout(
  entry: AuditEntry,
  names: AuditLogPage['names'],
): { label: string; href: string | null } {
  const { target } = entry;
  if (target.person_id !== null) {
    const person = names[target.person_id];
    return { label: person?.name ?? 'A person', href: `/people/${target.person_id}` };
  }
  if (target.type === 'cell') {
    return { label: target.cell_code ?? 'A Cell', href: `/cells/${target.id}/meetings` };
  }
  if (target.type === 'setting') {
    return { label: SETTING[target.id] ?? 'A setting', href: '/admin?tab=settings' };
  }
  if (target.type === 'dcc_event') {
    return { label: day(target.id) === null ? 'A DCC Sunday' : `Sunday ${day(target.id)}`, href: null };
  }
  if (target.type === 'encounter_season') {
    return { label: 'Encounter dates', href: '/admin?tab=settings' };
  }
  return { label: '—', href: null };
}

/** When, in Manila time: "2 Nov 2026, 9:33 pm" (decision 0010). */
export function entryWhen(iso: string): string {
  const at = new Date(iso);
  const date = at.toLocaleDateString('en-GB', {
    timeZone: 'Asia/Manila',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  const time = at.toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Manila',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  return `${date}, ${time}`;
}

/**
 * Entries the list shows as one row (decision 0493). Each entry stays stored and found on its
 * own; only the list joins them, and only within one page, so a run a page break splits stays
 * two rows.
 *
 * - One save: entries one account made with one action carrying one instant, the instant the
 *   log stamps from the save's transaction. Order within one instant is not kept (the log breaks
 *   the tie on a random identifier), so they are joined wherever they fall among that instant's
 *   entries, and the row stands where the first of them does.
 * - One search repeated: church-wide searches one account made for the same words, compared
 *   trimmed and without regard to case, next to each other in the list and each within ten
 *   minutes of the one before. Every one of them is still recorded (decision 0303).
 */
export interface AuditGroup {
  key: string;
  entries: AuditEntry[];
}

const TEN_MINUTES = 10 * 60 * 1000;

const actorOf = (entry: AuditEntry) => entry.actor?.account_id ?? null;
const termOf = (entry: AuditEntry) => String(entry.after?.term ?? '').trim().toLowerCase();

function sameSearch(earlier: AuditEntry, later: AuditEntry): boolean {
  return (
    earlier.action === 'directory.searched' &&
    later.action === 'directory.searched' &&
    actorOf(earlier) === actorOf(later) &&
    termOf(earlier) === termOf(later) &&
    Date.parse(earlier.occurred_at) - Date.parse(later.occurred_at) <= TEN_MINUTES
  );
}

export function groupEntries(entries: readonly AuditEntry[]): AuditGroup[] {
  const groups: AuditGroup[] = [];
  const bySave = new Map<string, AuditGroup>();
  for (const entry of entries) {
    // The list runs newest first, so the group's last entry is the one just before this.
    const previous = groups[groups.length - 1];
    const latest = previous?.entries[previous.entries.length - 1];
    if (latest !== undefined && sameSearch(latest, entry)) {
      previous.entries.push(entry);
      continue;
    }
    const save = `${entry.occurred_at}|${actorOf(entry) ?? ''}|${entry.action}`;
    const joined = bySave.get(save);
    if (joined !== undefined) {
      joined.entries.push(entry);
      continue;
    }
    // Prefixed, so an opened group's own row never shares a key with its first entry's row.
    const group = { key: `group:${entry.id}`, entries: [entry] };
    bySave.set(save, group);
    groups.push(group);
  }
  return groups;
}

/** How a run of one action reads, by how many: "6 SUYNL lessons filed". */
const MANY: Record<string, (n: number) => string> = {
  'dcc_event.created': (n) => `${n} Sundays added to the DCC calendar`,
  'suynl_lesson.confirmed': (n) => `${n} SUYNL lessons filed`,
  'suynl_lesson.corrected': (n) => `${n} SUYNL lessons corrected`,
  'training_graduation.confirmed': (n) => `${n} graduations filed`,
  'training_graduation.corrected': (n) => `${n} graduations corrected`,
  'dcc_attendance.submitted_on_behalf': (n) => `${n} DCC records made for the leader`,
  'dcc_attendance.corrected': (n) => `${n} DCC records corrected`,
  'dcc_attendance.amended': (n) => `${n} DCC records changed after their week closed`,
};

const lowerFirst = (value: string) => value.charAt(0).toLowerCase() + value.slice(1);

/** A group of more than one entry in words: what, the line beneath it, and what it was about. */
export function describeGroup(
  group: AuditGroup,
  names: AuditLogPage['names'],
): { what: string; detail: string | null; about: string } {
  const { entries } = group;
  const first = entries[0];
  const count = entries.length;
  const what = MANY[first.action]?.(count) ?? `${WHAT[first.action] ?? first.action} · ${count} entries`;

  // One search repeated reads as its words; opening it lists each with how many it found.
  if (first.action === 'directory.searched') {
    return {
      what: `${WHAT[first.action]} · ${count} times`,
      detail: text(first.after?.term) === null ? null : `“${String(first.after?.term).trim()}”`,
      about: entryAbout(first, names).label,
    };
  }

  // The calendar's run reads as its first and last Sunday.
  if (first.target.type === 'dcc_event') {
    const dates = entries
      .map((entry) => text(entry.after?.event_date))
      .filter((date): date is string => date !== null)
      .sort();
    const from = day(dates[0]);
    const to = day(dates[dates.length - 1]);
    return {
      what,
      detail: from !== null && to !== null ? `${from} to ${to}` : null,
      about: `${count} Sundays`,
    };
  }

  // Otherwise the first three, each as its own row would name it, and how many more.
  const named = entries.slice(0, 3).map((entry) => {
    const { detail } = describeEntry(entry, names);
    const about = entryAbout(entry, names).label;
    return detail === null ? about : `${about}, ${lowerFirst(detail)}`;
  });
  const more = count - named.length;
  const targets = new Set(entries.map((entry) => `${entry.target.type}:${entry.target.id}`)).size;
  const noun =
    first.target.type === 'person' ? 'people' : first.target.type === 'cell' ? 'Cells' : 'records';
  return {
    what,
    detail: [...named, ...(more > 0 ? [`and ${more} more`] : [])].join(' · '),
    about: targets === 1 ? entryAbout(first, names).label : `${targets} ${noun}`,
  };
}
