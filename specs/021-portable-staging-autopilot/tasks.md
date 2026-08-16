# Tasks

## Bootstrap and governance

- [x] Require an exact eligible `main` commit and use Workflow Run polling for that SHA.
- [x] Prevent overlapping One-Click Auto Pilot processes with a global mutex.
- [x] Keep working-tree and raw manifest integrity checks fail-closed.
- [x] Normalize only protected line-ending drift and reject real content changes.

## Docker and runtime

- [x] Add a Staging root-context Dockerfile that includes `canonical-manifest.mjs`.
- [x] Remove Staging host-port binding and preserve the internal `app:8080` Tunnel origin.
- [x] Add service health diagnostics with container state and recent logs.
- [x] Preserve database safety flags and avoid destructive cleanup on application failure.

## Evidence and validation

- [x] Update the manifest, repository inventory, and repository evaluation artifacts.
- [x] Add contract coverage for One-Click, operations logging, Staging boundaries, and E2E governance.
- [x] Run local manifest, closure, inventory, evaluation, and E2E governance checks.
- [ ] Complete the final GitHub CI run on the exact PR head.
- [ ] Obtain final owner attestation and merge only the exact reviewed head.
