import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { buildTileBase, htmlFiles, verifySecureHtml } from './secure-static-build.mjs';

const root = process.cwd();
const tileBase = buildTileBase(root);
for (const filename of await htmlFiles(path.join(root, 'dist/client'))) {
  verifySecureHtml(await readFile(filename, 'utf8'), tileBase);
}
const reportPath = path.join(root, 'dist/server/vinext-prerender.json');
const report = JSON.parse(await readFile(reportPath, 'utf8'));
const failures = report.routes.filter((route) => route.status !== 'rendered');

if (failures.length) {
  console.error(
    failures.map((route) => `${route.route}: ${route.status}${route.error ? ` — ${route.error}` : ''}`).join('\n'),
  );
  process.exit(1);
}

for (const filename of ['index.html', 'sources.html', '404.html']) {
  try {
    await access(path.join(root, 'dist/client', filename));
  } catch {
    console.error(`Static build output is missing dist/client/${filename}.`);
    process.exit(1);
  }
}

const policy = JSON.parse(await readFile(path.join(root, 'data/publication-policy.json'), 'utf8'));
if (policy.channel === 'public-beta') {
  const sources = await readFile(path.join(root, 'dist/client/sources.html'), 'utf8');
  const { image } = JSON.parse(await readFile(path.join(root, 'data/tapestry-manifest.json'), 'utf8'));
  const rightsNotice = image.rightsStatus === 'documented-for-publication'
    ? image.rightsPublicationRecord?.publicNotice ?? image.rightsNotice
    : image.rightsNotice;
  const escapeHtml = (text) => text.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' })[character]);
  if (typeof policy.notice !== 'string' || typeof rightsNotice !== 'string' || !rightsNotice.trim() ||
      !sources.includes(escapeHtml(policy.notice)) || !sources.includes(escapeHtml(rightsNotice)) ||
      !sources.includes('Museum reuse terms') || !sources.includes('Corrections and takedown requests')) {
    console.error('Public-beta output must retain the unfinished-review and image-rights notices, museum reuse terms and correction route.');
    process.exit(1);
  }
}

console.log(`Verified ${report.routes.length} rendered static routes and required HTML outputs.`);
