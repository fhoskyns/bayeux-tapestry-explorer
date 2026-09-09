# Security

Please report suspected vulnerabilities privately through [GitHub's security advisory form](https://github.com/fhoskyns/bayeux-tapestry-explorer/security/advisories/new). Do not put credentials, exploit details or private data in public issues. Historical corrections and image-rights requests can still use ordinary issues.

## Supported deployment

The current public beta serves only the static `dist/client` export on Vercel. It has no public application API, login, database, uploads or server-rendered endpoints. The Cloudflare Worker exposes a fixed, bounded set of read-only image derivatives, not the archival master. Keep that separation when making changes.

- Never commit credentials, private keys, `.env` files, local Wrangler configuration or master imagery. Anything prefixed `VITE_` is public, not a secret.
- Dependency versions and CI actions are pinned. Pull requests run validation, dependency review and secret scanning with read-only permissions. Standard hosted checks are free for this public repository.
- Production builds add per-page hashed script policies without additional scripts or requests. Vercel also blocks framing. Inline styles remain allowed for the viewer and accessible overlays; arbitrary inline scripts and evaluation are not allowed.
- Tile paths are validated against the actual 20-level pyramid before any R2 operation. Successful GETs retain immutable caching; valid-but-missing objects are cached briefly. This reduces waste but is **not** a hard spending cap or a guarantee against quota exhaustion. Requests rejected by the Worker still count as invocations. No paid mitigation service is configured.

## Current dependency exception (reviewed 2026-09-09)

`image-size@2.0.2`, pulled in by `vinext@1.0.0-beta.5`, has two known denial-of-service advisories:

- [GHSA-w3rx-r6r6-pgpr](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr): malformed ICNS entries.
- [GHSA-5p2g-fcmc-qvqq](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq): malformed JXL/HEIF entries.

No patched release is available in the npm registry as of the review date (the audit feed suggests `2.0.3`, but that version is not published). This package is **not patched**. Vinext calls it in `dist/server/metadata-route-build-data.js`, while reading source-controlled metadata image files during build entry generation. Its parser is not shipped in `dist/client` and visitors cannot upload files or invoke it. A malicious image in a contribution could still hang a build; CI jobs have time limits and contributions must be reviewed.

The audit script permits only those two exact advisories, that version, and that dependency path until **2026-10-09**. It prints the exception rather than hiding it and rejects all other advisories. Reassess earlier if a supported fix becomes available or before adding uploads, server rendering or an API. Dependabot remains enabled, including alerts for these known issues.

## Release checklist

Run `pnpm audit:dependencies`, `pnpm check`, and the infrastructure audit, tests and Worker dry run. Merge a passing PR into protected `main`; Vercel builds from `main`. Check the deployed security headers, HTML script policies and representative image responses. Deploy Worker changes separately using the existing derivative-only binding. Never regenerate or republish the source image merely to update security configuration.
