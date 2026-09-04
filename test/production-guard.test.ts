import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

function runGuard(environment: Record<string, string | undefined>, arguments_: string[] = []) {
  const env = { ...process.env };
  for (const [key, value] of Object.entries(environment)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }

  return spawnSync(process.execPath, ['scripts/guard-production.mjs', ...arguments_], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env,
  });
}

describe('production deployment guard', () => {
  it('leaves preview builds available without a tile origin', () => {
    const result = runGuard({
      VERCEL: '1',
      VERCEL_ENV: undefined,
      VERCEL_TARGET_ENV: 'preview',
      VITE_TAPESTRY_TILE_BASE_URL: undefined,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Production release gate skipped for preview build.');
  });

  it('fails closed when a Vercel build does not expose its target environment', () => {
    const result = runGuard({
      VERCEL: undefined,
      VERCEL_ENV: undefined,
      VERCEL_TARGET_ENV: undefined,
      VITE_TAPESTRY_TILE_BASE_URL: undefined,
    }, ['--vercel-build']);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('without VERCEL_TARGET_ENV or VERCEL_ENV');
  });

  it('rejects a production build without the exact versioned Worker origin', () => {
    const missing = runGuard({
      VERCEL: '1',
      VERCEL_ENV: 'production',
      VERCEL_TARGET_ENV: undefined,
      VITE_TAPESTRY_TILE_BASE_URL: undefined,
    });
    const malformed = runGuard({
      VERCEL: '1',
      VERCEL_ENV: 'production',
      VERCEL_TARGET_ENV: undefined,
      VITE_TAPESTRY_TILE_BASE_URL: 'http://example.com/v1?fallback=true',
    });

    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain('Production requires VITE_TAPESTRY_TILE_BASE_URL');
    expect(malformed.status).toBe(1);
    expect(malformed.stderr).toContain('https://bayeux-tiles.<account>.workers.dev/v1');
  });

  it('accepts the planned Worker origin before applying the editorial release gate', () => {
    const result = runGuard({
      VERCEL: '1',
      VERCEL_ENV: undefined,
      VERCEL_TARGET_ENV: 'production',
      VITE_TAPESTRY_TILE_BASE_URL: 'https://bayeux-tiles.example-account.workers.dev/v1',
    });

    expect(result.stdout).toContain(
      'Verified production Deep Zoom origin: https://bayeux-tiles.example-account.workers.dev/v1',
    );
    expect(`${result.stdout}\n${result.stderr}`).toContain('Scene 01 is not audited for release.');
  });
});
