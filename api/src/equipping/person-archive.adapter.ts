import { Injectable } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';

import { AuditService } from '../audit/audit.service';

import type { Database } from '../database/schema';
import type { ArchiveEquippingPort } from '../people/person-archive.ports';

/**
 * `equipping`'s half of archiving and merging a Person (SKILL.md section 29, decision 0499),
 * behind `people`'s `ARCHIVE_EQUIPPING_PORT`. An archived Person keeps no open place in the
 * school: their class place ends with `ARCHIVED` and their registration is cancelled with the
 * reason "Archived", each kept and audited. A Teacher who is archived stays recorded on their
 * class as its history; who teaches after that is settled with Faculty.
 */
@Injectable()
export class PersonArchiveEquippingAdapter implements ArchiveEquippingPort {
  constructor(private readonly audit: AuditService) {}

  async closeOpenWithin(
    executor: Transaction<Database>,
    personId: string,
    actorAccountId: string,
  ): Promise<{ registrations: number; enrollments: number }> {
    // FOR NO KEY UPDATE rather than FOR UPDATE: a move or a withdrawal holds the enrollment
    // and its insert's foreign-key check takes FOR KEY SHARE on the registration, which this
    // lock does not block, so the two cannot wait on each other. Cancelling changes no key.
    const registrations = await executor
      .selectFrom('equipping_registrations')
      .select(['id', 'unmet'])
      .where('person_id', '=', personId)
      .where('cancelled_at', 'is', null)
      .orderBy('id')
      .forNoKeyUpdate()
      .execute();

    if (registrations.length === 0) {
      return { registrations: 0, enrollments: 0 };
    }

    const ids = registrations.map((row) => row.id);
    // The enrollment ends first: a registration is not cancelled while it is in a class.
    const ended = await executor
      .updateTable('equipping_enrollments')
      .set({ ended_at: sql<Date>`now()`, ended_by: actorAccountId, end_reason: 'ARCHIVED' })
      .where('registration_id', 'in', ids)
      .where('ended_at', 'is', null)
      .returning(['id', 'registration_id', 'class_id'])
      .execute();

    const classNames = new Map(
      ended.length === 0
        ? []
        : (
            await executor
              .selectFrom('equipping_classes')
              .select(['id', 'name'])
              .where(
                'id',
                'in',
                ended.map((row) => row.class_id),
              )
              .execute()
          ).map((row) => [row.id, row.name] as const),
    );

    for (const row of ended) {
      await this.audit.writeWithin(executor, {
        actorId: actorAccountId,
        action: 'equipping_enrollment.ended',
        targetType: 'person',
        targetId: personId,
        before: { enrollment_id: row.id, class_name: classNames.get(row.class_id) ?? null },
        after: { end_reason: 'ARCHIVED' },
      });
    }

    await executor
      .updateTable('equipping_registrations')
      .set({
        cancelled_at: sql<Date>`now()`,
        cancelled_by: actorAccountId,
        cancel_reason: 'Archived',
      })
      .where('id', 'in', ids)
      .execute();

    for (const row of registrations) {
      const enrolled = ended.some((each) => each.registration_id === row.id);
      await this.audit.writeWithin(executor, {
        actorId: actorAccountId,
        action: 'equipping_registration.cancelled',
        targetType: 'person',
        targetId: personId,
        before: {
          registration_id: row.id,
          status: enrolled
            ? 'ENROLLED'
            : row.unmet.length > 0
              ? 'REGISTERED_WITH_EXCEPTION'
              : 'REGISTERED',
        },
        after: { registration_id: row.id, status: 'CANCELLED', reason: 'Archived' },
      });
    }

    return { registrations: registrations.length, enrollments: ended.length };
  }

  async openRegistrationsOfWithin(
    executor: Transaction<Database>,
    personId: string,
  ): Promise<number> {
    const rows = await executor
      .selectFrom('equipping_registrations')
      .select('id')
      .where('person_id', '=', personId)
      .where('cancelled_at', 'is', null)
      .execute();

    return rows.length;
  }
}
