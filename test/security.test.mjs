import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { secureHtml, verifySecureHtml, tileOrigin } from '../scripts/secure-static-build.mjs';
import { auditAdvisories, isDocumentedException } from '../scripts/audit-dependencies.mjs';

const base = 'https://tiles.example.org/v1';
const html = '<!doctype html><html><head><meta charSet="utf-8"/><link rel="stylesheet" href="/app.css"><script type="module" src="/app.js"></script></head><body><script>self.__data=["a&b"];\r\n</script><script>\nconsole.log("second");</script></body></html>';

await test('incomplete or failed audit reports cannot silently pass', () => {
  const report = { advisories: {}, metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0 } } };
  assert.deepEqual(auditAdvisories(report), []);
  assert.throws(() => auditAdvisories(report, 1), /incomplete/);
  assert.throws(() => auditAdvisories({ error: 'registry unavailable' }), /complete report/);
  report.metadata.vulnerabilities.high = 2;
  assert.throws(() => auditAdvisories(report), /incomplete/);
  report.metadata.vulnerabilities.high = Number.NaN;
  assert.throws(() => auditAdvisories(report), /invalid/);
});

await test('audit exceptions are limited to the exact known build-only package and expire', () => {
  const advisory = { github_advisory_id: 'GHSA-5p2g-fcmc-qvqq', module_name: 'image-size', findings: [{ version: '2.0.2', paths: ['.>vinext>image-size'] }] };
  const reviewedAt = Date.parse('2026-09-09T00:00:00Z');
  assert.equal(isDocumentedException(advisory, reviewedAt), true);
  assert.equal(isDocumentedException(advisory, Date.parse('2026-10-10T00:00:00Z')), false);
  assert.equal(isDocumentedException({ ...advisory, github_advisory_id: 'new-advisory' }, reviewedAt), false);
  assert.equal(isDocumentedException({ ...advisory, findings: [{ version: '2.0.2', paths: ['.>another-app>image-size'] }] }, reviewedAt), false);
  assert.equal(isDocumentedException({ ...advisory, findings: [] }, reviewedAt), false);
});

await test('CSP hashes preserve all original script bytes/order and add no scripts or requests', () => {
  const secured = secureHtml(html, base);
  verifySecureHtml(secured, base);
  assert.equal(secured.replace(/<meta http-equiv="Content-Security-Policy"[^>]+>/, ''), html);
  const dom = new JSDOM(secured);
  const policy = dom.window.document.querySelector('meta[http-equiv]').content;
  assert.match(policy, /script-src 'self' 'sha256-/);
  assert.match(policy, /worker-src 'self' blob:/);
  assert.match(policy, /img-src 'self' blob: data: https:\/\/tiles.example.org/);
  assert.doesNotMatch(policy, /unsafe-eval|script-src[^;]*unsafe-inline|\*/);
  dom.window.close();
});

await test('verification rejects stale hashes, new scripts, event handlers and late policies', () => {
  const secured = secureHtml(html, base);
  assert.throws(() => verifySecureHtml(secured.replace('console.log("second")', 'alert("changed")'), base), /stale/);
  assert.throws(() => verifySecureHtml(secured.replace('</body>', '<script>alert(1)</script></body>'), base), /stale/);
  assert.throws(() => secureHtml(html.replace('<body>', '<body onload="alert(1)">'), base), /event handlers/);
  assert.throws(() => secureHtml(html.replace('/app.js', 'https://evil.example/app.js'), base), /self-hosted/);
  assert.throws(() => secureHtml(html.replace('/app.js', 'data:text/javascript,alert(1)'), base), /self-hosted/);
  assert.throws(() => secureHtml(secured, base), /existing CSP/);
  const meta = secured.match(/<meta http-equiv="Content-Security-Policy"[^>]+>/)[0];
  assert.throws(() => verifySecureHtml(secured.replace(meta, '').replace('</head>', `${meta}</head>`), base), /immediately/);
  assert.throws(() => verifySecureHtml(secured, 'https://other.example/v1'), /stale/);
});

await test('CSP accepts only credential-free HTTPS image origins and supports image fallback', () => {
  assert.equal(tileOrigin(base), 'https://tiles.example.org');
  for (const invalid of ['javascript:alert(1)', 'http://tiles.example.org', 'https://secret@tiles.example.org', `${base}?key=secret`, `${base}#anything`]) {
    assert.throws(() => tileOrigin(invalid));
  }
  verifySecureHtml(secureHtml(html), undefined);
  assert.throws(() => secureHtml(html.replace('<meta charSet="utf-8"/>', ''), base), /charset/);
});
