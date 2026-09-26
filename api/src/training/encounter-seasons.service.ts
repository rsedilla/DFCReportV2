import { Inject, Injectable } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';

import { AuditService } from '../audit/audit.service';
import { AuthorizationService, type Actor } from '../auth/authorization/authorization.service';
import { Capability } from '../auth/authorization/capabilities';
import {
  InvariantViolationError,
  NotFoundError,
  ValidationFailedError,
} from '../common/errors/api-error';
import { isUniqueViolation, violatedConstraint } from '../common/errors/postgres-errors';
import { IdempotencyService } from '../common/idempotency/idempotency.service';
import { DATABASE, type Db } from '../database/database.module';
import { NetworksService } from '../networks/networks.service';

import type { CurrentClaim } from '../common/idempotency/current-idempotency.decorator';
import type { Database } from '../database/schema';
import type { EncounterSeasonDto } from './dto/encounter-season.dto';

/** Five weeks: the LC Party, then Life Class lessons 1 to 4 a week apart (decision 0296). */
const PARTY_WEEKS_BEFORE = 35;

// A type rather than an interface, so it is assignable to the audit log's `Json`.
type SeasonDates = {
  mens_lc_party_on: string;
  mens_encounter_on: string;
  womens_lc_party_on: string;
  womens_encounter_on: string;
};

/** The index a clash violates, and the field it names. */
const WEEKEND_INDEXES: Record<string, string | undefined> = {
  encounter_seasons_one_per_mens_weekend: 'mens_encounter_on',
  encounter_seasons_one_per_womens_weekend: 'womens_encounter_on',
};

const COLUMNS = [
  'id',
  'mens_lc_party_on',
  'mens_encounter_on',
  'womens_lc_party_on',
  'womens_encounter_on',
] as const;

function daysBefore(date: string, days: number): string {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - days);
  return day.toISOString().slice(0, 10);
}

/**
 * The Encounter seasons (SKILL.md section 28; decisions 0295 and 0296): three a year, each a
 * Men's weekend and a Women's weekend, the Encounter being Life Class lesson 5, and the LC
 * Party before each.
 *
 * **Anyone who reads SUYNL reads the seasons, and each reader their own Network's half**
 * (owner's ruling, decision 0296): the Men's weekend is for men only and the Women's for
 * women only, so a leader is shown the dates of the weekend their people go to, and a Whole
 * Church reader, an administrator or a Senior Pastor, both. **Only a Whole Church `settings.manage` holder
 * records or edits one** (section 7), and every change is audited with its previous and new
 * values (section 21). Nothing deletes a season: a wrong date is an edit.
 */
@Injectable()
export class EncounterSeasonsService {
  constructor(
    @Inject(DATABASE) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly idempotency: IdempotencyService,
    private readonly authorization: AuthorizationService,
    private readonly networks: NetworksService,
  ) {}

  /**
   * Every season, in the order of its earlier weekend, with the half the reader is shown.
   *
   * **The half is decided here, never by the client** (section 1, principle 4). A Whole
   * Church `suynl.view_subtree` grant is shown both; any other reader the half of their own
   * Network now, the other half's two dates answered as null; a reader in no Network, neither.
   * `shows` says which, so a screen need not infer it from the nulls.
   */
  async list(actor: Actor): Promise<Record<string, unknown>> {
    const membership = await this.authorization.scopeMembership(actor, Capability.SuynlViewSubtree);
    const network =
      membership.kind === 'WHOLE_CHURCH'
        ? null
        : await this.networks.networkAsOf(this.db, actor.personId, new Date());
    const shows =
      membership.kind === 'WHOLE_CHURCH' ? 'BOTH' : network === null ? 'NEITHER' : network;

    const rows = await this.db
      .selectFrom('encounter_seasons')
      .select([...COLUMNS])
      .orderBy(sql`least(mens_encounter_on, womens_encounter_on)`)
      .orderBy('mens_encounter_on')
      .execute();

    return {
      shows,
      data: rows.map((row) => {
        const season = this.shape(row);
        return {
          id: season.id,
          mens_lc_party_on: shows === 'BOTH' || shows === 'MENS' ? season.mens_lc_party_on : null,
          mens_encounter_on: shows === 'BOTH' || shows === 'MENS' ? season.mens_encounter_on : null,
          womens_lc_party_on:
            shows === 'BOTH' || shows === 'WOMENS' ? season.womens_lc_party_on : null,
          womens_encounter_on:
            shows === 'BOTH' || shows === 'WOMENS' ? season.womens_encounter_on : null,
        };
      }),
    };
  }

  /** `POST /encounter-seasons`: record a season. */
  async create(
    actor: Actor,
    body: EncounterSeasonDto,
    claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    const dates = this.datesOf(body);

    return this.write(async (trx) => {
      const row = await trx
        .insertInto('encounter_seasons')
        .values({ ...dates, created_by: actor.accountId })
        .returning([...COLUMNS])
        .executeTakeFirstOrThrow();

      await this.audit.writeWithin(trx, {
        actorId: actor.accountId,
        action: 'encounter_season.created',
        targetType: 'encounter_season',
        targetId: row.id,
        before: null,
        after: { ...dates },
      });

      const response = this.shape(row);
      // Last statement in the transaction, and inside it (CLAUDE.md, *Write endpoints*).
      await this.idempotency.completeWithin(trx, { ...claim, status: 201, body: response });

      return response;
    });
  }

  /** `PATCH /encounter-seasons/{id}`: correct a season's dates, all four at once. */
  async update(
    actor: Actor,
    id: string,
    body: EncounterSeasonDto,
    claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    const dates = this.datesOf(body);

    return this.write(async (trx) => {
      // The row is locked so the audit entry's "before" is what this edit replaced.
      const before = await trx
        .selectFrom('encounter_seasons')
        .select([...COLUMNS])
        .where('id', '=', id)
        .forUpdate()
        .executeTakeFirst();

      if (before === undefined) {
        throw new NotFoundError('No such Encounter season.');
      }

      const row = await trx
        .updateTable('encounter_seasons')
        .set({ ...dates, updated_by: actor.accountId, updated_at: sql<Date>`now()` })
        .where('id', '=', id)
        .returning([...COLUMNS])
        .executeTakeFirstOrThrow();

      await this.audit.writeWithin(trx, {
        actorId: actor.accountId,
        action: 'encounter_season.changed',
        targetType: 'encounter_season',
        targetId: id,
        before: {
          mens_lc_party_on: String(before.mens_lc_party_on),
          mens_encounter_on: String(before.mens_encounter_on),
          womens_lc_party_on: String(before.womens_lc_party_on),
          womens_encounter_on: String(before.womens_encounter_on),
        },
        after: { ...dates },
      });

      const response = this.shape(row);
      // Last statement in the transaction, and inside it (CLAUDE.md, *Write endpoints*).
      await this.idempotency.completeWithin(trx, { ...claim, status: 200, body: response });

      return response;
    });
  }

  /**
   * The four dates, with each LC Party left out set to five weeks before its own weekend,
   * and one given refused where it is later than that (decision 0296). The database holds
   * the same rule as a constraint; refusing here names the field a client must fix.
   */
  private datesOf(body: EncounterSeasonDto): SeasonDates {
    const latestMens = daysBefore(body.mens_encounter_on, PARTY_WEEKS_BEFORE);
    const latestWomens = daysBefore(body.womens_encounter_on, PARTY_WEEKS_BEFORE);
    const dates = {
      mens_lc_party_on: body.mens_lc_party_on ?? latestMens,
      mens_encounter_on: body.mens_encounter_on,
      womens_lc_party_on: body.womens_lc_party_on ?? latestWomens,
      womens_encounter_on: body.womens_encounter_on,
    };

    if (dates.mens_lc_party_on > latestMens) {
      throw new ValidationFailedError(
        `The Men's LC Party must be on or before ${latestMens}, five weeks before the Men's Encounter.`,
        { field: 'mens_lc_party_on', value: dates.mens_lc_party_on, latest: latestMens },
      );
    }
    if (dates.womens_lc_party_on > latestWomens) {
      throw new ValidationFailedError(
        `The Women's LC Party must be on or before ${latestWomens}, five weeks before the Women's Encounter.`,
        { field: 'womens_lc_party_on', value: dates.womens_lc_party_on, latest: latestWomens },
      );
    }

    return dates;
  }

  /** One transaction, with a weekend another season already holds refused by name. */
  private async write<T>(work: (trx: Transaction<Database>) => Promise<T>): Promise<T> {
    try {
      return await this.db.transaction().execute(work);
    } catch (error) {
      // Only the two weekend indexes are answered; any other unique violation is rethrown.
      const field = isUniqueViolation(error)
        ? WEEKEND_INDEXES[violatedConstraint(error) ?? '']
        : undefined;
      if (field !== undefined) {
        throw new InvariantViolationError('Another Encounter season already holds that weekend.', {
          field,
        });
      }
      throw error;
    }
  }

  private shape(row: {
    id: string;
    mens_lc_party_on: unknown;
    mens_encounter_on: unknown;
    womens_lc_party_on: unknown;
    womens_encounter_on: unknown;
  }): SeasonDates & { id: string } {
    return {
      id: row.id,
      mens_lc_party_on: String(row.mens_lc_party_on),
      mens_encounter_on: String(row.mens_encounter_on),
      womens_lc_party_on: String(row.womens_lc_party_on),
      womens_encounter_on: String(row.womens_encounter_on),
    };
  }
}
