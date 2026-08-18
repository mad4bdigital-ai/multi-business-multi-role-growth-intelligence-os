# Tasks

## Bootstrap and governance

- [x] Require an exact eligible `main` commit and use Workflow Run polling for that SHA.
- [x] Prevent overlapping One-Click Auto Pilot processes with a global mutex.
- [x] Keep working-tree and raw manifest integrity checks fail-closed.
- [x] Normalize only protected line-ending drift and reject real content changes.

## Docker and runtime

- [x] Add a Staging root-context Dockerfile that includes `canonical-manifest.mjs`.
- [x] Add Smart/Force/Skip Build modes with exact image provenance reuse and fail-closed mismatch handling.
- [x] Keep npm dependency installation reusable through a BuildKit cache without weakening the exact Git provenance boundary.
- [x] Remove Staging host-port binding and preserve the internal `app:8080` Tunnel origin.
- [x] Add service health diagnostics with container state and recent logs.
- [x] Preserve database safety flags and avoid destructive cleanup on application failure.

## Evidence and validation

- [x] Update the manifest, repository inventory, and repository evaluation artifacts.
- [x] Route transient Staging authority reports outside the checkout so derived-state closure starts clean.
- [x] Make stale Docs Agent main dispatches skip-success and make missing eligibility runs fail clearly instead of polling silently.
- [x] Add contract coverage for One-Click, operations logging, Staging boundaries, and E2E governance.
- [x] Run local manifest, closure, inventory, evaluation, and E2E governance checks.
- [ ] Complete the final GitHub CI run on the exact PR head.
- [ ] Obtain final owner attestation and merge only the exact reviewed head.
