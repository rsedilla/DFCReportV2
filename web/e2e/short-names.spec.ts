import { expect, test } from '@playwright/test';

import { shortNames } from '../lib/names';

/**
 * The names a phone table shows where it has several figures (SKILL.md section 19, decision
 * 0451): the whole first-name field and the surname's first letter, more of the surname where
 * two would read the same, and the full name where nothing else tells them apart. A plain
 * function, so no page is opened. Names are invented.
 */
const person = (first: string, middle: string, last: string) => ({
  full_name: `${first}${middle ? ` ${middle}.` : ''} ${last}`,
  first_name: first,
  last_name: last,
});

test('keeps the whole first-name field, leaves out the middle name, and takes the surname’s first letter', () => {
  expect(
    shortNames([
      person('John Andrew', 'E', 'Santos'),
      person('John Andrew Peter', 'E', 'Santos'),
      person('Dia Gracia', 'E', 'Enguerra'),
      person('Kim', 'M', 'Baraquel'),
    ]),
  ).toEqual(['John Andrew S.', 'John Andrew Peter S.', 'Dia Gracia E.', 'Kim B.']);
});

test('takes more of the surname until two who would read the same differ', () => {
  expect(
    shortNames([
      person('John Andrew', 'E', 'Santos'),
      person('John Andrew', 'M', 'Sotto'),
      person('Maria', '', 'Sanchez'),
      person('Maria', '', 'Santiago'),
    ]),
  ).toEqual(['John Andrew Sa.', 'John Andrew So.', 'Maria Sanc.', 'Maria Sant.']);
});

test('reads a two-word surname from its field, never from a split of the full name', () => {
  expect(shortNames([person('Juan', '', 'Dela Cruz')])).toEqual(['Juan D.']);
});

test('keeps the full names of two alike to the whole surname', () => {
  expect(
    shortNames([person('Ana', 'L', 'Reyes'), person('Ana', 'M', 'Reyes')]),
  ).toEqual(['Ana L. Reyes', 'Ana M. Reyes']);
});

test('keeps the full name of somebody sent without the parts, and nothing for nobody', () => {
  expect(
    shortNames([{ full_name: 'Teofilo Ramos' }, { full_name: null }, person('Ana', '', 'Lim')]),
  ).toEqual(['Teofilo Ramos', null, 'Ana L.']);
});

test('never stops on the space inside a two-word surname', () => {
  expect(shortNames([person('Ana', '', 'De Leon'), person('Ana', '', 'Del Rosario')])).toEqual([
    'Ana De L.',
    'Ana Del.',
  ]);
});

test('gives both whole surnames where one surname begins the other', () => {
  expect(shortNames([person('John', '', 'Santo'), person('John', '', 'Santos')])).toEqual([
    'John Santo',
    'John Santos',
  ]);
});
