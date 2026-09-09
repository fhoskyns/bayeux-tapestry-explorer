import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { loadEnv } from 'vite';

const DOCUMENT_ORIGIN = 'https://static-build.invalid';
const CHARSET = /<head>\s*<meta\s+charset=["']utf-8["']\s*\/?>/i;

export function tileOrigin(tileBaseUrl) {
  if (!tileBaseUrl) return null;
  const url = new URL(tileBaseUrl);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('CSP tile base must be HTTPS with no credentials, query or fragment.');
  }
  return url.origin;
}

function policyFor(document, origin) {
  const hashes = new Set();
  for (const script of document.querySelectorAll('script')) {
    if (script.hasAttribute('src')) {
      const src = new URL(script.getAttribute('src'), DOCUMENT_ORIGIN);
      if (src.origin !== DOCUMENT_ORIGIN) throw new Error('Static scripts must be self-hosted.');
    } else {
      hashes.add(`'sha256-${createHash('sha256').update(script.textContent).digest('base64')}'`);
    }
  }
  for (const element of document.querySelectorAll('*')) {
    if ([...element.attributes].some(({ name }) => /^on/i.test(name))) {
      throw new Error('Inline event handlers are not allowed by the static CSP.');
    }
  }
  const imageOrigins = [origin, 'https://upload.wikimedia.org', 'https://thumb.wikimedia.org'].filter(Boolean).join(' ');
  return [
    "default-src 'none'",
    `script-src 'self' ${[...hashes].join(' ')}`,
    "script-src-attr 'none'",
    // The viewer, dialogs and OpenSeadragon legitimately create inline styles.
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' blob: data: ${imageOrigins}`,
    `connect-src 'self' ${imageOrigins}`,
    "font-src 'self'",
    // OpenSeadragon decodes tiles in a local blob Worker.
    "worker-src 'self' blob:",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "form-action 'none'",
  ].join('; ');
}

const getPolicies = (document) => [...document.querySelectorAll('meta[http-equiv]')]
  .filter((meta) => meta.httpEquiv.toLowerCase() === 'content-security-policy');

export function secureHtml(html, tileBaseUrl) {
  const dom = new JSDOM(html);
  try {
    if (getPolicies(dom.window.document).length) throw new Error('Unexpected existing CSP meta.');
    if (!CHARSET.test(html)) throw new Error('Expected a leading UTF-8 charset in the document head.');
    const policy = policyFor(dom.window.document, tileOrigin(tileBaseUrl));
    const attribute = policy.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
    // Keep charset first and all script bytes/order untouched. Never reserialize
    // React's streamed bootstrap or add extra network requests to load it.
    return html.replace(CHARSET, (prefix) => `${prefix}<meta http-equiv="Content-Security-Policy" content="${attribute}">`);
  } finally {
    dom.window.close();
  }
}

export function verifySecureHtml(html, tileBaseUrl) {
  const dom = new JSDOM(html);
  try {
    const document = dom.window.document;
    const policies = getPolicies(document);
    if (policies.length !== 1 || document.head.children[1] !== policies[0] ||
        document.head.children[0]?.getAttribute('charset')?.toLowerCase() !== 'utf-8') {
      throw new Error('CSP must occur exactly once, immediately after the leading charset.');
    }
    if (policies[0].content !== policyFor(document, tileOrigin(tileBaseUrl))) {
      throw new Error('CSP is stale or does not match the exact static scripts and allowed origins.');
    }
  } finally {
    dom.window.close();
  }
}

export async function htmlFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await htmlFiles(filename));
    else if (entry.isFile() && entry.name.endsWith('.html')) files.push(filename);
  }
  return files;
}

export function buildTileBase(root) {
  return loadEnv('production', root, 'VITE_').VITE_TAPESTRY_TILE_BASE_URL;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.cwd();
  const base = buildTileBase(root);
  const files = await htmlFiles(path.join(root, 'dist/client'));
  if (!files.length) throw new Error('No static HTML to secure.');
  for (const filename of files) {
    const secured = secureHtml(await readFile(filename, 'utf8'), base);
    verifySecureHtml(secured, base);
    await writeFile(filename, secured);
  }
  console.log(`Added verified, per-page script-hash CSPs to ${files.length} static HTML files.`);
}
