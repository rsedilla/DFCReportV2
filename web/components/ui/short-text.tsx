/**
 * Text a phone table shortens (decision 0451): the short form on screen, and the full one for a
 * screen reader, which hears `Youth` or `Consuelo Bautista` rather than `Y` or `Consuelo B.`.
 * Where the two are the same, or there is no short form, it is the full text alone.
 */
export function ShortText({ full, short }: { full: string; short: string | null }) {
  if (short === null || short === full) {
    return <>{full}</>;
  }
  return (
    <>
      <span aria-hidden="true">{short}</span>
      <span className="sr-only">{full}</span>
    </>
  );
}
