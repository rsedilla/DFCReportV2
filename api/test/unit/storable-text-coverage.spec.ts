import 'reflect-metadata';

import { readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

/**
 * Every field that accepts arbitrary text refuses text a `text` column cannot keep
 * (SKILL.md section 22; decision 0198).
 *
 * **The rule had nothing that could fail on it, and that is how it shipped covering two of
 * three fields on its own route while its docblock claimed all of them.** Section 22 names
 * `INTERNAL_ERROR` on a well-formed request as a failure mode and says nothing about what a
 * free-text field may contain, so `@IsStorableText` was applied route by route, from memory.
 *
 * **The check derives which fields it applies to rather than listing them**, which is what
 * makes it catch a field added next year. For every property of every DTO: if the property
 * accepts a harmless string, it accepts arbitrary text, and it must then refuse a null byte
 * and an unpaired surrogate. A UUID, a date, an enum and a bounded number all refuse the
 * harmless string first and are skipped without being named.
 *
 * A property is exempt only by appearing in `NEVER_STORED` with a reason, and the reason is
 * always the same shape: the value never reaches a `text` column as written.
 */
describe('storable text is refused at the edge, on every field that takes text', () => {
  /**
   * Fields that accept arbitrary text and are exempt, each because the value never reaches
   * a column as written.
   *
   * `cursor` is opaque and is decoded before anything reads it — a cursor that cannot be
   * resolved is refused (decision 0159), so a null byte inside one is a refused cursor
   * rather than a stored character. `refresh_token` and `token` are compared against a
   * hash and never stored in the form they arrive in. `password` likewise, and section 6
   * is explicit that it is never stored at all.
   */
  const NEVER_STORED = new Set([
    'DccRosterDto.cursor',
    'LeadershipRequestQueueDto.cursor',
    'CellMembersDto.cursor',
    'SearchPeopleDto.cursor',
    'RefreshDto.refresh_token',
    'LogoutDto.refresh_token',
    'LoginDto.password',
    'SetPasswordDto.password',
    'SetPasswordDto.token',
  ]);

  const HARMLESS = 'harmless';
  const WITH_NUL = `a${String.fromCharCode(0)}b`;
  const WITH_LONE_SURROGATE = 'a\uD800b';

  /** Every `*.dto.ts` under `src`, so a new DTO file is covered by existing. */
  function dtoFiles(dir: string): string[] {
    const found: string[] = [];

    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);

      if (statSync(path).isDirectory()) {
        found.push(...dtoFiles(path));
      } else if (entry.endsWith('.dto.ts')) {
        found.push(path);
      }
    }

    return found;
  }

  /** Whether validating `value` under `property` produces an error naming that property. */
  async function refusesValue(
    cls: new () => object,
    property: string,
    value: unknown,
  ): Promise<boolean> {
    const instance = plainToInstance(cls, { [property]: value });
    const errors = await validate(instance as object);

    return errors.some((error) => error.property === property);
  }

  const refuses = (cls: new () => object, property: string, value: string): Promise<boolean> =>
    refusesValue(cls, property, value);

  const classes: { name: string; cls: new () => object; properties: string[] }[] = [];

  beforeAll(() => {
    const root = resolve(__dirname, '../../src');

    for (const file of dtoFiles(root)) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const module_ = require(file) as Record<string, unknown>;

      for (const [name, exported] of Object.entries(module_)) {
        if (typeof exported !== 'function' || !/^[A-Z]/.test(name)) {
          continue;
        }

        let declared: string[] = [];
        try {
          declared = Object.getOwnPropertyNames(new (exported as new () => object)());
        } catch {
          // Not a bare-constructible DTO; its property names still arrive from the
          // validation errors an empty object produces.
        }

        const properties = Object.keys(plainToInstance(exported as new () => object, {}) ?? {});
        const all = Array.from(new Set([...properties, ...declared]));
        classes.push({ name, cls: exported as new () => object, properties: all });
      }
    }
  });

  it('finds the DTO classes to check, so an empty run cannot pass', () => {
    expect(classes.length).toBeGreaterThan(5);
  });

  it('refuses a null byte and a lone surrogate wherever arbitrary text is accepted', async () => {
    const uncovered: string[] = [];
    const covered: string[] = [];

    for (const { name, cls, properties } of classes) {
      // A property list taken from an instance is empty for a class whose fields are only
      // declared, so the property names are recovered from the validation errors an empty
      // object produces as well.
      const empty = await validate(plainToInstance(cls, {}) as object);
      const candidates = Array.from(new Set([...properties, ...empty.map((e) => e.property)]));

      for (const property of candidates) {
        // **Two questions, not one.** A property that accepts a harmless string might do so
        // because it is free text, or because its validation is conditional on a sibling
        // field this check does not set — `CreateLeadershipRequestDto.day_of_week` is a
        // number and accepts anything while `kind` is absent. A genuine `@IsString()` field
        // refuses a number; a skipped one accepts that too. So both answers are required.
        const acceptsText =
          !(await refuses(cls, property, HARMLESS)) && (await refusesValue(cls, property, 12345));

        if (!acceptsText) {
          continue;
        }

        const key = `${name}.${property}`;

        if (NEVER_STORED.has(key)) {
          continue;
        }

        const refusesNul = await refuses(cls, property, WITH_NUL);
        const refusesSurrogate = await refuses(cls, property, WITH_LONE_SURROGATE);

        if (refusesNul && refusesSurrogate) {
          covered.push(key);
        } else {
          uncovered.push(key);
        }
      }
    }

    // Named in the failure rather than counted, because the useful thing on a red run is
    // which field was added without the decorator.
    expect(uncovered).toEqual([]);

    // And the run reached something: a check that skipped every property would otherwise
    // pass with an empty `uncovered`, which is the shape this whole file exists to refuse.
    expect(covered.length).toBeGreaterThan(10);
  });
});
