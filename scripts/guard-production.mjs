#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const deploymentEnvironment = process.env.VERCEL_TARGET_ENV ?? process.env.VERCEL_ENV;
const isVercelBuild = process.argv.includes('--vercel-build') || process.env.VERCEL === '1';

if (!deploymentEnvironment) {
  if (isVercelBuild) {
    console.error(
      'A Vercel build was detected without VERCEL_TARGET_ENV or VERCEL_ENV. '
        + 'Enable automatic exposure of Vercel system environment variables so the release gate can fail closed.',
    );
    process.exit(1);
  }
  console.log('Production release gate skipped for local build.');
  process.exit(0);
}

if (deploymentEnvironment !== 'production') {
  console.log(`Production release gate skipped for ${deploymentEnvironment} build.`);
  process.exit(0);
}

console.log('Vercel production build detected; enforcing the configured publication gate.');

const tileBase = process.env.VITE_TAPESTRY_TILE_BASE_URL?.trim();
let tileBaseUrl;

try {
  tileBaseUrl = tileBase ? new URL(tileBase) : null;
} catch {
  tileBaseUrl = null;
}

const expectedWorkerHost = /^bayeux-tiles\.[a-z0-9-]+\.workers\.dev$/i;
const validTileBase = tileBaseUrl
  && tileBaseUrl.protocol === 'https:'
  && expectedWorkerHost.test(tileBaseUrl.hostname)
  && tileBaseUrl.pathname === '/v1'
  && !tileBaseUrl.username
  && !tileBaseUrl.password
  && !tileBaseUrl.search
  && !tileBaseUrl.hash;

if (!validTileBase) {
  console.error(
    'Production requires VITE_TAPESTRY_TILE_BASE_URL in the form '
      + 'https://bayeux-tiles.<account>.workers.dev/v1 with no credentials, query, or fragment.',
  );
  process.exit(1);
}

console.log(`Verified production Deep Zoom origin: ${tileBaseUrl.origin}${tileBaseUrl.pathname}`);
let channel;
try {
  channel = JSON.parse(readFileSync('data/publication-policy.json', 'utf8')).channel;
  if (!['public-beta', 'audited-release'].includes(channel)) throw new Error('Unknown publication channel.');
} catch (error) {
  console.error(`Production requires an explicit publication policy: ${error.message}`);
  process.exit(1);
}
console.log(`Publication channel: ${channel}. Editorial audit statuses are unchanged.`);
const result = spawnSync(process.execPath, ['scripts/validate-content.mjs', channel === 'public-beta' ? '--public-beta' : '--release'], {
  stdio: 'inherit',
});

if (result.error) {
  console.error(`Could not run the production release gate: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
