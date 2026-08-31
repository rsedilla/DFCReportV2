import { Module } from '@nestjs/common';

import { DccCalendarService } from './dcc-calendar.service';

/**
 * Owns `dcc_events`, `dcc_attendance`, `cell_meetings`, `cell_attendance` and
 * `cell_meeting_changes` (SKILL.md section 2, Modules).
 *
 * No other module writes those tables, and no other module reaches them for
 * anything this module's services can answer. That is what gives the section 13
 * and section 14 rules one home — the submission window, the meeting statuses, the
 * append-only correction, and the two version units — rather than four.
 */
@Module({
  providers: [DccCalendarService],
  exports: [DccCalendarService],
})
export class AttendanceModule {}
