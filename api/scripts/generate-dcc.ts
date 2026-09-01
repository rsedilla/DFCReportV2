/**
 * Tops the DCC calendar up (SKILL.md section 9, Generating the DCC calendar).
 *
 *   npm run generate:dcc
 *
 * Idempotent, so the deployment schedules it monthly and a run that finds nothing
 * to do is normal. It creates the Sundays that have no row, from
 * `dcc_calendar_start` out to thirteen months ahead, and never touches a month
 * whose submission window has shut.
 *
 * **It prints the horizon on every run, including a run that creates nothing**, and
 * that is the point of the printing rather than a courtesy. Section 9 places this
 * obligation with the deployment's scheduler, and a command nobody runs reports
 * nothing — so the schedule's own output is what makes a lapse visible until the
 * Admin dashboard exists to carry the same date (Stage 5).
 *
 * **`ts-node`, not `tsx`, for the reason `bootstrap-admin.ts` and `import-tree.ts`
 * both record**: `tsx` compiles with esbuild, which does not implement
 * `emitDecoratorMetadata`, so Nest sees zero constructor parameters and injects
 * nothing. `DccCalendarService` takes two injected dependencies and dereferences
 * both, so the failure would be immediate rather than lucky — but the rule is the
 * same either way.
 *
 * The rules are in `src/attendance/dcc-calendar.service.ts`, because a script
 * cannot be tested and section 9 carries rules that would otherwise have nothing
 * able to fail on them. This file starts the application, calls one method, prints,
 * and chooses an exit code.
 */

import { NestFactory } from '@nestjs/core';
import 'dotenv/config';

import { AppModule } from '../src/app.module';
import { DccCalendarService } from '../src/attendance/dcc-calendar.service';

async function main(): Promise<number> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });

  try {
    const run = await app.get(DccCalendarService).generate();

    if (run.calendarStart !== null) {
      console.log(`calendar start set to ${run.calendarStart} (first run; it is not moved again)`);
    }

    console.log(
      run.created.length === 0
        ? 'created no events; the calendar was already complete'
        : `created ${run.created.length} event(s): ${run.created[0]} to ${run.created[run.created.length - 1]}`,
    );

    console.log(`horizon ${run.horizon ?? '(none)'}`);

    // **Reported, never repaired** (section 9). An event added to a month whose
    // window has shut is one no leader was able to submit against, so every leader
    // would read as having failed to record for it. What to do about it is a
    // decision somebody takes with the facts in front of them.
    if (run.closedMonthsShort.length > 0) {
      console.error(
        `\nthese closed months are short a Sunday and were NOT filled: ${run.closedMonthsShort.join(', ')}\n` +
          'A closed month is not repaired by this command: an event nobody could submit against\n' +
          'reads as every leader having failed to record for it (SKILL.md section 9). Decide what\n' +
          'to do about it deliberately.',
      );
    }

    // A short horizon is the condition the printing exists for, so it is the one
    // that changes the exit code: a scheduler that reports failures notices this
    // without anybody reading the output.
    if (run.belowFloor) {
      console.error(
        `\nthe horizon is inside section 9's twelve-month floor. Something is wrong with the\n` +
          'schedule that runs this command, or with this run.',
      );

      return 1;
    }

    return run.closedMonthsShort.length > 0 ? 1 : 0;
  } finally {
    await app.close();
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
