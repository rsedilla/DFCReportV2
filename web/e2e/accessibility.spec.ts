import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import {
  PERSON_IN_SCOPE,
  mockAccepted,
  mockAwaitingReassignment,
  mockCellChoices,
  mockCellCorrector,
  mockDuplicateRefusal,
  mockGrants,
  mockMembershipAdd,
  mockPeopleWithoutACell,
  mockPeople,
  mockPersonCreated,
  mockPossibleMatches,
  mockSignInRefused,
  mockSignedIn,
  mockWholeChurchReader,
} from './mock-api';
import {
  mockCellMeetings,
  mockMeetingsAwaiting,
  mockCells,
  mockCellsEmpty,
  mockDccEvents,
  mockCellMembers,
  mockCoverageGaps,
  mockPastoralPath,
  mockPastoralPathAtRoot,
  mockNetworkTree,
  mockNetworkReader,
  mockCoverageByLeader,
  mockCellMembersEmpty,
  mockCellReport,
  mockCellReportForOneCell,
  mockDccReport,
  mockDccRoster,
  mockMeetingRoster,
  mockClosedDccRoster,
  mockRecordedMeetingRoster,
} from './mock-attendance';

/**
 * axe-core over every route, in both themes, with a violation failing the build.
 *
 * `CLAUDE.md` (Definition of Done, Accessibility) makes this one of the three
 * things that make SKILL.md section 23's WCAG 2.2 AA claim checkable rather than
 * aspirational. The other two are the palette check, which runs in lint and needs
 * no browser, and the part a pull request has to state in words because nothing
 * can automate it.
 *
 * **A green run here is the floor, not the ceiling.** Automated rules catch a
 * minority of AA — roughly a third by most counts — and none of the four criteria
 * the pull request template asks about can be seen from here: focus visible
 * (2.4.7), focus not obscured (2.4.11), target size (2.5.8), and accessible
 * authentication (3.3.8). 2.5.8 is *partly* reachable and is asserted separately
 * below, because a mis-tap on a phone is a wrong attendance record (section 23).
 *
 * **Both themes, because the palette has two and a leader does not choose which
 * one they get.** `prefers-color-scheme` is the browser's, so a contrast defect
 * that exists only in dark mode is invisible to a light-mode-only sweep.
 */

const THEMES = ['light', 'dark'] as const;

/**
 * Every route, and the state worth scanning it in.
 *
 * A route's *initial* render is not the only thing a person sees. A form error
 * appears after a submission and would never be scanned by a sweep that only
 * loads pages, so the states that render new content are listed here as their
 * own entries.
 */
const SCANS = [
  { name: 'landing', route: '/' },
  { name: 'sign-in', route: '/sign-in' },
  {
    name: 'sign-in, refused',
    route: '/sign-in',
    async arrange(page: import('@playwright/test').Page) {
      await mockSignInRefused(page);
      await page.getByLabel('Email address').fill('nobody@example.invalid');
      await page.getByLabel('Password').fill('not the right password');
      await page.getByRole('button', { name: 'Sign in' }).click();
      // Scoped to the form: Next renders its own route announcer as a
      // `role="alert"` live region on every page, so an unscoped lookup matches
      // two things.
      await expect(page.locator('form').getByRole('alert')).toContainText('do not match');
    },
  },
  { name: 'forgot-password', route: '/forgot-password' },
  {
    name: 'forgot-password, sent',
    route: '/forgot-password',
    async arrange(page: import('@playwright/test').Page) {
      await mockAccepted(page, '**/api/v1/auth/forgot-password');
      await page.getByLabel('Email address').fill('someone@example.invalid');
      await page.getByRole('button', { name: 'Email me a link' }).click();
      await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
    },
  },
  { name: 'activate', route: '/activate?token=example-activation-token' },
  { name: 'activate, link missing its token', route: '/activate' },
  { name: 'reset-password', route: '/reset-password?token=example-reset-token' },
  {
    name: 'session',
    route: '/session',
    async before(page: import('@playwright/test').Page) {
      await mockSignedIn(page);
    },
    async arrange(page: import('@playwright/test').Page) {
      await expect(page.getByRole('heading', { name: 'Your session' })).toBeVisible();
      // The greeting, asserted rather than assumed: settling on the heading and
      // the table would scan and pass on a page where it never rendered, and the
      // client's guard on it is a truthiness check that fails silent.
      await expect(page.getByText('Welcome, Marilou')).toBeVisible();
      await expect(page.getByRole('table')).toBeVisible();
    },
  },
  {
    name: 'people, before searching',
    route: '/people',
    async before(page: import('@playwright/test').Page) {
      await mockSignedIn(page);
      await mockPeople(page);
    },
    async arrange(page: import('@playwright/test').Page) {
      await expect(page.getByRole('button', { name: 'Search' })).toBeVisible();
    },
  },
  {
    // The state the whole screen exists for: one row the viewer pastors and one
    // they do not, so section 8's redaction is scanned rather than assumed.
    name: 'people, with results',
    route: '/people',
    async before(page: import('@playwright/test').Page) {
      await mockSignedIn(page);
      await mockPeople(page);
    },
    async arrange(page: import('@playwright/test').Page) {
      await page.getByLabel('Search by name').fill('an');
      await page.getByRole('button', { name: 'Search' }).click();
      await expect(page.getByText('Marilou Reyes Santos')).toBeVisible();
      await expect(page.getByText('Details visible to their own leaders')).toBeVisible();
    },
  },
  {
    name: 'person profile',
    route: `/people/${PERSON_IN_SCOPE.id}`,
    pattern: '/people/[id]',
    async before(page: import('@playwright/test').Page) {
      await mockSignedIn(page);
      await mockPeople(page);
      await mockPastoralPath(page);
    },
    async arrange(page: import('@playwright/test').Page) {
      await expect(page.getByRole('heading', { name: 'Marilou Reyes Santos' })).toBeVisible();
      await expect(page.getByText(/^Pastored by/)).toBeVisible();
      // The Cell and DCC sections (decisions 0248 and 0247), waited for rather than
      // assumed: each loads on its own request, and a scan before both arrive would pass on
      // a profile nobody sees.
      await expect(page.getByRole('button', { name: 'Move to another Cell' })).toBeVisible();
      await expect(page.getByText('Service removed · not counted')).toBeVisible();
    },
  },
  {
    // The Move dialog, the first dialog in the application: a modal `<dialog>` over the
    // profile, with its Cell choice.
    name: 'person profile, moving to another cell',
    route: `/people/${PERSON_IN_SCOPE.id}`,
    pattern: '/people/[id]',
    async before(page: import('@playwright/test').Page) {
      await mockSignedIn(page);
      await mockPeople(page);
      await mockCellChoices(page);
    },
    async arrange(page: import('@playwright/test').Page) {
      await page.getByRole('button', { name: 'Move to another Cell' }).click();
      await expect(page.getByRole('dialog').getByRole('combobox', { name: 'Cell' })).toBeVisible();
    },
  },
  {
    // Move to another leader: the leader search inside the dialog, offered to an account
    // that may move people.
    name: 'person profile, moving to another leader',
    route: `/people/${PERSON_IN_SCOPE.id}`,
    pattern: '/people/[id]',
    async before(page: import('@playwright/test').Page) {
      await mockSignedIn(page);
      await mockGrants(page, ['people.manage_pastoral_assignment']);
      await mockPeople(page);
      await mockPastoralPath(page);
    },
    async arrange(page: import('@playwright/test').Page) {
      await page.getByRole('button', { name: 'Move to another leader' }).click();
      await expect(
        page.getByRole('dialog').getByLabel('Search for a leader by name'),
      ).toBeVisible();
    },
  },
  {
    // The person was created and the Cell chosen for them was refused: a heading, a
    // failure notice naming both Networks, and one link onward.
    name: 'add a person, cell refused',
    route: '/people/new',
    pattern: '/people/new',
    async before(page: import('@playwright/test').Page) {
      await mockSignedIn(page);
      await mockPeople(page);
      await mockCellChoices(page);
      await mockPersonCreated(page);
      await mockMembershipAdd(page, 'other-network');
    },
    async arrange(page: import('@playwright/test').Page) {
      await page.getByLabel('First name').fill('Marilou');
      await page.getByLabel('Last name').fill('Santos');
      await page.getByRole('radio', { name: 'Female' }).check();
      await page.getByRole('radio', { name: 'Married' }).check();
      await page.getByLabel('Search for a leader by name').fill('an');
      await page.getByRole('button', { name: 'Find' }).click();
      await page.getByRole('button', { name: 'Choose' }).first().click();
      await page.getByRole('combobox', { name: 'Cell' }).selectOption({ index: 2 });
      await page.getByRole('button', { name: 'Add person' }).click();
      await expect(
        page.getByRole('heading', { name: 'Marilou Reyes Santos was added' }),
      ).toBeVisible();
    },
  },
  {
    name: 'edit a person',
    route: `/people/${PERSON_IN_SCOPE.id}/edit`,
    pattern: '/people/[id]/edit',
    async before(page: import('@playwright/test').Page) {
      await mockSignedIn(page);
      await mockPeople(page);
      await mockPastoralPath(page);
    },
    async arrange(page: import('@playwright/test').Page) {
      await expect(page.getByRole('button', { name: 'Save changes' })).toBeVisible();
      await expect(page.getByText('Teofilo Ramos', { exact: true })).toBeVisible();
    },
  },
  {
    name: 'add a person',
    route: '/people/new',
    async before(page: import('@playwright/test').Page) {
      await mockSignedIn(page);
      await mockPeople(page);
    },
    async arrange(page: import('@playwright/test').Page) {
      await expect(page.getByRole('heading', { name: 'Add a person' })).toBeVisible();
    },
  },
  {
    // The pre-flight lookup (section 3, section 9 step 1) — the only surface a
    // Tier 2 candidate has, since creation can refuse on Tier 1 alone. One
    // candidate carries reasons and one is withheld by section 8.
    name: 'add a person, possible matches',
    route: '/people/new',
    pattern: '/people/new',
    async before(page: import('@playwright/test').Page) {
      await mockSignedIn(page);
      await mockPeople(page);
      await mockPossibleMatches(page);
    },
    async arrange(page: import('@playwright/test').Page) {
      await page.getByLabel('First name').fill('Marilou');
      await page.getByLabel('Last name').fill('Santos');
      await expect(
        page.getByRole('heading', { name: 'Someone similar is already recorded' }),
      ).toBeVisible();
      await expect(page.getByText('Same first and last name')).toBeVisible();
      // Two withheld candidates, and the second carries a tier as well as the
      // flag. It must still read as withheld — which only `possible_match` can
      // decide, so this is what pins the client reading the flag rather than
      // inferring the same fact from an absent tier.
      await expect(
        page.getByText('Their details are visible to the leaders who pastor them.'),
      ).toHaveCount(2);
    },
  },
  {
    // The duplicate refusal, which is the reason the create screen has the shape
    // it has. One candidate carries reasons and one is withheld.
    name: 'add a person, duplicate candidates',
    route: '/people/new',
    pattern: '/people/new',
    async before(page: import('@playwright/test').Page) {
      await mockSignedIn(page);
      await mockDuplicateRefusal(page);
      await mockPeople(page);
    },
    async arrange(page: import('@playwright/test').Page) {
      await page.getByLabel('First name').fill('Marilou');
      await page.getByLabel('Last name').fill('Santos');
      await page.getByRole('radio', { name: 'Female' }).check();
      await page.getByRole('radio', { name: 'Married' }).check();
      await page.getByLabel('Search for a leader by name').fill('an');
      await page.getByRole('button', { name: 'Find' }).click();
      await page.getByRole('button', { name: 'Choose' }).first().click();
      await page.getByRole('button', { name: 'Add person' }).click();
      await expect(
        page.getByRole('heading', { name: 'Is this someone already recorded?' }),
      ).toBeVisible();
    },
  },
  {
    // The halt: a failure notice, a warning paragraph, and a control that says
    // something different from the one on any other screen. It renders new
    // content, so it is its own entry — which is the rule this list already
    // states and which the commit that added the state did not follow.
    name: 'session, halted',
    route: '/session',
    async before(page: import('@playwright/test').Page) {
      await page.addInitScript(() => {
        window.localStorage.setItem('dfc.refresh_token', 'test-refresh-token');
      });
      await page.route('**/api/v1/auth/refresh', (route) => route.abort('failed'));
    },
    async arrange(page: import('@playwright/test').Page) {
      await expect(page.getByRole('button', { name: 'Try again anyway' })).toBeVisible();
    },
  },
  {
    // Two rows, and the second is the one worth scanning: a Cell that scheduled
    // nothing reads `0 of 0` and is shown rather than dropped (decision 0225).
    name: 'cells',
    route: '/cells',
    async before(page: import('@playwright/test').Page) {
      await mockSignedIn(page);
      await mockCells(page);
    },
    async arrange(page: import('@playwright/test').Page) {
      await expect(page.getByRole('heading', { name: 'Cells', exact: true })).toBeVisible();
      await expect(page.getByRole('link', { name: 'C-0007' })).toBeVisible();
      // The `0 of 0` row, asserted rather than assumed: settling on the heading
      // alone would pass on a page where the second row never rendered.
      await expect(page.getByRole('link', { name: 'C-0011' })).toBeVisible();
    },
  },
  {
    // A leader who oversees no Cell this month. A sentence, never an error.
    name: 'cells, none in scope',
    route: '/cells',
    async before(page: import('@playwright/test').Page) {
      await mockSignedIn(page);
      await mockCellsEmpty(page);
    },
    async arrange(page: import('@playwright/test').Page) {
      await expect(page.getByText('There are no Cells in your scope this month.')).toBeVisible();
    },
  },
  {
    // All four states in one month: met, did not meet, moved, and the one that
    // is not a status at all.
    name: 'cell meetings',
    route: '/cells/3f1b7c6e-0000-4000-8000-000000000101/meetings',
    // The route this scan stands for, since the visited one carries an
    // identifier and the app directory declares a dynamic segment.
    pattern: '/cells/[id]/meetings',
    async before(page: import('@playwright/test').Page) {
      await mockSignedIn(page);
      await mockCellMeetings(page);
    },
    async arrange(page: import('@playwright/test').Page) {
      await expect(page.getByRole('heading', { name: 'Cell C-0007' })).toBeVisible();
      // Filtered to what is visible: the rows render as a table from `lg` and as cards
      // below it, so each word is in the page twice and one copy is hidden.
      await expect(page.getByText('Awaiting a record').filter({ visible: true })).toBeVisible();
      await expect(
        page.getByText('Did not meet', { exact: true }).filter({ visible: true }),
      ).toBeVisible();
    },
  },
  {
    // "Change when it meets", the schedule change as a dialog over the Cell's page: seven
    // day radios, the time, and what the Cell meets on now.
    name: 'cell meetings, changing when it meets',
    route: '/cells/3f1b7c6e-0000-4000-8000-000000000101/meetings',
    pattern: '/cells/[id]/meetings',
    async before(page: import('@playwright/test').Page) {
      await mockSignedIn(page);
      await mockCellMeetings(page);
    },
    async arrange(page: import('@playwright/test').Page) {
      await expect(page.getByRole('heading', { name: 'Cell C-0007' })).toBeVisible();
      await page.getByRole('button', { name: 'Change when it meets' }).click();
      const dialog = page.getByRole('dialog', { name: 'Change when C-0007 meets' });
      await expect(dialog.getByRole('radio', { name: 'Wednesday' })).toBeVisible();
      await expect(dialog.getByText(/^Meets now on/)).toBeVisible();
    },
  },
  {
    // A removed Sunday in its place with its reason, and one that has not
    // happened, whose coverage is words rather than a zero.
    name: 'dcc calendar',
    route: '/dcc',
    async before(page: import('@playwright/test').Page) {
      await mockSignedIn(page);
      await mockDccEvents(page);
    },
    async arrange(page: import('@playwright/test').Page) {
      await expect(page.getByRole('heading', { name: 'DCC Attendance' })).toBeVisible();
      await expect(page.getByText('No service was held.')).toBeVisible();
      await expect(page.getByText('No records owed yet')).toBeVisible();
    },
  },
  {
    // The recording form, with a member nobody has marked. That row is the state
    // worth scanning: it is a third state beside present and absent, and it must
    // reach the leader as a choice rather than as a pre-selected Absent.
    name: 'record a cell meeting',
    route: '/cells/3f1b7c6e-0000-4000-8000-000000000101/meetings/2026-06-27',
    pattern: '/cells/[id]/meetings/[date]',
    async before(page: import('@playwright/test').Page) {
      await mockSignedIn(page);
      await mockMeetingRoster(page);
    },
    async arrange(page: import('@playwright/test').Page) {
      await expect(page.getByRole('heading', { name: 'Saturday 27 June' })).toBeVisible();
      await expect(page.getByText('2 members still to mark.')).toBeVisible();
    },
  },
  {
    // A recorded meeting as an account that may correct it sees it: the marks locked,
    // and the edit offered (decision 0246). The locked radios are the new content.
    name: 'record a cell meeting, recorded',
    route: '/cells/3f1b7c6e-0000-4000-8000-000000000101/meetings/2026-06-27',
    pattern: '/cells/[id]/meetings/[date]',
    async before(page: import('@playwright/test').Page) {
      await mockSignedIn(page);
      await mockCellCorrector(page);
      await mockRecordedMeetingRoster(page, 'HELD');
    },
    async arrange(page: import('@playwright/test').Page) {
      await expect(page.getByRole('button', { name: 'Edit this record' })).toBeVisible();
    },
  },
  {
    // The same meeting once "Edit this record" is pressed: the reason field and the
    // pinned Save bar appear.
    name: 'record a cell meeting, editing',
    route: '/cells/3f1b7c6e-0000-4000-8000-000000000101/meetings/2026-06-27',
    pattern: '/cells/[id]/meetings/[date]',
    async before(page: import('@playwright/test').Page) {
      await mockSignedIn(page);
      await mockCellCorrector(page);
      await mockRecordedMeetingRoster(page, 'HELD');
    },
    async arrange(page: import('@playwright/test').Page) {
      await page.getByRole('button', { name: 'Edit this record' }).click();
      await expect(page.getByLabel('Why is this changing? (optional)')).toBeVisible();
    },
  },
  {
    // A meeting recorded as did not meet: its reason and note, read-only.
    name: 'record a cell meeting, not held',
    route: '/cells/3f1b7c6e-0000-4000-8000-000000000101/meetings/2026-06-27',
    pattern: '/cells/[id]/meetings/[date]',
    async before(page: import('@playwright/test').Page) {
      await mockSignedIn(page);
      await mockRecordedMeetingRoster(page, 'NOT_HELD');
    },
    async arrange(page: import('@playwright/test').Page) {
      await expect(page.getByText('Why: Weather or calamity')).toBeVisible();
    },
  },
  {
    // A meeting whose day has not come: no marks and no Save bar (decision 0238).
    name: 'record a cell meeting, not yet',
    route: '/cells/3f1b7c6e-0000-4000-8000-000000000101/meetings/2026-06-27',
    pattern: '/cells/[id]/meetings/[date]',
    async before(page: import('@playwright/test').Page) {
      // 10:00 on 20 June in Manila, a week before the meeting.
      await page.clock.setFixedTime(new Date('2026-06-20T02:00:00Z'));
      await mockSignedIn(page);
      await mockMeetingRoster(page);
    },
    async arrange(page: import('@playwright/test').Page) {
      await expect(page.getByText('Not yet', { exact: true })).toBeVisible();
    },
  },
  {
    // Recorded marks unlocked for an account that may correct them, with the reason field.
    name: 'dcc checklist, changing recorded marks',
    route: '/dcc/3f1b7c6e-0000-4000-8000-000000000501',
    pattern: '/dcc/[id]',
    async before(page: import('@playwright/test').Page) {
      await mockSignedIn(page);
      await mockGrants(page, ['dcc.correct_subtree']);
      await mockDccRoster(page);
    },
    async arrange(page: import('@playwright/test').Page) {
      await page.getByRole('button', { name: 'Change recorded marks' }).click();
      await expect(page.getByLabel('Why is this changing? (optional)')).toBeVisible();
    },
  },
  {
    // A Sunday whose month has closed: the recorded mark shown in a disabled group.
    name: 'dcc checklist, closed Sunday',
    route: '/dcc/3f1b7c6e-0000-4000-8000-000000000501',
    pattern: '/dcc/[id]',
    async before(page: import('@playwright/test').Page) {
      await mockSignedIn(page);
      await mockClosedDccRoster(page);
    },
    async arrange(page: import('@playwright/test').Page) {
      await expect(page.getByText('This Sunday takes no record')).toBeVisible();
    },
  },
  {
    // Where a leader lands: outstanding work above the numbers (section 19).
    name: 'dashboard',
    route: '/dashboard',
    async before(page: import('@playwright/test').Page) {
      await mockSignedIn(page);
      await mockCells(page);
      await mockCellMeetings(page);
      await mockMeetingsAwaiting(page);
      await mockCellReport(page);
      await mockDccReport(page);
      await mockDccEvents(page);
      await mockDccRoster(page);
      await mockAwaitingReassignment(page);
      await mockPeopleWithoutACell(page);
    },
    async arrange(page: import('@playwright/test').Page) {
      await expect(page.getByRole('heading', { name: 'Awaiting a record' })).toBeVisible();
      // **A row of each kind in the queue, so axe scans both.** The Cell rows wait on
      // their per-Cell meetings reads and the Sunday rows on their checklists, and
      // nothing orders the two, so each is waited for.
      await expect(page.getByRole('link', { name: /^Record Cell / }).first()).toBeVisible();
      await expect(page.getByRole('link', { name: /^Record DCC Sunday/ }).first()).toBeVisible();
      // A tile carries its scope and its period, which section 19 requires of
      // every one of them.
      await expect(page.getByText(/People you oversee ·/).first()).toBeVisible();
      // **Both of the above render before any query resolves** — the heading is
      // static and the scope label defaults while `me.data` is undefined — so axe
      // would otherwise scan a page with no rows on it.
      await expect(page.getByRole('link', { name: 'Amihan Bacani' })).toBeVisible();
    },
  },
  {
    // Section 15's people-without-a-Cell list, which section 10's closure flow fills
    // (decision 0233).
    name: 'people without a cell',
    route: '/cells/people-without-a-cell',
    async before(page: import('@playwright/test').Page) {
      await mockSignedIn(page);
      await mockPeopleWithoutACell(page);
    },
    async arrange(page: import('@playwright/test').Page) {
      await expect(page.getByRole('heading', { name: 'Bituin Carreon' })).toBeVisible();
    },
  },
  {
    // Add to a Cell from the list: the profile's dialog, over the Cells of the viewer's scope.
    name: 'people without a cell, adding to a cell',
    route: '/cells/people-without-a-cell',
    async before(page: import('@playwright/test').Page) {
      await mockSignedIn(page);
      await mockPeopleWithoutACell(page);
      await mockCells(page);
    },
    async arrange(page: import('@playwright/test').Page) {
      await page.getByRole('button', { name: 'Add to a Cell' }).first().click();
      const dialog = page.getByRole('dialog', { name: 'Add Bituin Carreon to a Cell' });
      await expect(dialog.getByRole('combobox', { name: 'Cell' })).toBeVisible();
    },
  },
  {
    // Section 20's attention list, which the placement graph's reconstruction would
    // otherwise keep invisible (decision 0232).
    name: 'people awaiting reassignment',
    route: '/people/awaiting-reassignment',
    async before(page: import('@playwright/test').Page) {
      await mockSignedIn(page);
      await mockAwaitingReassignment(page);
    },
    async arrange(page: import('@playwright/test').Page) {
      await expect(page.getByRole('heading', { name: 'Amihan Bacani' })).toBeVisible();
    },
  },
  {
    // The drill-down without which a coverage figure is a dashboard of counts.
    name: 'dcc coverage gaps',
    route: '/dcc/3f1b7c6e-0000-4000-8000-000000000501/gaps',
    pattern: '/dcc/[id]/gaps',
    async before(page: import('@playwright/test').Page) {
      await mockSignedIn(page);
      await mockCoverageGaps(page);
    },
    async arrange(page: import('@playwright/test').Page) {
      await expect(page.getByRole('heading', { name: 'Consuelo Bautista' })).toBeVisible();
    },
  },
  {
    // The chain from the Network root down, with the root named in words.
    name: 'pastoral network',
    route: '/people/3f1b7c6e-0000-4000-8000-000000000601/network',
    pattern: '/people/[id]/network',
    async before(page: import('@playwright/test').Page) {
      await mockSignedIn(page);
      await mockPeople(page);
      await mockPastoralPath(page);
    },
    async arrange(page: import('@playwright/test').Page) {
      await expect(page.getByRole('heading', { name: 'Corazon Villanueva' })).toBeVisible();
      await expect(page.getByText('Network root')).toBeVisible();
    },
  },
  {
    // The branch as a leader opens it (decision 0252): the focus block, four cards, rows
    // by name with both figures, Move and Open on each, and `Show 20 more` because the
    // first page carries a cursor.
    name: 'network',
    route: '/network',
    async before(page: import('@playwright/test').Page) {
      await mockSignedIn(page);
      await mockPastoralPathAtRoot(page);
      await mockNetworkTree(page);
      await mockNetworkReader(page);
    },
    async arrange(page: import('@playwright/test').Page) {
      await expect(page.getByRole('link', { name: 'Consuelo Bautista' }).first()).toBeVisible();
      await expect(page.getByRole('button', { name: 'Move Efren Dimaculangan' }).first()).toBeVisible();
      await expect(page.getByRole('button', { name: 'Show 20 more' })).toBeVisible();
    },
  },
  {
    // A reader holding neither figure capability: the tree without the figures, shown as
    // dashes rather than zeros, and no Move.
    name: 'network, without figures',
    route: '/network',
    async before(page: import('@playwright/test').Page) {
      await mockSignedIn(page);
      await mockPastoralPathAtRoot(page);
      await mockNetworkTree(page);
    },
    async arrange(page: import('@playwright/test').Page) {
      await expect(page.getByText('Network root')).toBeVisible();
      await expect(page.getByRole('link', { name: 'Consuelo Bautista' }).first()).toBeVisible();
    },
  },
  {
    // One generation down, reached by its address as the Back button would reach it: the
    // breadcrumb links back to the reader, and Up one level is offered.
    name: 'network, one generation down',
    route: '/network?focus=3f1b7c6e-0000-4000-8000-000000000701',
    async before(page: import('@playwright/test').Page) {
      await mockSignedIn(page);
      await mockPastoralPathAtRoot(page);
      await mockNetworkTree(page);
      await mockNetworkReader(page);
    },
    async arrange(page: import('@playwright/test').Page) {
      await expect(page.getByRole('link', { name: 'Teresita Alcantara' }).first()).toBeVisible();
      await expect(page.getByRole('link', { name: 'Up one level' })).toBeVisible();
    },
  },
  {
    // Two members, each removable behind a confirmation, under the Add a member button.
    name: 'cell members',
    route: '/cells/3f1b7c6e-0000-4000-8000-000000000101/members',
    pattern: '/cells/[id]/members',
    async before(page: import('@playwright/test').Page) {
      await mockSignedIn(page);
      await mockCellMembers(page);
  await mockCoverageGaps(page);
  await mockPastoralPath(page);
    },
    async arrange(page: import('@playwright/test').Page) {
      await expect(page.getByRole('heading', { name: 'Rosalinda Ocampo' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Add a member' })).toBeVisible();
    },
  },
  {
    // The confirmation, which renders new content and so is its own scanned state.
    name: 'cell members, confirming a removal',
    route: '/cells/3f1b7c6e-0000-4000-8000-000000000101/members',
    async before(page: import('@playwright/test').Page) {
      await mockSignedIn(page);
      await mockCellMembers(page);
    },
    async arrange(page: import('@playwright/test').Page) {
      await page.getByRole('button', { name: 'Remove' }).first().click();
      await expect(page.getByRole('button', { name: 'Yes, remove' })).toBeVisible();
      await expect(page.getByText(/Past months keep counting them/).filter({ visible: true })).toBeVisible();
    },
  },
  {
    name: 'cell members, none yet',
    route: '/cells/3f1b7c6e-0000-4000-8000-000000000101/members',
    async before(page: import('@playwright/test').Page) {
      await mockSignedIn(page);
      await mockCellMembersEmpty(page);
    },
    async arrange(page: import('@playwright/test').Page) {
      await expect(page.getByText('This Cell has no members yet.')).toBeVisible();
    },
  },
  {
    // The Add a member dialog: the church-wide person search, searched, with a result.
    name: 'cell members, adding a member',
    route: '/cells/3f1b7c6e-0000-4000-8000-000000000101/members',
    pattern: '/cells/[id]/members',
    async before(page: import('@playwright/test').Page) {
      await mockSignedIn(page);
      await mockPeople(page);
      await mockCellMeetings(page);
      await mockCellMembers(page);
    },
    async arrange(page: import('@playwright/test').Page) {
      await expect(page.getByRole('heading', { name: 'Rosalinda Ocampo' })).toBeVisible();
      await page.getByRole('button', { name: 'Add a member' }).click();
      const dialog = page.getByRole('dialog', { name: 'Add a member to C-0007' });
      await dialog.getByLabel('Search for a person by name').fill('Marilou');
      await dialog.getByRole('button', { name: 'Find' }).click();
      await expect(dialog.getByRole('button', { name: 'Choose' }).first()).toBeVisible();
    },
  },
  {
    // The aggregate arm: coverage leads, and no buckets, which section 12 makes a
    // structural rule rather than a rendering choice.
    name: 'cell attendance report',
    route: '/reports/cells',
    async before(page: import('@playwright/test').Page) {
      await mockSignedIn(page);
      await mockCells(page);
      await mockCellReport(page);
    },
    async arrange(page: import('@playwright/test').Page) {
      await expect(page.getByRole('heading', { name: 'Recording coverage' })).toBeVisible();
      await expect(page.getByText('6 of 8 meetings recorded')).toBeVisible();
      await expect(page.getByRole('heading', { name: 'How often people came' })).toHaveCount(0);
      await expect(page.getByText('3 of 4 meetings recorded').filter({ visible: true })).toBeVisible();
    },
  },
  {
    // How these are counted: a dialog of terms and sentences over the report.
    name: 'cell attendance report, how these are counted',
    route: '/reports/cells',
    async before(page: import('@playwright/test').Page) {
      await mockSignedIn(page);
      await mockCells(page);
      await mockCellReport(page);
    },
    async arrange(page: import('@playwright/test').Page) {
      await page.getByRole('button', { name: 'How these are counted' }).click();
      await expect(
        page.getByRole('dialog', { name: 'How these are counted' }).getByText('An open month'),
      ).toBeVisible();
    },
  },
  {
    // One Cell, which is where section 12 permits buckets. The completed column
    // carries the API's own flag rather than a comparison against the calendar.
    name: 'cell attendance report, one Cell',
    route: '/reports/cells',
    async before(page: import('@playwright/test').Page) {
      await mockSignedIn(page);
      await mockCells(page);
      await mockCellReportForOneCell(page);
    },
    async arrange(page: import('@playwright/test').Page) {
      await page.getByLabel('Figures for').selectOption('3f1b7c6e-0000-4000-8000-000000000101');
      await expect(page.getByRole('heading', { name: 'How often people came' })).toBeVisible();
      await expect(page.getByText('3 times — all of them')).toBeVisible();
    },
  },
  {
    // The By leader table (decision 0254): the reader first, one other leader, the unnamed
    // line and the total, reached by the switch beside By Sunday.
    name: 'dcc figures report, by leader',
    route: '/reports/dcc',
    async before(page: import('@playwright/test').Page) {
      await mockSignedIn(page);
      await mockDccReport(page);
      await mockDccEvents(page);
      await mockCoverageByLeader(page);
    },
    async arrange(page: import('@playwright/test').Page) {
      await page.getByText('By leader', { exact: true }).click();
      await expect(page.getByRole('link', { name: 'Consuelo Bautista' })).toBeVisible();
      await expect(page.getByText('Leaders outside your reach')).toBeVisible();
    },
  },
  {
    // A year of the DCC report (decision 0257): one row per month that has begun, and a year
    // row adding up Owed and Filed only.
    name: 'dcc figures report, year',
    route: '/reports/dcc?period=year&month=2026-06-01',
    async before(page: import('@playwright/test').Page) {
      await mockSignedIn(page);
      await mockDccReport(page);
    },
    async arrange(page: import('@playwright/test').Page) {
      await expect(page.getByRole('heading', { name: /Month by month/ })).toBeVisible();
      await expect(page.getByText('Year so far')).toBeVisible();
      await expect(page.getByText('Loading…')).toHaveCount(0);
    },
  },
  {
    // The same for the Cell report.
    name: 'cell attendance report, year',
    route: '/reports/cells?period=year&month=2026-06-01',
    async before(page: import('@playwright/test').Page) {
      await mockSignedIn(page);
      await mockCells(page);
      await mockCellReport(page);
    },
    async arrange(page: import('@playwright/test').Page) {
      await expect(page.getByRole('heading', { name: /Month by month/ })).toBeVisible();
      await expect(page.getByText('Year so far')).toBeVisible();
      await expect(page.getByText('Loading…')).toHaveCount(0);
    },
  },
  {
    // One leader opened from that table: the switch is gone, the table shows their branch,
    // and a link returns to the reader's own report.
    name: 'cell attendance report, one leader',
    route: '/reports/cells?month=2026-06-01&leader=3f1b7c6e-0000-4000-8000-000000000701',
    async before(page: import('@playwright/test').Page) {
      await mockSignedIn(page);
      await mockCells(page);
      await mockCellReport(page);
      await mockCoverageByLeader(page);
    },
    async arrange(page: import('@playwright/test').Page) {
      await expect(page.getByRole('link', { name: 'Back to your report' })).toBeVisible();
      await expect(page.getByText('Report coverage')).toBeVisible();
    },
  },
  {
    // The removed Sunday is named, because section 9 requires a removal to be
    // explained rather than left as a smaller number.
    name: 'dcc figures report',
    route: '/reports/dcc',
    async before(page: import('@playwright/test').Page) {
      await mockSignedIn(page);
      await mockDccReport(page);
      await mockDccEvents(page);
    },
    async arrange(page: import('@playwright/test').Page) {
      await expect(page.getByRole('heading', { name: 'Reports', exact: true })).toBeVisible();
      await expect(page.getByText('12 of 18 records filed')).toBeVisible();
      await expect(page.getByText(/No service was held on Sunday 14 June/)).toBeVisible();
      await expect(page.getByText('5 of 8 records filed').filter({ visible: true })).toBeVisible();
    },
  },
  {
    // One person already recorded and one not, which is what section 9 means by a
    // checklist whose lines mostly repeat what is already there.
    name: 'dcc checklist',
    route: '/dcc/3f1b7c6e-0000-4000-8000-000000000501',
    pattern: '/dcc/[id]',
    async before(page: import('@playwright/test').Page) {
      await mockSignedIn(page);
      await mockDccRoster(page);
    },
    async arrange(page: import('@playwright/test').Page) {
      await expect(page.getByRole('heading', { name: 'Sunday 7 June' })).toBeVisible();
      await expect(page.getByText('Not recorded yet')).toBeVisible();
    },
  },
] as const;

for (const theme of THEMES) {
  test.describe(`${theme} theme`, () => {
    test.use({ colorScheme: theme });

    for (const scan of SCANS) {
      test(`${scan.name} has no axe violations`, async ({ page }) => {
        if ('before' in scan && scan.before) {
          await scan.before(page);
        }

        await page.goto(scan.route);

        if ('arrange' in scan && scan.arrange) {
          await scan.arrange(page);
        }

        const results = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
          .analyze();

        expect(
          results.violations.map((violation) => ({
            id: violation.id,
            help: violation.help,
            nodes: violation.nodes.map((node) => node.target.join(' ')),
          })),
        ).toEqual([]);
      });
    }
  });
}

/**
 * WCAG 2.5.8: every interactive target is at least 24 by 24 CSS pixels.
 *
 * axe does not check this, and section 23 names it because Cell attendance is
 * recorded by tapping down a roster on a phone, often standing up. It is checked
 * here rather than left to the pull request's own statement, because it is one
 * of the four that *is* partly measurable, and this repository's standing
 * complaint about itself is rules with nothing able to fail on them.
 *
 * **One state relies on the criterion's own inline exception**, and it is named
 * in `TARGET_EXEMPT` below rather than quietly skipped. The exception is not
 * implemented as a rule — deciding whether a link is "inline" from the DOM is
 * guesswork — so a state that needs it is listed, with its reason, and the guard
 * beneath makes the list exhaustive.
 */
/**
 * Each route, the control that proves it has finished rendering, and how many
 * targets it owns.
 *
 * **The count is stated per route rather than asserted to be non-zero**, and
 * that is the whole of what makes this test non-vacuous. The skip link lives in
 * the root layout, so it matches on *every* route: a `> 0` guard is satisfied by
 * the layout alone and can never fail. Worse, `/session` renders `Loading…` with
 * no controls until `RequireSession` settles, so a sweep that measured
 * immediately would have passed on the skip link and never measured either
 * sign-out button.
 *
 * Targets are counted inside `<main>`, which excludes the skip link; it is
 * measured separately below, in the state it is offered in.
 */
const TARGET_SWEEP = [
  { name: 'sign-in', route: '/sign-in', settle: 'Sign in', minimum: 4 },
  { name: 'forgot-password', route: '/forgot-password', settle: 'Email me a link', minimum: 3 },
  {
    name: 'activate',
    route: '/activate?token=example-activation-token',
    settle: 'Activate account',
    minimum: 2,
  },
  {
    name: 'reset-password',
    route: '/reset-password?token=example-reset-token',
    settle: 'Save new password',
    minimum: 2,
  },
  { name: 'session', route: '/session', settle: 'Sign out on every device', minimum: 2 },
  // The search box, the Search button and the "Add a person" link. The nav lives
  // in the header, outside `<main>`, and is counted on no route.
  { name: 'people, before searching', route: '/people', settle: 'Search', minimum: 3 },
  // 5 Field inputs, 5 radios (2 sex + 3 civil status), the leader search input,
  // its Find button, and the submit button.
  { name: 'add a person', route: '/people/new', settle: 'Find', minimum: 13 },
  {
    name: 'person profile',
    route: `/people/${PERSON_IN_SCOPE.id}`,
    // Settled on a link: Edit details and Pastoral network navigate. With the link to the
    // leader who pastors them, three; the Cell and DCC sections add more once they load.
    // No Move to another leader for this account, which may not move people.
    settleRole: 'link' as const,
    settle: 'Edit details',
    minimum: 3,
  },
  {
    name: 'edit a person',
    route: `/people/${PERSON_IN_SCOPE.id}/edit`,
    settle: 'Save changes',
    // Back link, 5 Field inputs, 3 civil-status radios, Save, Cancel.
    minimum: 11,
  },
  {
    // The link to people without a Cell, two month controls, the "only my Cells" filter,
    // and a link per Cell. The month controls are icon-only and are the reason this state
    // is measured rather than exempted: an icon button is where a 24px target goes wrong.
    name: 'cells',
    route: '/cells',
    settleRole: 'link' as const,
    settle: 'C-0007',
    minimum: 6,
  },
  {
    name: 'cell meetings',
    route: '/cells/3f1b7c6e-0000-4000-8000-000000000101/meetings',
    settleRole: 'heading' as const,
    settle: 'Cell C-0007',
    // The back link, Members, Change when it meets, the two month controls, and a link
    // per meeting across the fixture's four.
    minimum: 9,
  },
  {
    name: 'dcc calendar',
    route: '/dcc',
    settleRole: 'heading' as const,
    settle: 'DCC Attendance',
    minimum: 2,
  },
  {
    // Back link, two status radios, two radios per member across two members, and
    // Save.
    //
    // **Settled on the roster heading rather than the page heading**, which renders
    // from the URL and is on screen before the roster arrives — so settling there
    // counted the controls of a page that had not loaded its members yet, and the
    // `minimum` caught it.
    name: 'record a cell meeting',
    route: '/cells/3f1b7c6e-0000-4000-8000-000000000101/meetings/2026-06-27',
    settleRole: 'heading' as const,
    settle: 'Who was there',
    minimum: 8,
  },
  {
    // Six tile links, two awaiting-a-record links, one attention link, two people
    // needing a leader, and that section's own link to the full list: **twelve**.
    //
    // **The floor is what the page owns, not what has loaded when the settle
    // resolves.** It was 8 — the six tiles plus the two rows the settle waits for —
    // which could not detect the loss of the awaiting-a-record section, the attention
    // row, or the very section the floor had just been raised for. That is this
    // file's fourth encounter with the same trap.
    name: 'dashboard',
    route: '/dashboard',
    // **Settled on a person in the last section to load, not on the first heading.**
    // The page heading and the awaiting-a-record heading both render before the
    // queries resolve, so counting there counted six controls on a page that owns
    // more — which is what the floor caught when this section was added.
    //
    // **It settles on a row of *People without a Cell*, which is the last section in
    // the page.** It settled on `Amihan Bacani` — a row of *People needing a leader*,
    // one section earlier — for as long as that was the last one. Adding a section
    // after it left the settle resolving before the new queries did, and the count ran
    // two targets short: green on a fast machine and red in CI, which is the trap this
    // comment already records three earlier encounters with. The rule it states was
    // right and the name under it went stale, so moving a section means moving this.
    settleRole: 'link' as const,
    settle: 'Bituin Carreon',
    // Fifteen: the twelve above plus the two people without a Cell and the link into
    // that list, which section 15's second attention list contributes. Sixteen since
    // decision 0245 moved the way in to the DCC calendar from the sidebar onto this
    // page, so losing that link is something the floor now notices.
    //
    // **Twenty-one since UI-3**: the queue's three filter choices and its two Sunday
    // rows' Record buttons. The two awaiting-a-record links became the Cell rows' Record
    // buttons, one each. The queue shows "Loading…" until every read it is built from
    // has answered, and the sweep waits for no "Loading…" to remain before counting, so
    // both kinds of row are there when it counts.
    minimum: 21,
  },
  {
    // The back link, and a name link and an Add to a Cell button per person: five, with no
    // "Show more" for this fixture. Settled on a person rather than the page heading, which
    // renders before the list arrives.
    name: 'people without a cell',
    route: '/cells/people-without-a-cell',
    settleRole: 'heading' as const,
    settle: 'Bituin Carreon',
    minimum: 5,
  },
  {
    // The back link and one link per person, which is the reassignment section 19
    // asks each entry to carry. No "Show more": the fixture fits one page.
    //
    // **Settled on a person rather than on the page heading**, which renders before
    // the list arrives — the lesson the meeting-roster entry above records, and the
    // one this file has now learned three times.
    name: 'people awaiting reassignment',
    route: '/people/awaiting-reassignment',
    settleRole: 'heading' as const,
    settle: 'Amihan Bacani',
    minimum: 3,
  },
  {
    // The back link alone: the list is names, and naming a leader is the whole of
    // what decision 0228 permits here.
    name: 'dcc coverage gaps',
    route: '/dcc/3f1b7c6e-0000-4000-8000-000000000501/gaps',
    settleRole: 'heading' as const,
    settle: 'Consuelo Bautista',
    minimum: 1,
  },
  {
    // Back link and three people in the chain. The move moved to the profile.
    name: 'pastoral network',
    route: '/people/3f1b7c6e-0000-4000-8000-000000000601/network',
    settleRole: 'heading' as const,
    settle: 'Corazon Villanueva',
    minimum: 4,
  },
  {
    // Search, the disabled Up one level, the filter, two rows' Open links and Show 20
    // more. Settled on Show 20 more, which renders only once the page has arrived.
    name: 'network',
    route: '/network',
    settle: 'Show 20 more',
    minimum: 4,
  },
  {
    // The back link, Add a member, and a name link and a Remove per member. Settled on a
    // member's own heading, which renders from the data, so the count runs after the list
    // arrived.
    name: 'cell members',
    route: '/cells/3f1b7c6e-0000-4000-8000-000000000101/members',
    settleRole: 'heading' as const,
    settle: 'Rosalinda Ocampo',
    minimum: 6,
  },
  {
    // The two links of the Reports switch, How these are counted, two month controls, the
    // scope select, and a link per Cell in Coverage by Cell — two Cells, counted in the
    // table and the cards alike, since the count includes whichever of the two this
    // viewport hides.
    name: 'cell attendance report',
    route: '/reports/cells',
    settleRole: 'heading' as const,
    settle: 'Recording coverage',
    minimum: 10,
  },
  {
    // The Reports switch, How these are counted, the Month and Year choices and the two year
    // controls; the table itself holds no control.
    name: 'dcc figures report, year',
    route: '/reports/dcc?period=year&month=2026-06-01',
    settleRole: 'heading' as const,
    settle: 'Month by month',
    minimum: 7,
  },
  {
    name: 'cell attendance report, year',
    route: '/reports/cells?period=year&month=2026-06-01',
    settleRole: 'heading' as const,
    settle: 'Month by month',
    minimum: 7,
  },
  {
    // The Reports switch, How these are counted, two month controls and the Back link, at
    // least; the leader links below them vary with the mock.
    name: 'cell attendance report, one leader',
    route: '/reports/cells?month=2026-06-01&leader=3f1b7c6e-0000-4000-8000-000000000701',
    settleRole: 'link' as const,
    settle: 'Back to your report',
    minimum: 6,
  },
  {
    // The two links of the Reports switch, How these are counted and two month controls,
    // then Coverage by Sunday:
    // four Sunday links and the one "who still has to record" link, in the table and the
    // cards alike. No scope select for this fixture's viewer: the DCC report offers its
    // Network select only to a whole-church reader, and this fixture's reporting grant is
    // one Network. That select is why a whole-church reader lands on this report rather
    // than on the Cell figures.
    name: 'dcc figures report',
    route: '/reports/dcc',
    settleRole: 'heading' as const,
    settle: 'Recording coverage',
    minimum: 15,
  },
  {
    // Back link, two radios per person across two people, and Save. Six rather
    // than the meeting screen's eight: a DCC event has no held-or-not question,
    // because section 9 records a person's attendance and never the event's status.
    name: 'dcc checklist',
    route: '/dcc/3f1b7c6e-0000-4000-8000-000000000501',
    settleRole: 'heading' as const,
    settle: 'Sunday 7 June',
    minimum: 6,
  },
] as const;

/**
 * States deliberately not measured, each with the reason it is exempt.
 *
 * Nothing may leave `SCANS` without appearing in one of these two lists — the
 * guard below enforces it, so this cannot decay into "every state somebody
 * remembered", which is the failure the route walker further down was written to
 * prevent one list over.
 */
const TARGET_EXEMPT: { name: string; why: string }[] = [
  {
    name: 'dcc figures report, by leader',
    why:
      'Reached by clicking the By leader switch, which this sweep cannot do. Its controls are a ' +
      'text link per leader (min-h-6, measured on other screens), the switch labels (min-h-11) ' +
      'and the secondary Button primitive for paging.',
  },
  {
    name: 'person profile, moving to another cell',
    why:
      'Opens the Move dialog over the measured "person profile". Its controls are a SelectField ' +
      'and two Buttons: the select is the one measured under "add a person", where the sweep ' +
      'counts its Cell select, and the Buttons are the primitive measured on every screen.',
  },
  {
    name: 'person profile, moving to another leader',
    why:
      'Opens the Move to another leader dialog over the measured "person profile". No leader ' +
      'is chosen in this state, so its controls are the person picker\'s search field and Find ' +
      'button, measured under "add a person", which counts that same picker, and two Buttons, ' +
      'the primitive measured on every screen.',
  },
  {
    name: 'cell attendance report, how these are counted',
    why:
      'Opens the How these are counted dialog over the measured "cell attendance report", ' +
      'where the button opening it is counted. Its only control is Close, a Button.',
  },
  {
    name: 'dcc checklist, changing recorded marks',
    why:
      'The measured "dcc checklist" with its recorded mark unlocked: the same back link, radios ' +
      'and Save, plus Stop editing, a Button, and the reason field, a two-row textarea.',
  },
  {
    name: 'add a person, cell refused',
    why:
      'Its only control is "Open their record", a link carrying the Button classes and their ' +
      'min-h-11. The form it replaces is measured under "add a person".',
  },
  {
    name: 'people, with results',
    why:
      'Adds result rows and pagination controls to the measured /people state. Each row is a ' +
      'link carrying min-h-11, and the controls are the same Button primitive; the search form ' +
      'itself is measured under "people, before searching".',
  },
  {
    name: 'add a person, possible matches',
    why:
      'Adds an advisory panel to the measured "add a person" state. Its only controls are ' +
      '"Open this record" links carrying min-h-11 explicitly; every form control on the page ' +
      'is measured there.',
  },
  {
    name: 'add a person, duplicate candidates',
    why:
      'Two Buttons, which are the measured primitive, and an "Open this record" link carrying ' +
      'min-h-11 explicitly. The form it replaces is measured under "add a person".',
  },
  {
    name: 'landing',
    why: 'It renders no interactive target at all: a heading and a status line, while it redirects.',
  },
  {
    name: 'forgot-password, sent',
    why: 'Its only target is the "Back to sign in" link, measured on /forgot-password itself.',
  },
  {
    name: 'sign-in, refused',
    why: 'Same targets as /sign-in, which is measured; the refusal adds text, not controls.',
  },
  {
    name: 'session, halted',
    why:
      'Its three controls are the same Button primitive measured on /session and /sign-in — the ' +
      'two sign-out buttons are literally the /session entry\'s, and "Try again anyway" differs ' +
      'from "Try again" only in its label. The state is still axe-scanned, which is what the ' +
      'extra paragraph and the changed control name are worth checking for.',
  },
  {
    name: 'activate, link missing its token',
    why:
      'Its one control is a "request a password reset" link inside a sentence, which is exempt ' +
      'under 2.5.8\'s own inline exception. Giving it a 44px box would put a button-sized gap in ' +
      'the middle of a paragraph.',
  },
  {
    name: 'cell members, confirming a removal',
    why:
      'It renders the same controls as "cell members", which is measured, with Remove ' +
      'swapped for a confirm and a cancel of the same size. Measuring it would re-measure ' +
      'controls already covered.',
  },
  {
    name: 'cell members, none yet',
    why:
      'Its only controls are the back link and Add a member above the empty list, which ' +
      '"cell members" already measures. The state is the absence of rows.',
  },
  {
    name: 'cell meetings, changing when it meets',
    why:
      'Opens the schedule dialog over the measured "cell meetings". Its controls are the ' +
      'RadioGroup primitive measured under "record a cell meeting", a Field input measured under ' +
      '"add a person", and two Buttons, the primitive measured on every screen.',
  },
  {
    name: 'cell members, adding a member',
    why:
      'Opens the Add a member dialog over the measured "cell members". Its controls are the ' +
      'PersonPicker measured under "pastoral network" and two Buttons, the measured primitive.',
  },
  {
    name: 'people without a cell, adding to a cell',
    why:
      'Opens the dialog already exempted under "person profile, moving to another cell" over ' +
      'the measured "people without a cell": a SelectField and two Buttons.',
  },
  {
    name: 'cell attendance report, one Cell',
    why:
      'It renders the same three controls as "cell attendance report", which is measured, ' +
      'and differs only in what the report returns. Measuring it would need a second mock on ' +
      'the same URL to re-measure controls already covered.',
  },
  {
    name: 'cells, none in scope',
    why:
      'It renders the same two month controls and the same filter button as "cells", which is ' +
      'measured, and nothing else: the state is the absence of rows. Measuring it would visit ' +
      'the route a second time to re-measure three controls already covered, and would need a ' +
      'second mock on the same URL to do it.',
  },
  {
    name: 'record a cell meeting, recorded',
    why:
      'Beyond the back link its only control is "Edit this record", the same Button primitive ' +
      'measured on every screen, and its radios are disabled. The sweep installs one roster mock ' +
      'for the whole run, the unrecorded one measured under "record a cell meeting".',
  },
  {
    name: 'record a cell meeting, editing',
    why:
      'It re-enables the radios and the Save button measured under "record a cell meeting" and ' +
      'adds a full-width textarea. Measuring it would need a second roster mock on the same URL.',
  },
  {
    name: 'record a cell meeting, not held',
    why:
      'It renders the back link and no other control: the recorded reason is text, and no edit ' +
      'or Save bar is offered for a meeting recorded as did not meet.',
  },
  {
    name: 'record a cell meeting, not yet',
    why:
      'It renders the back link and no other control: a meeting whose day has not come offers ' +
      'no marks and no Save bar.',
  },
  {
    name: 'network, without figures',
    why:
      'Renders a subset of the controls measured under "network": the same search, rows and ' +
      'Show 20 more, without the Move buttons, which are the Button primitive measured elsewhere.',
  },
  {
    name: 'network, one generation down',
    why:
      'Its controls are the ones measured under "network" — row links, Open, Move, the filter — ' +
      'plus Up one level and a breadcrumb link, which are the secondary button and the ' +
      'min-h-6 min-w-6 text link measured on other screens.',
  },
  {
    name: 'dcc checklist, closed Sunday',
    why:
      'Its radios are disabled and no Save bar renders, so it offers no control beyond the back ' +
      'link that "dcc checklist" does not. Measuring it would need a second roster mock on the ' +
      'same URL.',
  },
];

test('every interactive target meets the 24px minimum', async ({ page }) => {
  // One test visits every route in `TARGET_SWEEP`, so the per-test default, which is sized
  // for one page, does not fit it: it timed out between routes while measuring nothing
  // wrong. Each settle below keeps its own expect timeout, so a route that never renders
  // still fails on that route.
  test.setTimeout(120_000);

  await mockSignedIn(page);
  await mockPeople(page);
  // The attendance screens too, because the sweep counts the targets a route
  // renders and a route showing a failure notice renders fewer of them. The
  // `minimum` on each entry is what would catch that, but only if the data is
  // there to be counted.
  await mockCells(page);
  await mockCellMeetings(page);
  await mockMeetingsAwaiting(page);
  await mockDccEvents(page);
  await mockMeetingRoster(page);
  await mockDccRoster(page);
  await mockCellReport(page);
  await mockDccReport(page);
  await mockCellMembers(page);
  await mockCoverageGaps(page);
  await mockPastoralPath(page);
  await mockNetworkTree(page);
  await mockAwaitingReassignment(page);
  await mockPeopleWithoutACell(page);
  await mockCoverageByLeader(page);

  for (const entry of TARGET_SWEEP) {
    const { route, settle, minimum } = entry;
    const settleRole = 'settleRole' in entry ? entry.settleRole : 'button';

    await page.goto(route);
    await expect(page.getByRole(settleRole, { name: settle })).toBeVisible();

    // **Then wait for every section, not just the one the settle names.** A settle
    // resolves on one element, so on a page whose sections load independently it says
    // nothing about the others, and the count below runs against whatever happened to
    // have arrived. That is green on a fast machine and red in CI, and it cost two
    // rounds on the dashboard: once counting 13 of 15, then 14 of 15 after the settle
    // was moved to a later section — which fixed one racing section and left another.
    //
    // Every pending section renders the same marker, so this waits for all of them and
    // stops the question "which section is last" from having to be answered again each
    // time one is added.
    await expect(page.locator('main').getByText('Loading…')).toHaveCount(0);

    const targets = page.locator('main button, main a[href], main input, main select, main textarea');
    const count = await targets.count();
    expect(count, `${route} renders fewer targets than it owns`).toBeGreaterThanOrEqual(minimum);

    for (let index = 0; index < count; index += 1) {
      const target = targets.nth(index);
      if (!(await target.isVisible())) {
        continue;
      }

      // Measured focused, because a target is only required to meet 2.5.8 in the
      // state it is actually offered in. A skip link is one pixel until focus
      // reaches it and 44px once it has, and measuring it hidden would report a
      // failure for the state in which nobody can activate it. For every other
      // control focus changes nothing about its box.
      await target.focus().catch(() => {});

      // **The target is what you can hit, not what you can see.** A checkbox or
      // radio wrapped in a `<label>` is activated by clicking anywhere in that
      // label, so the label is the target 2.5.8 measures. Measuring the input
      // instead reported a failure for a control that is already conformant, and
      // the obvious way to satisfy it — growing the visible dot to 24px — makes
      // the form worse to look at while changing nothing you can actually tap.
      const measured = await target.evaluate((node) => {
        const label = node.closest('label');
        const box = (label ?? node).getBoundingClientRect();
        return { width: box.width, height: box.height };
      });

      const box = measured.width > 0 || measured.height > 0 ? measured : await target.boundingBox();
      const description = await target.evaluate(
        (node) => `${node.tagName.toLowerCase()}: ${(node.textContent ?? '').trim().slice(0, 40)}`,
      );

      expect(box, `${route} — ${description} has no box`).not.toBeNull();
      expect(box!.width, `${route} — ${description} is ${box!.width}px wide`).toBeGreaterThanOrEqual(24);
      expect(box!.height, `${route} — ${description} is ${box!.height}px tall`).toBeGreaterThanOrEqual(24);
    }
  }
});

/**
 * Nothing scrolls sideways on any screen these leaders actually use.
 *
 * SKILL.md section 23 makes mobile web a **current** surface rather than
 * preparation for one. A page that scrolls horizontally is the ordinary way that
 * goes wrong, and it is invisible at desktop width — the people search shipped
 * with its search box squeezed to 107px beside two buttons, on the one control
 * the screen exists for, and every desktop check passed.
 *
 * **Five widths, chosen because each is a different state rather than a
 * different device.** Listing twenty phones would run the same layout twenty
 * times; what matters is a breakpoint, a content cap first binding, or an
 * extreme. The device names below say which real screen lands on each — they are
 * not the reason it is in the list.
 *
 * `sm` at 640 is the only breakpoint this application uses. There is no `md:`,
 * `lg:` or `xl:` utility anywhere in `web/`, so above 640 nothing rearranges and
 * the remaining widths differ only in which content cap binds.
 *
 * - **320** — the narrowest in real use, and the only width below `sm` here.
 *   Overflow is hardest at the narrowest width, so every phone from 344 (a
 *   folded Z Fold) through 360, 375, 393, 412 and 430 inherits it.
 * - **690** — the first width *above* `sm`, where stacked layouts become rows. A
 *   row that fits at 1280 can still overflow here, and no narrow test sees it.
 * - **768** — `PAGE_WIDTH.READING` exactly: the width at which a form stops
 *   growing, still filling the viewport edge to edge. An iPad mini portrait.
 * - **820** — the first width at which `READING` is capped *and centred, with
 *   margin on both sides*, which is a layout 768 does not produce. A standard
 *   iPad portrait lands here.
 * - **1024** — `PAGE_WIDTH.INDEX` exactly, so the list screens stop growing too:
 *   the narrowest laptop, an iPad landscape, an iPad Pro 12.9 portrait. **The
 *   width the sidebar first appears at**, and 1440 is where the content column
 *   beside it stops growing — so 1512, 1920 and a 4K panel all render what 1440
 *   renders, with more margin.
 */
const VIEWPORT_WIDTHS = [
  { name: '320px, the narrowest phone in use', width: 320, height: 568, crossBrowser: true },
  { name: '690px, a foldable opened out', width: 690, height: 829 },
  { name: '768px, where READING stops growing', width: 768, height: 1024 },
  { name: '820px, where READING first centres', width: 820, height: 1180 },
  // **The narrowest laptop, an iPad landscape, an iPad Pro 12.9 portrait — and
  // the width the sidebar first appears at.** Tailwind's `lg` is 1024px, so this
  // is the *narrowest* width of the two-column layout rather than the last width
  // at which anything can break. It was the latter until the sidebar landed, and
  // `scripts/check-breakpoints.mjs` is what refused to let that sentence stand
  // unexamined.
  { name: '1024px, a laptop or an iPad landscape', width: 1024, height: 768, crossBrowser: true },
  // **Where the content column stops growing beside the sidebar, and therefore
  // the new last width at which anything can break.** At 1024 the sidebar takes
  // 240px and the content is squeezed below `PAGE_WIDTH.INDEX`; by 1440 it has
  // reached that constraint and a wider display adds margin rather than
  // rearranging anything — so 1512, 1920 and a 4K panel all render what this
  // renders. Scanning only 1024 would have left every real laptop and desktop
  // covered by an argument that had stopped being true.
  {
    name: '1440px, the sidebar with the content column at full width',
    width: 1440,
    height: 900,
    crossBrowser: true,
  },
];

/**
 * **`crossBrowser` is what the `webkit` project selects on.**
 *
 * The widths above are an argument about layout, and layout is only half of what
 * a browser decides. iOS forces WebKit on every browser it hosts, so Chrome on an
 * iPhone is WebKit and a Chromium-only suite says nothing about any iPhone --
 * which is most of the device list this application is sized for. Edge needs no
 * project of its own, being Chromium.
 *
 * Two widths rather than five, because a second engine over every width roughly
 * doubles a job the harness comment says must stay fast enough that nobody skips
 * it. These two are the ones that bind: overflow is hardest at the narrowest
 * width, and 1024 is the last width at which anything changes. The gap is an
 * engine difference appearing at neither end, which is possible and is accepted.
 *
 * The flag lives here rather than as a title match in the config, so rewording a
 * viewport's name cannot silently leave WebKit scanning nothing.
 */
const CROSS_BROWSER_TAG = '@cross-browser';

/**
 * The tag is the whole of what the `webkit` project selects on, so it needs
 * something that fails when it goes missing.
 *
 * Removing it from every width no longer compiles, because nothing then declares
 * the property. Removing it from *one* does compile, and leaves WebKit quietly
 * scanning the other -- a browser project that scans half of what it claims
 * reports the same green as one that scanned all of it. This case carries the tag
 * itself, so it is among the tests WebKit still runs, and it goes red.
 *
 * It asserts the property rather than a count: the narrowest width, where
 * overflow is hardest, and the widest at which anything changes. A width added in
 * between leaves it green, which is correct -- widening the cross-browser set is a
 * decision, and only the two ends are load-bearing.
 *
 * **It went red when the sidebar landed, which is the case it was written for.**
 * 1440 was added as the new widest and the tag stayed on 1024, so WebKit would
 * have gone on scanning a width that had stopped being the end of anything.
 *
 * **1024 keeps the tag as well, and that is the decision this comment means.**
 * It is an iPad in landscape, iOS permits no engine but WebKit, and it is now the
 * width the sidebar first appears at -- a layout transition on a device whose only
 * engine is the one Chromium cannot speak for. Three tagged widths rather than
 * two, argued rather than inherited.
 */
test('the cross-browser widths are the narrowest and the widest', { tag: [CROSS_BROWSER_TAG] }, () => {
  const widths = VIEWPORT_WIDTHS.map((viewport) => viewport.width);
  const tagged = VIEWPORT_WIDTHS.filter((viewport) => viewport.crossBrowser).map(
    (viewport) => viewport.width,
  );

  expect(
    tagged,
    'the narrowest width is not tagged, so WebKit never scans the width where overflow is hardest',
  ).toContain(Math.min(...widths));

  expect(
    tagged,
    'the widest width is not tagged, so WebKit never scans the last width at which anything changes',
  ).toContain(Math.max(...widths));
});

for (const viewport of VIEWPORT_WIDTHS) {
  const tag = viewport.crossBrowser ? [CROSS_BROWSER_TAG] : [];

  test.describe(`at ${viewport.name}`, { tag }, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    for (const scan of SCANS) {
      test(`${scan.name} does not scroll sideways`, async ({ page }) => {
        if ('before' in scan && scan.before) {
          await scan.before(page);
        }

        await page.goto(scan.route);

        if ('arrange' in scan && scan.arrange) {
          await scan.arrange(page);
        }

        const { scrollWidth, clientWidth, widest } = await page.evaluate(() => {
          const root = document.documentElement;
          // Name the widest offender, so a failure says which element to fix
          // rather than only that something overflows.
          let widest = '';
          let max = 0;
          for (const node of Array.from(document.querySelectorAll('body *'))) {
            const right = node.getBoundingClientRect().right;
            if (right > max) {
              max = right;
              widest = `${node.tagName.toLowerCase()}.${String(node.className).slice(0, 40)}`;
            }
          }
          return { scrollWidth: root.scrollWidth, clientWidth: root.clientWidth, widest };
        });

        expect(
          scrollWidth,
          `${scan.name} overflows ${scrollWidth - clientWidth}px past ${viewport.width}px; widest element is ${widest}`,
        ).toBeLessThanOrEqual(clientWidth);
      });
    }
  });
}

/**
 * The skip link, measured on its own because it is the one target that lives
 * outside `<main>` and the one whose size depends on being focused.
 *
 * It is `sr-only` until focus reaches it. Every visual class sits behind
 * `focus:` deliberately: a padding utility written outside the variant overrides
 * `sr-only`'s `padding: 0` while the clip stays, which left an 18px box in the
 * layout rather than a hidden one. That is what this pins.
 */
/**
 * Exactly one navigation entry is the current page.
 *
 * **axe cannot see this, and that is why it is a test of its own.** Two links each
 * carrying `aria-current="page"` is valid markup — the attribute is not required to
 * be unique — so every automated rule passes while a screen reader announces two
 * current pages and the eye sees two highlighted entries.
 *
 * The state that produced it: Network was `/people/{id}/network` and People is
 * `/people`, so a prefix test marked both. It is asserted by *count* rather than by
 * naming People, so a third entry nested under an existing one fails here rather
 * than being noticed by eye.
 *
 * **That collision is gone and this case is kept anyway.** Network moved to `/network`
 * on 2026-09-17 and nests under nothing, so what it guards now is the count itself,
 * on the entry most likely to be given a nested address again. The live nesting is
 * `/cells/{id}/meetings`, which the case below owns.
 *
 * *The docblock said the link is clicked rather than typed "because Network is the one
 * entry whose href depends on who is signed in". It no longer does — the entry is a
 * constant — so the click is kept for a different and smaller reason: it asserts the
 * sidebar sends you where this case then measures.*
 *
 * *The entry was labelled My Network until decision 0245 renamed it.*
 */
test('only the most specific navigation entry is marked as the current page', async ({ page }) => {
  await mockSignedIn(page);
  await mockPeople(page);
  await mockPastoralPath(page);
  await mockNetworkTree(page);

  await page.goto('/people');

  const navigation = page.getByRole('navigation', { name: 'Main' });
  await navigation.getByRole('link', { name: 'Network', exact: true }).click();

  await expect(page).toHaveURL(/\/network$/);

  const current = navigation.locator('a[aria-current="page"]');

  await expect(current, 'more than one navigation entry claims to be the current page').toHaveCount(
    1,
  );
  await expect(current).toHaveText('Network');
});

/**
 * One person's pastoral path marks People, not Network.
 *
 * **The deliberate half of moving Network to its own address.** `/people/{id}/network`
 * is a page about one person and keeps living under `/people`, so the entry that owns
 * that address claims it — which is a behaviour change rather than a consequence
 * anybody would infer, and is therefore pinned rather than described. Asserted by count
 * as well, because the risk it inherits is two entries claiming one page.
 */
test('one person’s pastoral path marks People as the current page', async ({ page }) => {
  await mockSignedIn(page);
  await mockPeople(page);
  await mockPastoralPath(page);

  await page.goto('/people/3f1b7c6e-0000-4000-8000-000000000601/network');
  await expect(page.getByRole('heading', { name: 'Corazon Villanueva' })).toBeVisible();

  const navigation = page.getByRole('navigation', { name: 'Main' });
  const current = navigation.locator('a[aria-current="page"]');

  await expect(current, 'more than one navigation entry claims to be the current page').toHaveCount(
    1,
  );
  await expect(current).toHaveText('People');
});

/**
 * A Cell's meeting screens mark Record, not Cells.
 *
 * **The address says Cells and the ruling says Record** (decision 0245): a meeting
 * screen is recording, whichever entry a leader reached it from. A prefix test alone
 * marks Cells, because `/cells/{id}/meetings` begins with `/cells`, so this is the
 * case that fails if the pattern owning these screens is ever lost.
 */
test('a Cell meeting screen marks Record as the current page, not Cells', async ({ page }) => {
  await mockSignedIn(page);
  await mockCellMeetings(page);

  await page.goto('/cells/3f1b7c6e-0000-4000-8000-000000000101/meetings');
  await expect(page.getByRole('heading', { name: 'Cell C-0007' })).toBeVisible();

  const navigation = page.getByRole('navigation', { name: 'Main' });
  const current = navigation.locator('a[aria-current="page"]');

  await expect(current, 'more than one navigation entry claims to be the current page').toHaveCount(
    1,
  );
  await expect(current).toHaveText('Record');
});

/**
 * A reader without a whole-church reporting grant sees Record first.
 *
 * The shared fixture reads reports over one Network, which is not Whole Church, so this
 * is the leader arrangement of decision 0245. It is pinned beside the whole-church case
 * below so that the two arrangements are asserted as a pair and cannot quietly converge.
 */
test('a reader without a whole-church grant sees Record first', async ({ page }) => {
  await mockSignedIn(page);
  await mockPeople(page);

  await page.goto('/people');

  const navigation = page.getByRole('navigation', { name: 'Main' });

  await expect(navigation.getByRole('link')).toHaveText([
    'Record',
    'Reports',
    'People',
    'Cells',
    'Network',
  ]);
});

/**
 * A whole-church reader sees Reports first, and Reports opens on the DCC figures.
 *
 * **Nothing else reaches this arrangement.** Before `mockWholeChurchReader` existed the
 * only account in the suite read reports over one Network, so the order decision 0245
 * gives the two Senior Pastors and Admin, and where their Reports item leads, were
 * untested. Where they *land* is a separate question with its own cases below.
 * The href is asserted separately from the order: a report that moved would otherwise
 * pass as long as the labels stayed put.
 */
test('a whole-church reader sees Reports first, opening on the DCC figures', async ({ page }) => {
  await mockSignedIn(page);
  await mockWholeChurchReader(page);
  await mockPeople(page);

  await page.goto('/people');

  const navigation = page.getByRole('navigation', { name: 'Main' });

  await expect(navigation.getByRole('link')).toHaveText([
    'Reports',
    'Record',
    'Network',
    'People',
    'Cells',
  ]);
  await expect(navigation.getByRole('link', { name: 'Reports', exact: true })).toHaveAttribute(
    'href',
    '/reports/dcc',
  );
});

/**
 * The navigation renders nothing until the account is described.
 *
 * **Its arrangement depends on the account**, so rendering a guess first would move
 * links under a whole-church reader's pointer as the page loads. `/auth/me` is held
 * here until the shell is on screen, which is the window a slow phone lives in: the
 * footer's account link is there, and no navigation landmark is. Releasing the answer
 * then brings the whole arrangement in at once.
 */
test('the navigation renders nothing until the account is described', async ({ page }) => {
  await mockSignedIn(page);
  await mockPeople(page);

  let answer = () => {};
  const described = new Promise<void>((resolve) => {
    answer = resolve;
  });

  await page.route('**/api/v1/auth/me', async (route) => {
    await described;
    await route.fallback();
  });

  await page.goto('/people');

  await expect(page.getByRole('link', { name: 'Account and session' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0);

  answer();

  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link')).toHaveCount(5);
});

/**
 * The home page lands a whole-church reader on Reports, which opens on the DCC figures.
 *
 * **Asserted on the address, not on the navigation.** The navigation reads the Reports
 * path directly and never asks where to land, so a case on its links cannot notice the
 * landing rule going wrong. The home page and sign-in both ask `resolveLanding`, and
 * this is the one of the two that needs no credentials typed.
 */
test('the home page lands a whole-church reader on Reports', async ({ page }) => {
  await mockSignedIn(page);
  await mockWholeChurchReader(page);
  await mockDccReport(page);

  await page.goto('/');

  await expect(page).toHaveURL(/\/reports\/dcc$/);
});

/**
 * The home page lands everyone else on Record, which is the Dashboard.
 *
 * The pair to the case above, so that a landing rule answering the same thing for
 * everybody fails one of the two whichever way it errs.
 */
test('the home page lands a reader without a whole-church grant on Record', async ({ page }) => {
  await mockSignedIn(page);

  await page.goto('/');

  await expect(page).toHaveURL(/\/dashboard$/);
});

test('the skip link is hidden until focused, and a full target once it is', async ({ page }) => {
  await page.goto('/sign-in');

  const skipLink = page.getByRole('link', { name: 'Skip to main content' });

  const hidden = await skipLink.boundingBox();
  expect(hidden, 'the skip link has no box').not.toBeNull();
  expect(hidden!.height, 'the skip link is not visually hidden before focus').toBeLessThanOrEqual(2);

  await skipLink.focus();

  const shown = await skipLink.boundingBox();
  expect(shown!.height, 'the focused skip link is below the 24px minimum').toBeGreaterThanOrEqual(24);
  expect(shown!.width, 'the focused skip link is below the 24px minimum').toBeGreaterThanOrEqual(24);
});

/**
 * The guard that keeps the 2.5.8 sweep honest.
 *
 * `SCANS` has a route walker holding it to the router's own directory. Without
 * an equivalent here, `TARGET_SWEEP` degrades into whichever states somebody
 * remembered — and a state added to `SCANS` would be scanned by axe, which
 * cannot see target size, and measured by nothing.
 */
test('every scanned state is either measured for target size or exempt with a reason', () => {
  // Keyed by the scan's name, not its route: two states share `/sign-in`, and
  // `/activate` differs from `/activate?token=…` in exactly the way that matters
  // here. A route comparison would call one of each pair covered by the other.
  const measured = new Set<string>(TARGET_SWEEP.map((entry) => entry.name));
  const exempt = new Set(TARGET_EXEMPT.map((entry) => entry.name));

  for (const scan of SCANS) {
    const covered = measured.has(scan.name) || exempt.has(scan.name);
    expect(
      covered,
      `"${scan.name}" (${scan.route}) is scanned by axe but neither measured for WCAG 2.5.8 ` +
        `nor listed in TARGET_EXEMPT with a reason.`,
    ).toBe(true);
  }

  // An exemption for a state that no longer exists is a reason nobody can check.
  for (const entry of TARGET_EXEMPT) {
    expect(
      SCANS.some((scan) => scan.name === entry.name),
      `TARGET_EXEMPT lists "${entry.name}", which is not a scanned state.`,
    ).toBe(true);
  }
});

/**
 * The guard that keeps "every route" true.
 *
 * Without it, adding a route adds a screen nothing scans, and the commitment
 * quietly becomes "every route somebody remembered". This reads the router's own
 * directory rather than a list, so the two cannot disagree.
 */
test('every route in the app directory is scanned', async () => {
  // `__dirname` rather than `import.meta.url`: Playwright transpiles a spec to
  // CommonJS, where `import.meta` is a syntax error and the whole file silently
  // fails to load as "no tests found".
  const appDirectory = resolve(__dirname, '..', 'app');

  async function routesUnder(directory: string, prefix: string): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true });
    const found: string[] = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        // A route group `(name)` organises files without appearing in the URL.
        const segment = /^\(.*\)$/.test(entry.name) ? prefix : `${prefix}/${entry.name}`;
        found.push(...(await routesUnder(join(directory, entry.name), segment)));
        // Every extension Next resolves, not only the two this repository
        // happens to use. A `page.js` added later would otherwise emit no route,
        // fail no assertion, and never be scanned — the one way this walker can
        // fail *open*.
      } else if (/^page\.(tsx|ts|jsx|js|mjs)$/.test(entry.name)) {
        found.push(prefix === '' ? '/' : prefix);
      }
    }

    return found;
  }

  // A scan visits a concrete URL; the walker emits the router's own path, which
  // for a dynamic segment is the literal `[id]`. An entry says which pattern it
  // stands for — otherwise every dynamic route reads as unscanned and the guard
  // cries wolf until somebody silences it.
  //
  // **The pattern is checked against the route rather than believed.** Free text
  // compared against nothing reintroduces the hole this walker exists to close,
  // one indirection out: an entry claiming `pattern: '/people/[id]'` while
  // visiting `/people` would mark the dynamic route covered by a scan that never
  // loads it. A pattern must match its own route segment for segment, with
  // `[…]` matching any single segment.
  const declared = new Set<string>();
  for (const scan of SCANS) {
    const path = scan.route.split('?')[0];
    const pattern = 'pattern' in scan && scan.pattern ? scan.pattern : path;

    const patternSegments = pattern.split('/');
    const pathSegments = path.split('/');

    expect(
      patternSegments.length,
      `"${scan.name}" declares pattern ${pattern}, which has a different number of segments from the route it visits (${path}).`,
    ).toBe(pathSegments.length);

    patternSegments.forEach((segment, index) => {
      if (/^\[.+\]$/.test(segment)) {
        expect(
          pathSegments[index].length,
          `"${scan.name}" declares a dynamic segment ${segment} but visits an empty one.`,
        ).toBeGreaterThan(0);
        return;
      }

      expect(
        pathSegments[index],
        `"${scan.name}" declares pattern ${pattern}, which does not match the route it visits (${path}).`,
      ).toBe(segment);
    });

    declared.add(pattern);
  }

  const actual = await routesUnder(appDirectory, '');

  expect(actual.length).toBeGreaterThan(0);
  for (const route of actual) {
    expect(
      declared.has(route),
      `${route} is a route and is not in SCANS, so axe never sees it. ` +
        `CLAUDE.md commits to axe-core over every route.`,
    ).toBe(true);
  }
});
