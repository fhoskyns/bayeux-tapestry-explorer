# Bayeux Tapestry deep-zoom infrastructure

This directory is a deployment-neutral infrastructure bundle for generating and serving a public Deep Zoom Image (DZI) pyramid. It does **not** contain a tapestry image, credentials, a Cloudflare account identifier, or a deployment.

The public object layout is deliberately narrow:

```text
v1/
  bayeux-tapestry/
    bayeux-tapestry.dzi
    bayeux-tapestry_files/
      0/0_0.webp
      …
      <max-level>/<column>_<row>.webp
```

The Worker will serve only those two canonical path shapes. It cannot read arbitrary R2 keys. More importantly, it must be bound to a **derivative-only R2 bucket**; never bind the bucket or storage location containing the private museum master.

## What the checks establish

The scripts lock the authorized source by SHA-256, byte length, dimensions, channels, bit depth, colour space, and orientation. Generation uses 1024-pixel DZI tiles with a one-pixel overlap and lossless WebP (`VP8L`). Full verification then checks:

- the source still matches its lock and the pinned Sharp/libvips versions;
- the descriptor has the required DZI namespace, dimensions, tile size, overlap, and format, and cannot supply an `Image Url` that redirects the viewer to unverified tiles;
- every expected level, directory, and tile exists, with no extra public files;
- every tile contains a lossless `VP8L` bitstream and has the exact expected edge/overlap dimensions;
- both sides of every horizontal and vertical overlap decode to identical pixels; and
- every tile in the maximum-resolution level decodes pixel-for-pixel identically to the corresponding source crop.

Lower pyramid levels are necessarily resampled views. “Lossless WebP” means those derived pixels are compressed losslessly; it does not mean downsampling is reversible. A passing report proves faithful derivation from the locked file, not that the source itself is historically authoritative, complete, correctly colour-managed, or licensed for republication. Those are curator and rights-holder decisions.

## Prerequisites

- Node.js 22 or newer and pnpm.
- Enough local disk for the private source, staging pyramid, final pyramid, and a temporary lossless tiled BigTIFF cache of the source at the same time. Its exact size depends on the pixels and LZW compression and can approach or exceed the uncompressed `width × height × channels` size (about 8 GB for a 482,096 × 5,550 RGB source). Lossless photographic WebP can also be large; measure with a representative crop before scheduling production.
- An approved, single-image, 8-bit sRGB RGB/RGBA publication source with orientation `1`. Do not silently convert a 16-bit, CMYK, rotated, or otherwise different master: have the rights holder approve and checksum a publication derivative first.

Install the pinned offline toolchain:

```sh
pnpm install
pnpm test
```

Commit the resulting `pnpm-lock.yaml` when this bundle is incorporated into the production repository, then use `pnpm install --frozen-lockfile` in CI. Sharp supplies libvips; a global `vips` command is not required.

## 1. Lock the authorized source

Keep the source outside the repository and outside the generated output tree. Inspect it:

```sh
pnpm inspect-source -- \
  --source /secure/museum-delivery/bayeux-approved-publication.tif \
  --asset-id bayeux-tapestry
```

The command prints a suggested lock. Confirm its SHA-256, dimensions, colour profile, orientation, and rights-approved filename against an independent delivery record. Copy `source-lock.example.json` to `source-lock.json`, replace the placeholders with the confirmed values, and remove the informational `inspection` object if copying command output wholesale. The required lock fields are intentionally strict. The lock contains no source path and should be reviewed and committed as part of the publication record.

Do not store the original path in the lock or verification report. The scripts report the checksum and technical properties but do not publish the private filename.

## 2. Generate the immutable v1 pyramid

Choose a new, empty output root and run:

```sh
pnpm generate -- \
  --source /secure/museum-delivery/bayeux-approved-publication.tif \
  --lock ./source-lock.json \
  --output ./generated
```

Generation first rechecks the source lock, builds in a uniquely named staging directory, runs the full verification suite, and only then renames the verified asset into `generated/v1/bayeux-tapestry`. It refuses to overwrite an existing version. A successful run also writes `generated/reports/bayeux-tapestry-v1-verification.json`.

The script disables Sharp’s normal input-pixel ceiling because an approved tapestry scan can be extremely wide. It must never be exposed as an upload endpoint or run on untrusted input. Generation preserves an embedded ICC profile when present, but a curator should still compare the browser rendering against the approved colour-managed reference.

## 3. Verify independently before publication

Run the full verifier again in a clean build job or on another machine with the same locked toolchain:

```sh
pnpm verify -- \
  --source /secure/museum-delivery/bayeux-approved-publication.tif \
  --lock ./source-lock.json \
  --pyramid ./generated/v1/bayeux-tapestry \
  --report ./generated/reports/independent-bayeux-tapestry-v1-verification.json
```

The report path must sit outside the immutable asset directory. Full verification re-hashes the source, reads every tile, checks every seam, and compares the full-resolution tiles to the source. For the source-pixel pass it decodes the large source once into a private, lossless, tiled BigTIFF cache, then reads bounded regions from that cache for every maximum-resolution tile. This avoids decoding the multi-gigabyte panorama once per tile; the temporary cache is removed even when verification fails. `--quick` skips only the final source-pixel comparisons; it still validates the source checksum, tile inventory, lossless bitstreams, dimensions, and seams. A quick run is useful during diagnosis but is not a publication gate.

Treat any failure as a failed build. Do not upload a partially generated staging directory or waive a checksum, extra-file, missing-tile, seam, or source-pixel failure.

## 4. Prepare the derivative-only R2 bucket

Upload only the contents under `generated/v1/`, preserving their keys exactly. For example, the descriptor’s R2 key must be:

```text
v1/bayeux-tapestry/bayeux-tapestry.dzi
```

Do not upload `source-lock.json`, reports, logs, staging folders, or the source image to the public derivative bucket. Give the build uploader a narrowly scoped credential and bind the Worker only to this derivative bucket. Wrangler does not provide a read-only flag for an R2 binding: the Worker is read-only because its code exposes only `get`/`head`, while the physically separate bucket is the hard boundary that keeps the private master unreachable even if the Worker later regresses.

`v1` is immutable. If a source, annotation alignment, encoder, or pyramid setting changes, create and verify `v2`; do not replace keys beneath `v1`, because browsers and Cloudflare are told to cache them for one year.

## 5. Configure and test the read-only Worker

This repository includes a non-secret `wrangler.jsonc` configured for the requested initial `bayeux-tiles.<account>.workers.dev` address and two physically separate derivative buckets. Credentials remain outside it. The Cache API does not persist on `workers.dev`; immutable browser/CDN headers still apply. Before higher traffic, attach a cached custom asset hostname and review the route, bucket names, and account limits.

The Worker behavior is intentionally fixed:

- `GET` and `HEAD` are the only allowed methods; all others receive `405` and `Allow: GET, HEAD`.
- Queries, noncanonical integers, alternate versions, traversal encodings, arbitrary extensions, and mismatched asset names receive `404` without an R2 read.
- Descriptors are served as `application/xml; charset=utf-8`; tiles are served as `image/webp` regardless of uploaded object metadata.
- Every response has `Access-Control-Allow-Origin: *`, `Cross-Origin-Resource-Policy: cross-origin`, and `X-Content-Type-Options: nosniff`.
- Successful objects have a one-year immutable cache policy, R2 ETag, last-modified date, and content length. Conditional `If-None-Match` requests receive `304`.
- Only complete `GET` responses enter the Cloudflare Cache API. R2/cache errors are logged with an opaque request ID; public `500` responses do not expose exception details.

Run the local unit and integration tests before wiring any account:

```sh
pnpm test
```

No credential or deployment command is included in this bundle. Deployment should happen only after the exact derivative bucket binding, custom-domain route, verification report, cache behavior, and representative browser rendering have been reviewed. The Vercel-hosted front end can load the public Worker hostname directly; it needs only a public base URL, never R2 credentials.

## Operational checks after a future deployment

Before linking the viewer, check at least one descriptor, a middle tile, every edge tile at maximum resolution, `HEAD`, conditional `GET`, a nonexistent tile, a private-master-looking path, a query-bearing path, and a disallowed method. Confirm MIME types, CORS, ETags, immutable caching, `404`/`405` behavior, and that the custom hostname—not `workers.dev`—shows CDN cache hits on repeated requests.

Retain the approved source lock, package lock, verification reports, curator sign-off, rights documentation, and deployed object inventory together as the publication record. Keep the source itself in the institution-approved private storage location.

## Primary references

- [Cloudflare R2 Worker API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)
- [Cloudflare R2 with the Cache API](https://developers.cloudflare.com/r2/examples/cache-api/)
- [Cloudflare Workers Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/)
- [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)
- [Sharp Deep Zoom tile output](https://sharp.pixelplumbing.com/api-output/#tile)
- [Sharp WebP output options](https://sharp.pixelplumbing.com/api-output/#webp)
