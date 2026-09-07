# The Bayeux Tapestry, Thread by Thread

An English-first, non-commercial interactive exploration of the complete surviving Bayeux Tapestry.

## Status

This repository is an **editorial and technical preview**, not a production publication. It contains all 58 modern museum scene divisions and 116 draft notes, but every transcription, translation, citation locator, scene boundary, and hotspot position still requires specialist review. The release check is designed to fail until that evidence exists.

The complete lossless Deep Zoom pyramid passed a fresh full verification on 7 September 2026 (London time): 3,899 tiles, 6,816 seams, and pixel equality against the locked master for all 2,826 native-resolution tiles. All 3,900 hosted objects (tiles plus DZI) also passed an exhaustive read-back SHA-256 check through the Cloudflare Worker. Both the [pixel verification](./release-evidence/deepzoom-v1-verification.json) and [hosted delivery verification](./release-evidence/deepzoom-v1-remote-verification.json) reports are tracked; imagery remains outside Git. This technical result does not constitute editorial approval or publication clearance.

## Experience

- An optional, skippable 2.6-second overhead globe-to-London descent using real NASA, Copernicus/EOX and Environment Agency imagery; no live map API. See [imagery provenance](./docs/intro-assets.md).
- A pure-white, full-viewport viewer. Title and controls reveal at the top/bottom edges, by keyboard, or on a canvas tap; they never shrink the image.
- A true-proportion overview of the complete surviving strip.
- A 58-scene guided tour with previous/next controls and shareable URLs.
- Height-fitted scenes, horizontal dragging, wheel/pinch zoom, explicit image controls, and resumable free exploration. Vertical movement is locked while the whole image height is visible and unlocks for detail zoom.
- An X in close-up returns to a white-surrounded context view at the same position, revealing the title and controls. Zooming back in hides them; Home still shows the entire strip.
- An Auto-pan dial offers four speeds: Slow (14), Gentle (28, default), Steady (56), and Brisk (84 screen pixels per second). A separate borderless play/pause button starts or stops movement; selecting a notch alone never starts playback. Manual navigation, note reading and the surviving ending pause it. It does not start automatically, including in shared URLs; hidden tabs suspend movement.
- A complete-strip navigator with hover magnification, click-to-jump, viewport indication, and an accessible scene selector.
- Chapter-labelled, keyboard-accessible annotation markers (1a, 1b, 2a…), a desktop evidence panel, a mobile bottom panel, Latin tituli, draft project translations, and direct source links.
- Auto-pan opens one annotation preview at a time as it passes the centre; manual hover/focus takes priority. The four-speed playback control stays at the right in close-up.
- An optional, lazily loaded **Gallery / Bird’s-eye** switch. The live 3D gallery supports dragging along the case, wheel/pinch zoom, Shift/right-drag orbit and keyboard controls. Switching back rises over the same image coordinates. The case is a conceptual Blender study—not an official or measured museum reconstruction. See [gallery implementation and provenance](./docs/gallery.md).

## Local development

Requirements: Node.js 22.13 or newer and pnpm.

```sh
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm dev
```

Without `VITE_TAPESTRY_TILE_BASE_URL`, the app deliberately uses resized Wikimedia Commons preview imagery. No credential is ever exposed to the browser.
Without that configuration, dragging is within the selected source image. The `preview/initial-review` Vercel environment now uses the verified Deep Zoom host for continuous panning across the entire original. Separate fallback photographs are never stitched together as a purported accurate facsimile.

## Checks

```sh
pnpm check
pnpm release:check
```

`pnpm check` validates the draft data contract, types, lint, interactions, and the complete static export. Once the manifest is marked `publication-ready`, its content validator automatically enforces the full release gate in CI. `pnpm release:check` invokes that gate explicitly: it requires global editorial approval, a documented image-publication basis, audited content with evidence-bearing review records, and a passing full-pixel Deep Zoom verification report.

The tile generator and Worker have their own tested package:

```sh
cd infrastructure/deepzoom
pnpm install --frozen-lockfile
pnpm test
```

See [PROVENANCE.md](./PROVENANCE.md), [DEPLOYMENT.md](./DEPLOYMENT.md), and [infrastructure/deepzoom/README.md](./infrastructure/deepzoom/README.md) before handling imagery or Cloudflare resources.

## Deployment shape

- Static React/Vinext export on Vercel.
- Lossless versioned DZI derivatives in a public-derivative-only Cloudflare R2 bucket.
- A read-only Cloudflare Worker that accepts only canonical `GET` and `HEAD` paths under `/v1/`.
- A physically separate private archive bucket for the untouched master, with no deployed Worker binding or public URL.
- No database, authentication, analytics, advertising, cookies, or application API.

## Corrections and rights concerns

Open a GitHub issue with the scene number, source, and requested correction. Do not attach copyrighted source imagery or private personal information. A private operator contact will be added before production publication.

## Licences

- Application code: [MIT](./LICENSE).
- Original editorial content: [CC BY-NC-SA 4.0](./CONTENT-LICENSE.md).
- Tapestry imagery and all third-party material: excluded from both licences.
