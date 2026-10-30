/**
 * Arithmetic on a `YYYY-MM-DD` day, as a day rather than an instant: computed in UTC, so no
 * time zone and no daylight-saving change can move it. One copy for every screen and helper,
 * where there were three.
 */
export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);

  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}
