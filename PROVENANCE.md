# Image provenance and publication status

## Intended master

- Source: Wikimedia Commons revision `1228601040`, uploaded 12 September 2023.
- Dimensions: `482096 × 5550` pixels.
- SHA-256: `dc6717cc882a42984d328a58021b7d97a081ce0c0549c35057c34e1d16eca6b5`.
- Byte length: `3678791445`.
- Technical inspection: one-page, 8-bit sRGB PNG, three channels, orientation 1, no embedded ICC profile reported by the pinned Sharp/libvips toolchain.

The master image is not stored in Git and must never be served by the tile Worker. `infrastructure/deepzoom/source-lock.json` records the release input without recording its private path.

## Current preview

The complete `v1` DZI pyramid passed a fresh full-pixel verification on 7 September 2026 (London time). Its [tracked report](./release-evidence/deepzoom-v1-verification.json) matches the source lock and records 3,899 lossless WebP tiles across levels 0–19, 6,816 checked seams, and pixel equality against the locked master for all 2,826 native-resolution tiles. The tiles total 3,065,956,662 bytes. This proves faithful derivation from the locked digital file, not identity with the physical object or authority to publish it.

On 7 September 2026, all 3,900 hosted derivative objects passed a full HTTPS read-back through the read-only Cloudflare Worker: exact SHA-256 and byte lengths, expected MIME, public CORS, and immutable caching headers. The [remote verification report](./release-evidence/deepzoom-v1-remote-verification.json) records 3,065,956,871 total bytes including the DZI descriptor. Only the `preview/initial-review` Vercel environment is connected to this host. Without `VITE_TAPESTRY_TILE_BASE_URL`, the application still falls back to resized Wikimedia Commons overview and scene images, which are not represented as pixel-identical native-resolution tiles.

The owner activated R2 and authorized full-panorama preview delivery on 7 September 2026, explicitly proceeding with the selected Commons scan despite its public-domain marking conflicting with museum source terms. This records the operator's preview decision only: formal permission and production publication review remain unresolved. The untouched archive and public derivative tiles occupy separate private R2 buckets; only the derivative bucket is bound to the deployed read-only Worker.

Scene bounds are proportional estimates derived from the widths of separate museum-numbered scene images. Hotspot positions are editorial placement hints. Both require calibration against the final master.

## Credit and rights notices

Official digital representation of the Bayeux Tapestry – 11th century. Credits: City of Bayeux, DRAC Normandie, University of Caen Normandie, CNRS, ENSICAEN. Photos: 2017 – La Fabrique de patrimoines en Normandie.

Wikimedia Commons identifies the reproduction as public domain under its PD-Art policy. Separately, the Bayeux Museum panorama terms permit non-commercial consultation and require City of Bayeux permission for HD reproductions of details. A non-commercial purpose does not itself resolve those conditions. Permission or another documented basis for this project’s image use has not yet been recorded.

The project is independent and is not affiliated with, endorsed by, or certified by the City of Bayeux, the Bayeux Museum, Wikimedia Commons, UNESCO, or any cited scholar or institution.

## Publication gates

Production promotion requires all of the following:

1. A documented basis for publishing the intended imagery.
2. Global editorial approval plus scholarly review of all 58 Latin transcriptions, translations, summaries, notes, claim-specific locators, and disputed-reading labels.
3. Image-coordinate calibration of every scene and hotspot.
4. A full, passing DZI verification report tied to the source lock, including native-level pixel equality, complete inventory, seams, lossless bitstreams, and toolchain versions.
5. A passing static build, browser interaction checks, and HTTP smoke tests.

The normal development check permits explicitly labelled drafts. `pnpm release:check` requires a reviewed rights-publication record and global editorial record in addition to item-level audits, and remains intentionally red until every publication gate has evidence.
