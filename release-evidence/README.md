# Release evidence

This tracked directory is the handoff point for compact, non-secret evidence required by production builds. Generated tiles and staging data remain outside Git.

The [7 September preview record](./preview-2026-09-07.md) identifies the exact tested deployment, CI run, HTTP checks and browser checks. The [remote delivery report](./deepzoom-v1-remote-verification.json) records a complete HTTPS/SHA-256 read-back of all 3,900 derivative objects. These supplement the full-pixel report; neither grants publication or editorial approval. The automated release gate currently parses the full-pixel report described below; remote deployment evidence still requires operator review.

The [private master archive report](./master-v1-archive-verification.json) records a full read-back hash of the untouched PNG in its separate private bucket. It contains no private local path, upload ID, or credential; it does not make the archival object publicly readable.

After the locked master and the complete DZI pyramid have passed the independent full-pixel verifier, copy the successful report from:

```text
infrastructure/deepzoom/generated/reports/bayeux-tapestry-v1-verification.json
```

to:

```text
release-evidence/deepzoom-v1-verification.json
```

Review the report before committing it. It must not contain a private source path or credentials. `pnpm release:check` parses the tracked copy and ties its asset ID, version, source hash, dimensions, byte length, tile geometry, lossless encoding, inventory, seams, full-resolution pixel comparisons, and toolchain to the manifest and source lock.

Only after that review, change `image.dziVerificationStatus` in `data/tapestry-manifest.json` from `unverified` to `verified`. The status cannot satisfy the release gate by itself; the matching parsed report remains mandatory.

The report is necessary but not sufficient: the same release check also requires evidence-bearing scholarly and coordinate audit records for every scene and annotation.

The manifest’s global states are evidence-backed too:

- Set `editorial.status` to `publication-ready` only with an `editorial.auditRecord` naming the final reviewer, review date, and evidence reference.
- Set `image.rightsStatus` to `documented-for-publication` only with an `image.rightsPublicationRecord` naming the reviewer, date, publication basis, non-secret evidence reference, and exact public rights notice.

Do not place confidential permission correspondence in Git; record a durable identifier or digest that the operator can reconcile with the private file.
