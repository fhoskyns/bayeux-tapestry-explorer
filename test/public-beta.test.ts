import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import policy from '@/data/publication-policy.json';
import manifest from '@/data/tapestry-manifest.json';

const fixtures: string[] = [];
const tileBase = 'https://bayeux-tiles.bayeux-tapestry-deepzoom-infrastructure.workers.dev/v1';
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' })[character]!);

function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), 'bayeux-beta-test-'));
  fixtures.push(directory);
  for (const filename of [
    'scripts/guard-production.mjs', 'scripts/validate-content.mjs', 'scripts/verify-build.mjs',
    'data/publication-policy.json', 'data/tapestry-manifest.json',
    'release-evidence/deepzoom-v1-verification.json', 'release-evidence/deepzoom-v1-remote-verification.json',
    'infrastructure/deepzoom/source-lock.json',
  ]) {
    const destination = path.join(directory, filename);
    mkdirSync(path.dirname(destination), { recursive: true });
    copyFileSync(path.resolve(filename), destination);
  }
  return directory;
}

function run(directory: string, script = 'validate-content', arguments_ = ['--public-beta']) {
  return spawnSync(process.execPath, [`scripts/${script}.mjs`, ...arguments_], {
    cwd: directory,
    encoding: 'utf8',
    env: { ...process.env, VERCEL: '1', VERCEL_ENV: 'production', VERCEL_TARGET_ENV: 'production', VITE_TAPESTRY_TILE_BASE_URL: tileBase },
  });
}

afterEach(() => {
  for (const directory of fixtures.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('public-beta publication policy', () => {
  it('preserves the strict audited-release gate, including when both flags are supplied', () => {
    const directory = fixture();
    for (const flags of [['--release'], ['--public-beta', '--release']]) {
      const result = run(directory, 'validate-content', flags);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Scene 01 is not audited for release');
      expect(result.stderr).toContain('image publication basis remains unresolved');
    }
  });

  it('rejects missing owner authorization', () => {
    const directory = fixture();
    rmSync(path.join(directory, 'data/publication-policy.json'));
    expect(run(directory).status).toBe(1);
    expect(run(directory, 'guard-production', []).status).toBe(1);
  });

  it('rejects incomplete authorization and source substitution', () => {
    const directory = fixture();
    for (const invalid of [{ ...policy, scope: undefined }, { ...policy, imageSha256: '0'.repeat(64) }]) {
      writeFileSync(path.join(directory, 'data/publication-policy.json'), JSON.stringify(invalid));
      expect(run(directory).status).toBe(1);
    }
  });

  it('rejects an unknown channel and never converts strict release to beta', () => {
    const directory = fixture();
    for (const channel of ['unchecked', 'audited-release']) {
      writeFileSync(path.join(directory, 'data/publication-policy.json'), JSON.stringify({ ...policy, channel }));
      expect(run(directory, 'guard-production', []).status).toBe(1);
    }
  });

  it.each(['deepzoom-v1-verification.json', 'deepzoom-v1-remote-verification.json'])('rejects missing or failed %s', (filename) => {
    const directory = fixture();
    const file = path.join(directory, 'release-evidence', filename);
    const contents = readFileSync(file, 'utf8');
    writeFileSync(file, contents.replace('"result": "pass"', '"result": "fail"'));
    expect(run(directory).status).toBe(1);
    rmSync(file);
    expect(run(directory).status).toBe(1);
  });

  it('rejects incomplete hosted coverage and incomplete native-pixel verification', () => {
    for (const [filename, original, replacement] of [
      ['deepzoom-v1-remote-verification.json', '"tileCount": 3899', '"tileCount": 3898'],
      ['deepzoom-v1-verification.json', '"sourcePixelsChecked": true', '"sourcePixelsChecked": false'],
    ]) {
      const directory = fixture();
      const file = path.join(directory, 'release-evidence', filename);
      const contents = readFileSync(file, 'utf8');
      expect(contents).toContain(original);
      writeFileSync(file, contents.replace(original, replacement));
      expect(run(directory).status).toBe(1);
    }
  });

  it('requires both unfinished-review and actual image-rights notices in the built Sources page', () => {
    const directory = fixture();
    mkdirSync(path.join(directory, 'dist/server'), { recursive: true });
    mkdirSync(path.join(directory, 'dist/client'), { recursive: true });
    writeFileSync(path.join(directory, 'dist/server/vinext-prerender.json'), JSON.stringify({ routes: [{ route: '/', status: 'rendered' }] }));
    for (const filename of ['index.html', '404.html']) writeFileSync(path.join(directory, 'dist/client', filename), '<html></html>');
    const notices = [escapeHtml(policy.notice), escapeHtml(manifest.image.rightsNotice)];
    const links = 'Museum reuse terms Corrections and takedown requests';
    writeFileSync(path.join(directory, 'dist/client/sources.html'), `${notices.join(' ')} ${links}`);
    expect(run(directory, 'verify-build', []).status).toBe(0);
    for (const remaining of notices) {
      writeFileSync(path.join(directory, 'dist/client/sources.html'), `${remaining} ${links}`);
      expect(run(directory, 'verify-build', []).status).toBe(1);
    }
  });
});
