# Deployment and release runbook

On 9 September 2026 the owner explicitly approved production publication as a **public beta**, overriding the requirement to finish the scholarly/publication review first, on condition that unfinished-review and rights notices remain on Sources & Rights. [publication-policy.json](./data/publication-policy.json) records that limited authorization. It is not museum permission, scholarly approval or a completed rights review. The beta gate retains structural validation, exact source identity, full pixel/seam verification, hosted tile evidence and the verified production origin. `pnpm release:check` remains the separate, stricter audited-release gate described in [PROVENANCE.md](./PROVENANCE.md); no draft or unresolved status is changed by beta publication.

## Provisioning status — 7 September 2026

- The public [GitHub repository](https://github.com/fhoskyns/bayeux-tapestry-explorer) exists with `main`; both application and tile-infrastructure CI jobs pass.
- The Vercel Hobby project `bayeux-tapestry-explorer` exists in `fhoskyns-projects`, with system environment variables exposed and deployment protection enabled. Its GitHub app connection is confirmed and the production branch is `main`; `preview/initial-review` is the non-production review branch.
- Vercel classified the first CLI deployment as Production despite `--target preview`. The production guard correctly stopped its build; no website was promoted. Keep this guard intact and verify the actual deployment target before treating a deployment as a preview. Do not work around this with an environment override or an unchecked prebuilt upload.
- `.vercelignore` explicitly excludes local environments, generated imagery, dependencies, and build artifacts. Git exclusions alone must not be relied on for CLI deployment packaging. The corrected source upload was approximately 769 KB, not the 3 GB tile pyramid.
- R2 is active. The three Standard-storage buckets below exist, with public bucket URLs disabled. The read-only Worker is deployed at `https://bayeux-tiles.bayeux-tapestry-deepzoom-infrastructure.workers.dev`; its only deployed binding is the derivative bucket. All 3,900 derivative objects passed exhaustive HTTPS read-back verification on 7 September 2026; see [remote evidence](./release-evidence/deepzoom-v1-remote-verification.json). The Preview-only tile origin is scoped to `preview/initial-review`; Production remains unset.
- The untouched master archive is complete. Its [full read-back SHA-256 report](./release-evidence/master-v1-archive-verification.json) verifies all 3,678,791,445 bytes against the locked original; the authenticated transfer connection has been disposed. For future transfers, do not mistake an archive bucket or an in-progress multipart upload for a completed backup.
- The continuous-panorama [preview verification record](./release-evidence/preview-2026-09-07.md) identifies the exact tested commit, Vercel target, successful CI run, HTTP checks and desktop/mobile browser checks. The preview remains editorially unaudited.

## 1. GitHub and Vercel preview

Create the public repository as `fhoskyns/bayeux-tapestry-explorer` with `main` as its default branch. Import it into the `fhoskyns-projects` Vercel team as `bayeux-tapestry-explorer`.

The Vercel project uses:

- install: `pnpm install --frozen-lockfile`
- build: `pnpm validate:content && pnpm guard:vercel && pnpm build && pnpm verify:build`
- output: `dist/client`
- production branch: `main`

Until the verified Worker exists, omit `VITE_TAPESTRY_TILE_BASE_URL` in Preview. With Vercel system variables exposed, `guard:vercel` detects the Production target, requires an HTTPS `bayeux-tiles.<account>.workers.dev/v1` origin matching the hosted verification evidence, and runs the gate selected by the tracked publication policy (`public-beta` or `audited-release`). Unknown or absent policies fail closed. Both channels require full image-integrity evidence; only audited release requires completed scholarly, rights and calibration review. Preview builds remain available for review.

In the Vercel project settings, enable **Automatically expose System Environment Variables**. The Vercel-specific guard invocation reads `VERCEL_TARGET_ENV` first and falls back to `VERCEL_ENV`; if neither value is available, it fails closed. Confirm that a Preview build log says `Production release gate skipped for preview build` and that Production logs its real target and selected publication channel. Never spoof the environment to bypass the guard.

## 2. Cloudflare storage boundaries

Use three physically separate R2 buckets:

1. `bayeux-tapestry-archive` — private untouched master under `private/v1/<source-sha256>/`; never bind this bucket to a deployed application or public Worker. An operator-only authenticated Wrangler remote-binding session can perform a resumable multipart archive upload, and must be disposed afterwards.
2. `bayeux-tapestry-derivatives` — only the verified public `v1/` DZI descriptor and tiles.
3. `bayeux-tapestry-derivatives-preview` — empty unless a Wrangler preview session specifically needs independent test assets; do not duplicate the full pyramid here.

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

For the owner-authorized public beta, set the following in Production after full local and remote tile verification; preserve the existing Preview value scoped to `preview/initial-review`:

```text
VITE_TAPESTRY_TILE_BASE_URL=https://bayeux-tiles.bayeux-tapestry-deepzoom-infrastructure.workers.dev/v1
```

Run `pnpm check`, `pnpm beta:check` and the production guard with the real Production environment and tile URL. Keep the unfinished-review and image-rights notices intact in the rendered Sources & Rights output. Push the release candidate to a non-production branch and confirm CI; then fast-forward that exact reviewed commit into `main`. Vercel reruns the production guard and static build for the production deployment from `main`. Confirm the target is Production and repeat unauthenticated HTTP smoke checks against the assigned production domain, including the Sources notices and representative image requests; roll back if they fail. An eventual audited release must instead pass `pnpm release:check` before switching the tracked publication channel to `audited-release`.

## 5. Operations

Keep v1 immutable. A changed source, encoder, coordinate calibration, or processing rule requires a new versioned prefix and report. Review R2 storage/egress and Worker request usage regularly. At 70% of the applicable daily Worker request allowance, move traffic to a cached custom asset hostname or an appropriate paid plan before the limit becomes user-visible.

No analytics, cookies, advertising, authentication, database, or application server API should be introduced as part of deployment.
