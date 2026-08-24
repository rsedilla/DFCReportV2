import { isNamedSeniorPastor } from '../../src/auth/authorization/senior-pastors';
import {
  loadConfig,
  seniorPastorsUnnamedWarning,
  type AppConfig,
} from '../../src/config/configuration';

/**
 * Who may hold `SENIOR_PASTOR`, and where the answer comes from (SKILL.md
 * section 7).
 *
 * These need no database **server** — they read configuration and compare two
 * strings — but they are not therefore free of `DATABASE_URL`: the shared harness
 * throws without it before any suite loads, and `loadConfig` requires it too. A
 * dummy value satisfies both.
 *
 * The identifiers below are invented (CLAUDE.md, Secrets). They are not the real
 * Senior Pastors' Person ids, which do not exist in this repository and never
 * will — that is the point of reading them from the environment.
 */
describe('the two Persons section 4 names (section 7)', () => {
  const OLIVE = '11111111-2222-4333-8444-555555555555';
  const GRACE = '66666666-7777-4888-8999-aaaaaaaaaaaa';

  describe('SENIOR_PASTOR_PERSON_IDS', () => {
    const original = process.env.SENIOR_PASTOR_PERSON_IDS;

    function load(value: string | undefined): string[] {
      if (value === undefined) {
        delete process.env.SENIOR_PASTOR_PERSON_IDS;
      } else {
        process.env.SENIOR_PASTOR_PERSON_IDS = value;
      }
      return loadConfig().seniorPastorPersonIds;
    }

    afterEach(() => {
      if (original === undefined) {
        delete process.env.SENIOR_PASTOR_PERSON_IDS;
      } else {
        process.env.SENIOR_PASTOR_PERSON_IDS = original;
      }
    });

    it('is empty when unset or blank, and the process still starts', () => {
      // **Absent is legitimate and must not be fatal.** A fresh installation has
      // to boot and run the initial import (section 2) before either Person exists
      // to be named. Empty means the check fails closed, which is what the
      // application-level cases pin.
      expect(load(undefined)).toEqual([]);
      expect(load('')).toEqual([]);
      expect(load('   ')).toEqual([]);
    });

    it('refuses a value that is present and names nobody', () => {
      // **A bare separator is not blank, and the difference is the whole rule.** It
      // is what a deployment template renders for an empty list, and unlike a
      // missing value it *looks* configured — so treating it as absent would strip
      // both Senior Pastors of their authority with nothing for a reviewer to see.
      //
      // Found by `architecture-guardian`: section 7 said any value that is not one
      // or two well-formed identifiers stops the process, and this one booted.
      expect(() => load(',')).toThrow(/names nobody/);
      expect(() => load('  ,  ')).toThrow(/names nobody/);
    });

    it('accepts one or two, and canonicalizes them', () => {
      expect(load(OLIVE)).toEqual([OLIVE]);
      expect(load(` ${OLIVE} , ${GRACE} `)).toEqual([OLIVE, GRACE]);

      // Uppercase is ordinary: `UUID().uuidString` on iOS produces it, and so does
      // copying an identifier out of a query result in some clients. A `uuid`
      // column compares case-insensitively and JavaScript does not, so a value
      // left as typed would name nobody while looking as though it named somebody.
      expect(load(OLIVE.toUpperCase())).toEqual([OLIVE]);
    });

    it('refuses more than the two seats section 7 states', () => {
      expect(() => load(`${OLIVE},${GRACE},${OLIVE.replace('1111', '9999')}`)).toThrow(/caps/);
    });

    it('refuses a value that is not a Person id', () => {
      // **Malformed stops the process, where absent does not.** A typo strips both
      // Senior Pastors of their authority exactly as silently as a missing value,
      // and unlike a missing value it looks configured — so it is the failure this
      // arrangement is likeliest to produce and the one that would be noticed last.
      expect(() => load('Bishop Oriel Ballano')).toThrow(/Person ids/);
      expect(() => load(`${OLIVE},not-a-uuid`)).toThrow(/Person ids/);
      expect(() => load(OLIVE.slice(0, -1))).toThrow(/Person ids/);
    });

    it('refuses the same Person twice, however each was spelled', () => {
      // Two seats and one occupant is a configuration mistake, not a succession:
      // it silently halves the church's Senior Pastors while reading as though
      // both were named.
      expect(() => load(`${OLIVE},${OLIVE}`)).toThrow(/same Person twice/);
      expect(() => load(`${OLIVE},${OLIVE.toUpperCase()}`)).toThrow(/same Person twice/);
    });
  });

  describe('the startup warning', () => {
    // Section 7 says the process says so at startup. `bootstrap()` is the one line
    // nothing reaches, so the message is a value and this is what can fail on it.
    const base = { seniorPastorPersonIds: [] } as unknown as AppConfig;

    it('says so while nobody is named', () => {
      expect(seniorPastorsUnnamedWarning(base)).toMatch(/SENIOR_PASTOR_PERSON_IDS is unset/);
    });

    it('says nothing once somebody is', () => {
      expect(seniorPastorsUnnamedWarning({ ...base, seniorPastorPersonIds: [OLIVE] })).toBeNull();
    });
  });

  describe('isNamedSeniorPastor', () => {
    it('names nobody when nobody is configured', () => {
      // The fail-closed half. Everything else in the system reads its answer from
      // here, so an empty list has to mean "no" rather than "no restriction".
      expect(isNamedSeniorPastor(OLIVE, [])).toBe(false);
    });

    it('answers on identity rather than on spelling', () => {
      // Defence in depth rather than a reachable path: configuration is
      // canonicalized when it loads, and the Person id arrives either from a
      // `uuid` column or from the boundary pipe. It is written this way because
      // this comparison decides authority and **fails open** when it answers
      // wrongly, and section 7 records that an identifier compared in TypeScript
      // rather than in SQL is the one place case survives.
      expect(isNamedSeniorPastor(OLIVE.toUpperCase(), [OLIVE])).toBe(true);
      expect(isNamedSeniorPastor(OLIVE, [OLIVE.toUpperCase()])).toBe(true);
    });

    it('does not confuse one named Person for another', () => {
      expect(isNamedSeniorPastor(OLIVE, [GRACE])).toBe(false);
      expect(isNamedSeniorPastor(OLIVE, [GRACE, OLIVE])).toBe(true);
    });
  });
});
