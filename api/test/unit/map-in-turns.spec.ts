import { mapInTurns } from '../../src/common/map-in-turns';

describe('mapInTurns', () => {
  it('keeps the order of its items, whatever order they finish in', async () => {
    const delays = [30, 5, 20, 1, 10];
    const results = await mapInTurns(delays, 3, async (delay, index) => {
      await new Promise((resolve) => setTimeout(resolve, delay));
      return index;
    });
    expect(results).toEqual([0, 1, 2, 3, 4]);
  });

  it('never runs more than its limit at once, and does use the limit', async () => {
    let running = 0;
    let most = 0;
    await mapInTurns(
      Array.from({ length: 12 }, (_, i) => i),
      4,
      async () => {
        running += 1;
        most = Math.max(most, running);
        await new Promise((resolve) => setTimeout(resolve, 5));
        running -= 1;
      },
    );
    expect(most).toBe(4);
  });

  it('answers an empty list with an empty one', async () => {
    expect(await mapInTurns([], 4, () => Promise.resolve(1))).toEqual([]);
  });
});
