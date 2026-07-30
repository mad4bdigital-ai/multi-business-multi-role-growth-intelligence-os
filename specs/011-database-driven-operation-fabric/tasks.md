# Tasks

## T500 — Isolated ephemeral checkout

- [x] Create unique governed workspace directories with restrictive permissions.
- [x] Initialize and verify a local Git repository without shell command strings.
- [x] Prevent workspace path traversal and serialization.
- [x] Integrate lifecycle allocation, ready, running, cleanup, and expiry behavior.
- [x] Add additive migration and OpenAPI contract updates.
- [x] Add executor, lifecycle, cleanup, authorization, and orchestrator dependency tests.

## T501 — Short-lived repository credential binding

- [x] Reuse governed credential resolution authority.
- [x] Scope credentials to one worker and repository.
- [x] Bound TTL by configured limits, worker lease, and provider expiry.
- [x] Keep credential material in memory and zeroize all copies.
- [x] Disable platform fallback in the orchestrator integration path.
- [x] Release credential authority before workspace cleanup on success and failure.
- [x] Add containment, expiry, scope, fallback, and orchestrator regression tests.

## Reconciliation and delivery

- [x] Rebuild T500/T501 over current `main` without force-pushing stale stacked branches.
- [x] Preserve current operation security, capability, ownership, artifact, and finalization behavior.
- [x] Register focused tests without replacing existing manifest commands.
- [x] Refresh deterministic generated surface artifacts.
- [x] Pass all required repository CI gates.
- [x] Merge reconciliation PR #3394 and verify default-branch readback at `cbbc5c4ee1a49449f81e56f4c85960fd9fbee7e6`.
- [x] Close superseded PRs #3240, #3259, and #3326 with replacement references.

## Remaining feature scope

- [ ] Implement T502 governed remote Git transport.
- [ ] Apply the additive ephemeral-checkout migration through governed migration authority.
- [ ] Record migration and runtime readback evidence.
