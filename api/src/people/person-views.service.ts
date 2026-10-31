import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { sql } from 'kysely';

import { unresolvableCursor } from '../common/cursor';
import { isUuid } from '../common/identifiers';
import { DATABASE, type Db } from '../database/database.module';
import { EMAIL_PORT, type EmailPort } from '../email/email.port';
import { HierarchyService } from '../hierarchy/hierarchy.service';

import { ADMIN_ACCOUNTS_PORT, type AdminAccountsPort } from './admin-accounts.port';
import { composeName } from './people.shared';

/** A second opening of one page by one person within this is the same opening (decision 0414). */
const SAME_OPENING = sql`interval '10 minutes'`;
/** How long a row is kept (owner, 2026-11-01). */
const KEEP = sql`interval '1 year'`;
/** More person pages than this opened by one person in an hour tells the Admin (owner, 2026-11-01). */
export const PAGES_IN_AN_HOUR = 100;
/** The alert's caps, as decision 0413 caps the sign-in alert. */
const ALERTS_PER_DAY = 20;
const MANILA_TODAY = sql`(date_trunc('day', now() AT TIME ZONE 'Asia/Manila') AT TIME ZONE 'Asia/Manila')`;

/**
 * Where a page of openings ends: the last row's instant and viewer, opaque to the client. The
 * instant is PostgreSQL's own, to the microsecond, as `leadership-request-cursor.ts` keeps its
 * key: a JavaScript `Date` holds milliseconds, and a row inside the millisecond a page ended on
 * would sort after it and fail the comparison, appearing on no page.
 */
interface ViewsCursor {
  /** `YYYY-MM-DDTHH:MM:SS.ffffff`, UTC. */
  at: string;
  viewer: string;
}

const MICROSECOND_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}$/;

export function encodeViewsCursor(cursor: ViewsCursor): string {
  return Buffer.from(JSON.stringify([cursor.at, cursor.viewer])).toString('base64url');
}

/** Refuses a cursor it cannot read (section 22, decision 0159). */
export function decodeViewsCursor(raw: string): ViewsCursor {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      typeof parsed[0] === 'string' &&
      typeof parsed[1] === 'string'
    ) {
      const at = parsed[0];
      const asDate = new Date(`${at.slice(0, 23)}Z`);
      if (
        MICROSECOND_INSTANT.test(at) &&
        !Number.isNaN(asDate.getTime()) &&
        // 30 February would roll into March in JavaScript and be refused by PostgreSQL.
        asDate.toISOString().slice(0, 23) === at.slice(0, 23) &&
        asDate.getUTCFullYear() >= 1 &&
        isUuid(parsed[1])
      ) {
        return { at, viewer: parsed[1] };
      }
    }
  } catch {
    // Falls through to the refusal.
  }
  throw unresolvableCursor();
}

export interface PersonView {
  viewer: { person_id: string; full_name: string };
  /** `PASTORAL_LEADER` where the viewer is the person's pastoral leader now, else null. */
  relation: 'PASTORAL_LEADER' | null;
  viewed_at: string;
}

/**
 * Who opened or looked up a person's record (SKILL.md sections 7, 8 and 21, decision 0414).
 *
 * **Every read of `GET /people/{id}` for somebody else is recorded**, whichever screen asked;
 * a second read of one record by one person within ten minutes is the same one. A failure to
 * record is logged and never fails the read. It reads and writes only `people`'s own tables,
 * names viewers from `persons`, and reaches the Admin's email addresses through
 * `ADMIN_ACCOUNTS_PORT`, because `auth` owns accounts and imports this module.
 */
@Injectable()
export class PersonViewsService {
  private readonly logger = new Logger(PersonViewsService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Db,
    private readonly hierarchy: HierarchyService,
    @Inject(EMAIL_PORT) private readonly email: EmailPort,
    // Optional and refusing, as `PeopleReadService` takes it (decision 0181).
    @Optional()
    @Inject(ADMIN_ACCOUNTS_PORT)
    private readonly adminAccounts: AdminAccountsPort | null,
  ) {}

  /**
   * Records that the viewer read the person's full record, and tells the Admin past the hour's
   * limit. Nothing is recorded for one's own record (owner, 2026-11-01).
   */
  async record(personId: string, viewerPersonId: string): Promise<void> {
    if (personId.toLowerCase() === viewerPersonId.toLowerCase()) {
      return;
    }
    try {
      await this.db
        .deleteFrom('person_views')
        .where(sql<boolean>`viewed_at < now() - ${KEEP}`)
        .execute();

      const inserted = await this.db
        .insertInto('person_views')
        .columns(['person_id', 'viewer_person_id'])
        .expression(
          this.db
            .selectNoFrom([
              sql<string>`${personId}::uuid`.as('person_id'),
              sql<string>`${viewerPersonId}::uuid`.as('viewer_person_id'),
            ])
            .where((eb) =>
              eb.not(
                eb.exists(
                  eb
                    .selectFrom('person_views')
                    .select(sql`1`.as('one'))
                    .where('person_id', '=', personId)
                    .where('viewer_person_id', '=', viewerPersonId)
                    .where(sql<boolean>`viewed_at > now() - ${SAME_OPENING}`),
                ),
              ),
            ),
        )
        .executeTakeFirst();

      if (Number(inserted.numInsertedOrUpdatedRows ?? 0) > 0) {
        await this.alertIfMany(viewerPersonId);
      }
    } catch (error) {
      this.logger.error(
        `Could not record that person ${viewerPersonId} opened person ${personId}.`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  /** The openings of one person's page, newest first, a page at a time. */
  async listFor(
    personId: string,
    limit: number,
    after: ViewsCursor | null,
  ): Promise<{ data: PersonView[]; next_cursor: string | null }> {
    const rows = await this.db
      .selectFrom('person_views as view')
      .innerJoin('persons as viewer', 'viewer.id', 'view.viewer_person_id')
      .select([
        'view.viewer_person_id',
        'view.viewed_at',
        sql<string>`to_char(view.viewed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')`.as(
          'viewed_key',
        ),
        'viewer.title',
        'viewer.first_name',
        'viewer.middle_name',
        'viewer.last_name',
      ])
      .where('view.person_id', '=', personId)
      .where(sql<boolean>`view.viewed_at > now() - ${KEEP}`)
      .$if(after !== null, (query) =>
        query.where(
          sql<boolean>`(view.viewed_at, view.viewer_person_id) < ((${(after as ViewsCursor).at}::timestamp AT TIME ZONE 'UTC'), ${(after as ViewsCursor).viewer}::uuid)`,
        ),
      )
      .orderBy('view.viewed_at', 'desc')
      .orderBy('view.viewer_person_id', 'desc')
      .limit(limit + 1)
      .execute();

    const page = rows.slice(0, limit);
    const leader = (await this.hierarchy.openAssignmentOf(this.db, personId))?.leaderId ?? null;

    return {
      data: page.map((row) => ({
        viewer: { person_id: row.viewer_person_id, full_name: composeName(row) },
        relation: row.viewer_person_id === leader ? 'PASTORAL_LEADER' : null,
        viewed_at: row.viewed_at.toISOString(),
      })),
      next_cursor:
        rows.length > limit
          ? encodeViewsCursor({
              at: page[page.length - 1].viewed_key,
              viewer: page[page.length - 1].viewer_person_id,
            })
          : null,
    };
  }

  /**
   * Past a hundred distinct pages in the last hour, the Admin is emailed: at most once a day
   * for one viewer and twenty times a day in all, under an advisory lock so two openings at
   * once cannot both send the twenty-first.
   */
  private async alertIfMany(viewerPersonId: string): Promise<void> {
    const opened = await this.db
      .selectFrom('person_views')
      .select(sql<number>`count(DISTINCT person_id)::int`.as('pages'))
      .where('viewer_person_id', '=', viewerPersonId)
      .where(sql<boolean>`viewed_at > now() - interval '1 hour'`)
      .executeTakeFirstOrThrow();
    if (opened.pages <= PAGES_IN_AN_HOUR) {
      return;
    }

    const send = await this.db.transaction().execute(async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext('person_view_alerts'))`.execute(trx);
      await trx
        .deleteFrom('person_view_alerts')
        .where(sql<boolean>`sent_at < now() - interval '2 days'`)
        .execute();
      const today = await trx
        .selectFrom('person_view_alerts')
        .select([
          sql<number>`count(*)::int`.as('all'),
          sql<number>`count(*) FILTER (WHERE viewer_person_id = ${viewerPersonId})::int`.as('mine'),
        ])
        .where(sql<boolean>`sent_at >= ${MANILA_TODAY}`)
        .executeTakeFirstOrThrow();
      if (today.mine > 0 || today.all >= ALERTS_PER_DAY) {
        return false;
      }
      await trx
        .insertInto('person_view_alerts')
        .values({ viewer_person_id: viewerPersonId })
        .execute();
      return true;
    });
    if (!send) {
      return;
    }

    if (this.adminAccounts === null || this.adminAccounts === undefined) {
      throw new Error(
        'Cannot tell the Admin about many pages opened: ADMIN_ACCOUNTS_PORT is not bound.',
      );
    }
    const viewer = await this.db
      .selectFrom('persons')
      .select(['title', 'first_name', 'middle_name', 'last_name'])
      .where('id', '=', viewerPersonId)
      .executeTakeFirst();
    const viewerName = viewer === undefined ? 'an unnamed person' : composeName(viewer);

    for (const admin of await this.adminAccounts.activeAdministrators()) {
      // One Admin's failed send does not keep the others from hearing.
      try {
        const name = await this.db
          .selectFrom('persons')
          .select(['title', 'first_name', 'middle_name', 'last_name'])
          .where('id', '=', admin.person_id)
          .executeTakeFirst();
        await this.email.send({
          kind: 'MANY_PAGES_OPENED',
          to: { email: admin.email, name: name === undefined ? '' : composeName(name) },
          viewer: viewerName,
          pages: opened.pages,
        });
      } catch (error) {
        this.logger.error(
          `Could not tell an Admin that person ${viewerPersonId} opened many records.`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    }
  }
}
