# PR #7357 — Portable Staging Auto Pilot Checklist

## Scope and safety

- [x] Staging-only files are isolated from Production Compose and Hostinger deployment.
- [x] Production hostnames and Cloudflare DNS mutation remain forbidden.
- [x] Migration and database mutation flags remain exactly false.
- [x] No secrets are included in repository artifacts.

## Bootstrap and integrity

- [x] Exact eligible commit is required.
- [x] Concurrent launcher runs are rejected.
- [x] Protected LF normalization rejects non-line-ending content changes.
- [x] Raw manifest SHA-256 integrity is checked before Compose.
- [x] WSL2 and local Docker context are checked fail-closed.

## Docker and tunnel

- [x] Staging uses repository-root build context.
- [x] `canonical-manifest.mjs` is copied into the application image.
- [x] Staging application host-port binding is disabled; Tunnel origin is `http://app:8080`.
- [x] Cloudflare Tunnel starts only after application health succeeds.
- [x] Database services remain independently healthy and are not destructively removed on app failure.

## Diagnostics and tests

- [x] Durable JSONL operations logging is retained.
- [x] Failed health checks capture container state and recent logs.
- [x] Staging boundary, closure, One-Click, operations logging, inventory, evaluation, manifest, and E2E governance checks pass locally.
- [ ] Required GitHub checks pass on the final PR head.
- [ ] Owner attestation is applied to the final exact head before merge.
