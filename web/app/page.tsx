/**
 * The application has no features yet, and this page says so plainly.
 *
 * Stage 1 builds the skeleton everything else hangs on: the repository layout,
 * continuous integration, the authentication skeleton, the authorization guard,
 * and the first migration carrying the section 5 constraints (docs/ROADMAP.md).
 */
const FOUNDATIONS = [
  {
    title: 'Authentication',
    detail: 'Short-lived access tokens, rotating refresh tokens, revocation on every device at once',
  },
  {
    title: 'Authorization',
    detail: 'Capability and scope, checked by the API on every request and never by this client',
  },
  {
    title: 'Pastoral hierarchy',
    detail: 'Arbitrary depth, cycle-safe, at most one active assignment per person',
  },
];

export default function HomePage() {
  return (
    <main className="mx-auto max-w-2xl px-5 py-12 sm:py-16">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">G12 Church Management</h1>

      <p className="text-muted mt-3 text-base leading-relaxed">
        Stage 1: foundations. The application has no features yet, and this page exists so the
        skeleton has something to serve.
      </p>

      <p className="text-muted mt-3 text-base leading-relaxed">
        This is a pure client of{' '}
        <code className="bg-raised border-line rounded border px-1.5 py-0.5 text-sm">
          /api/v1
        </code>
        . It holds no API routes and no server actions, and the phones will call the same API.
      </p>

      <ul className="border-line mt-8 space-y-4 border-t pt-6">
        {FOUNDATIONS.map((item) => (
          <li key={item.title}>
            <h2 className="text-sm font-medium">{item.title}</h2>
            <p className="text-muted mt-0.5 text-sm leading-relaxed">{item.detail}</p>
          </li>
        ))}
      </ul>
    </main>
  );
}
