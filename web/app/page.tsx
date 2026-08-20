/**
 * The application has no features yet, and this page says so plainly.
 *
 * Stage 1 builds the skeleton everything else hangs on: the repository layout,
 * continuous integration, the authentication skeleton, the authorization guard,
 * and the first migration carrying the section 5 constraints (docs/ROADMAP.md).
 */
export default function HomePage() {
  return (
    <main>
      <h1>G12 Church Management</h1>
      <p>
        Stage 1: foundations. The application has no features yet, and this page exists so the
        skeleton has something to serve.
      </p>
      <p>
        This is a pure client of <code>/api/v1</code>. It holds no API routes and no server
        actions, and the phones will call the same API.
      </p>
      <ul>
        <li>Authentication: short-lived access tokens, rotating refresh tokens</li>
        <li>Authorization: capability and scope, checked by the API on every request</li>
        <li>Pastoral hierarchy: arbitrary depth, cycle-safe, one active assignment per person</li>
      </ul>
    </main>
  );
}
