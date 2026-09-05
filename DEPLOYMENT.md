# Deployment and release runbook

Production promotion is deliberately gated. Build previews from a non-production branch or with the Vercel CLI, but do not connect the public Deep Zoom source or production alias until every item in [PROVENANCE.md](./PROVENANCE.md) is evidenced and `pnpm release:check` passes.

## Provisioning status — 5 September 2026

- The public [GitHub repository](https://github.com/fhoskyns/bayeux-tapestry-explorer) exists with `main`; both application and tile-infrastructure CI jobs pass.
- The Vercel Hobby project `bayeux-tapestry-explorer` exists in `fhoskyns-projects`, with system environment variables exposed and deployment protection enabled. The GitHub connection still requires the Vercel GitHub app to be installed or granted access to this repository.
- Vercel classified the first CLI deployment as Production despite `--target preview`. The production guard correctly stopped its build; no website was promoted. Keep this guard intact and verify the actual deployment target before treating a deployment as a preview. Do not work around this with an environment override or an unchecked prebuilt upload.
- `.vercelignore` explicitly excludes local environments, generated imagery, dependencies, and build artifacts. Git exclusions alone must not be relied on for CLI deployment packaging. The corrected source upload was approximately 769 KB, not the 3 GB tile pyramid.
- The complete local pyramid is verified and its report is committed. Cloudflare authentication is connected, but R2 activation is still required before the storage buckets can be created. No Cloudflare buckets or Worker have been deployed.

## 1. GitHub and Vercel preview

Create the public repository as `fhoskyns/bayeux-tapestry-explorer` with `main` as its default branch. Import it into the `fhoskyns-projects` Vercel team as `bayeux-tapestry-explorer`.

The Vercel project uses:

- install: `pnpm install --frozen-lockfile`
- build: `pnpm validate:content && pnpm guard:vercel && pnpm build && pnpm verify:build`
- output: `dist/client`
- production branch: `main`

Until the verified Worker exists, omit `VITE_TAPESTRY_TILE_BASE_URL`. The preview will clearly identify its resized Wikimedia Commons images. With Vercel system variables exposed, `guard:vercel` detects the Production target, requires an HTTPS `bayeux-tiles.<account>.workers.dev/v1` origin, and runs the full release check. It intentionally fails while the tile origin or any scholarly, rights, calibration, or DZI evidence is missing. Preview builds remain available for review.

In the Vercel project settings, enable **Automatically expose System Environment Variables**. The Vercel-specific guard invocation reads `VERCEL_TARGET_ENV` first and falls back to `VERCEL_ENV`; if neither value is available, it fails closed. Confirm that a Preview build log says `Production release gate skipped for preview build` and that a staged Production build remains red until all release evidence is present.

## 2. Cloudflare storage boundaries

Use three physically separate R2 buckets:

1. `bayeux-tapestry-archive` — private untouched master under `private/v1/`; never bind this bucket to a Worker.
2. `bayeux-tapestry-derivatives` — only the verified public `v1/` DZI descriptor and tiles.
3. `bayeux-tapestry-derivatives-preview` — non-production derivatives used by Wrangler preview sessions.

Before any upload, independently compare the source delivery with `infrastructure/deepzoom/source-lock.json`. Upload the master only after the project records a documented basis for retaining it. Upload only the verified `generated/v1/` tree to the public derivative bucket; never upload the report, source lock, staging directories, logs, or source image there.

## 3. Worker and tile verification

Deploy `infrastructure/deepzoom/wrangler.jsonc` only after its two derivative bucket names have been confirmed in the target account. The Worker name intentionally yields the initial hostname `bayeux-tiles.<account>.workers.dev`.

Run post-deployment checks against:

- the DZI descriptor with `GET` and `HEAD`;
- representative middle and edge WebP tiles;
- conditional `If-None-Match` requests;
- a missing tile, query-bearing path, traversal-like path, private-master-looking path, and disallowed method;
- CORS, MIME types, content length, ETag, and immutable caching headers.

Do not connect a Worker that serves an incomplete or quick-verified pyramid. Retain the full successful report outside the public asset prefix and commit its reviewed, non-secret copy at `release-evidence/deepzoom-v1-verification.json` so production builds can validate it.

After the committed report has been independently reviewed, set `image.dziVerificationStatus` to `verified` in the manifest. The production gate requires both that explicit state and the report’s exact verified measurements; the status flag alone is insufficient.

## 4. Production connection

After `pnpm release:check` passes, set the Vercel build variable in Preview and Production:

```text
VITE_TAPESTRY_TILE_BASE_URL=https://bayeux-tiles.<account>.workers.dev/v1
```

Push the release candidate to a non-production branch and use its commit-specific Vercel Preview URL to exercise overview, all scene transitions, free exploration, URL restoration, annotations, keyboard navigation, reduced motion, and HTTP smoke checks. Merge that exact reviewed commit into `main` only after the candidate passes. Vercel then reruns the production guard and static build for the production deployment from `main`; immediately repeat the HTTP smoke checks against `bayeux-tapestry-explorer.vercel.app` and roll back if they fail.

## 5. Operations

Keep v1 immutable. A changed source, encoder, coordinate calibration, or processing rule requires a new versioned prefix and report. Review R2 storage/egress and Worker request usage regularly. At 70% of the applicable daily Worker request allowance, move traffic to a cached custom asset hostname or an appropriate paid plan before the limit becomes user-visible.

No analytics, cookies, advertising, authentication, database, or application server API should be introduced as part of deployment.
