import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EXCEPTIONS = new Set(['GHSA-w3rx-r6r6-pgpr', 'GHSA-5p2g-fcmc-qvqq']);
const EXPIRES = Date.parse('2026-10-10T00:00:00Z');

export function isDocumentedException(advisory, now = Date.now()) {
  return now < EXPIRES && EXCEPTIONS.has(advisory.github_advisory_id) &&
    advisory.module_name === 'image-size' && advisory.findings?.length > 0 &&
    advisory.findings.every((finding) => finding.version === '2.0.2' && finding.paths?.length > 0 &&
      finding.paths.every((dependencyPath) => dependencyPath === '.>vinext>image-size'));
}

export function auditAdvisories(report, exitStatus = 0) {
  const counts = report.metadata?.vulnerabilities;
  if (!report.advisories || typeof report.advisories !== 'object' || Array.isArray(report.advisories) || !counts || report.error) {
    throw new Error('Dependency audit did not return a complete report; refusing to skip it.');
  }
  const values = ['info', 'low', 'moderate', 'high', 'critical'].map((severity) => counts[severity]);
  if (values.some((value) => !Number.isSafeInteger(value) || value < 0)) {
    throw new Error('Dependency audit returned invalid vulnerability counts.');
  }
  const advisories = Object.values(report.advisories);
  if (!advisories.length && (exitStatus !== 0 || values.some((value) => value > 0))) {
    throw new Error('Dependency audit is incomplete: reported failures without advisory details.');
  }
  return advisories;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let output;
  let exitStatus = 0;
  try {
    output = execFileSync('pnpm', ['audit', '--json'], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, timeout: 120000 });
  } catch (error) {
    if (error.status !== 1 || !error.stdout) throw error;
    output = error.stdout;
    exitStatus = error.status;
  }
  const report = JSON.parse(output);
  const advisories = auditAdvisories(report, exitStatus);
  const failures = advisories.filter((advisory) => !isDocumentedException(advisory));
  for (const advisory of advisories) {
    const known = isDocumentedException(advisory);
    console.log(`${known ? 'KNOWN BUILD-ONLY EXCEPTION (expires 2026-10-09)' : 'BLOCKED'}: ${advisory.github_advisory_id} — ${advisory.module_name}: ${advisory.title}`);
  }
  console.log(`${advisories.length} advisory/advisories; ${advisories.length - failures.length} documented exception(s); ${failures.length} blocking.`);
  if (failures.length) process.exitCode = 1;
}
