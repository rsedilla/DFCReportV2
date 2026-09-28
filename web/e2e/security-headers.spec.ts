import { expect, test } from '@playwright/test';

/**
 * The website's security headers (owner's choice of 2026-09-28): one fixed policy for
 * every page. The rest of the browser suite is what proves the policy breaks nothing,
 * since a request the policy refuses never reaches the mocked API.
 */
test('every page is served with the security policy and its companion headers', async ({
  request,
}) => {
  for (const path of ['/sign-in', '/dashboard', '/people']) {
    const response = await request.get(path);
    const headers = response.headers();
    const policy = headers['content-security-policy'] ?? '';

    expect(policy, `${path} has no policy`).not.toBe('');
    // Nothing on a page may talk to anywhere but this site and the configured API.
    expect(policy).toContain("connect-src 'self' http://127.0.0.1:9999");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("img-src 'self' data: blob:");
    // The production build carries none of the development allowances.
    expect(policy).not.toContain('unsafe-eval');
    expect(policy).not.toContain('ws:');

    expect(headers['strict-transport-security']).toBe('max-age=31536000; includeSubDomains');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  }
});

test('a request to any other host is refused by the policy', async ({ page }) => {
  await page.goto('/sign-in');

  // The browser's own report of a refusal, rather than the fetch failing, which a
  // cross-origin request would do with no policy at all.
  const violated = await page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        document.addEventListener('securitypolicyviolation', (event) =>
          resolve(event.effectiveDirective),
        );
        fetch('https://example.org/steal').catch(() => undefined);
        setTimeout(() => resolve('none'), 3000);
      }),
  );

  expect(violated).toBe('connect-src');
});
