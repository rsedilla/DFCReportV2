import { Client } from 'pg';

import { CURSOR_INSTANT, CURSOR_INSTANT_FORMAT } from '../../src/cells/leadership-request-cursor';

/**
 * How the leadership-request cursor's ordering key is rendered, against the database
 * (SKILL.md section 22, *Pagination*).
 *
 * **This is here rather than in the endpoint's suite because it cannot be pinned end to
 * end.** `createTestDb` opens its own pool and the application opens another, and
 * `SET DateStyle` is per connection — so a case that sets it and then makes an HTTP
 * request has changed nothing about the session the query runs in. An earlier version of
 * this pin was exactly that case: it reddened under the mutation, but for an unrelated
 * reason (the cast's shape fails the pattern under every style), which is the "claims
 * more than it pins" class this repository keeps recording.
 *
 * **One dedicated `Client` rather than a pool**, for the same reason and one further: a
 * `SET` without `LOCAL` changes the one connection it ran on, so on a pool the next
 * statement may be handed a connection that never saw it, and the restore may be handed
 * a third. The setting would then be neither reliably applied nor reliably undone. A
 * single connection makes both deterministic, and it is closed when the suite ends.
 *
 * The hazard that makes the leak worth avoiding rather than merely tidying: under a
 * non-ISO `DateStyle` the driver's own `timestamptz` parser returns `null`, so a
 * connection left dirty makes every later timestamp read come back empty — a failure
 * that would surface as a defect in whatever case happened to draw that connection.
 */
describe('the leadership-request cursor key (section 22)', () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
  });

  afterAll(async () => {
    await client.end();
  });

  /**
   * Every `DateStyle` PostgreSQL supports. The application's own pool pins one now
   * (`database/date-style.ts`), which this comment used to say nothing did — and these
   * cases deliberately set the style themselves, so what they measure is unchanged:
   * that the rendered key survives whatever the session is set to, rather than that
   * the session is set to anything in particular.
   */
  const styles = ['ISO, MDY', 'ISO, DMY', 'SQL, DMY', 'Postgres, DMY', 'German, DMY'];

  const render = async (expr: string): Promise<string> => {
    const result = await client.query<{ value: string }>(`select ${expr} as value`);
    return result.rows[0].value;
  };

  const key = (instant: string): string =>
    `to_char(${instant} at time zone 'UTC', '${CURSOR_INSTANT_FORMAT}')`;

  describe.each(styles)('under DateStyle %s', (style) => {
    beforeAll(async () => {
      await client.query(`SET DateStyle = '${style}'`);
    });

    it('renders a key the decoder accepts', async () => {
      expect(await render(key('now()'))).toMatch(CURSOR_INSTANT);
    });

    it('renders a whole-second instant the decoder still accepts', async () => {
      // `US` pads to six digits rather than truncating, so a zero fraction is
      // `.000000`. A format string that lost its fractional part would fail here, which
      // is the mutation this case exists for.
      const rendered = await render(key(`date_trunc('second', now())`));

      expect(rendered).toMatch(CURSOR_INSTANT);
      expect(rendered).toContain('.000000Z');
    });

    it('round-trips back to the same instant, because ISO input is unambiguous', async () => {
      // The query casts the key back with `::timestamptz`. ISO 8601 with an explicit `Z`
      // parses identically under every `DateStyle`, which is the other half of why this
      // rendering was chosen: a key that rendered stably but parsed differently would
      // page wrongly rather than not at all.
      const result = await client.query<{ same: boolean }>(
        `select ${key('now()')}::timestamptz = date_trunc('microsecond', now()) as same`,
      );

      expect(result.rows[0].same).toBe(true);
    });
  });

  it('is what a cast to text is not, which is the whole reason for `to_char`', async () => {
    // The defect this file exists to catch. `cast(requested_at as text)` renders by
    // `DateStyle`, so under a non-ISO style the server emits a cursor its own decoder
    // rejects — and the client is served page one for ever, silently.
    const rejected: string[] = [];

    for (const style of styles) {
      await client.query(`SET DateStyle = '${style}'`);

      if (!CURSOR_INSTANT.test(await render('cast(now() as text)'))) {
        rejected.push(style);
      }
    }

    // Every one of them, including the two ISO styles: the cast separates date and time
    // with a space and carries an offset rather than `Z`, so it never matches the shape
    // the key is required to have.
    expect(rejected).toEqual(styles);
  });
});
