import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
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

console.log(`Verified ${report.routes.length} rendered static routes and required HTML outputs.`);
