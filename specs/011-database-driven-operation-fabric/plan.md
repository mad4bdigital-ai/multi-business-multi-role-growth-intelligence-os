# Implementation Plan

## Phase T500 — Isolated workspace

- Add a bounded ephemeral checkout executor.
- Initialize and verify a local Git repository without remote transport.
- Preserve the workspace path only in a non-enumerable in-memory handle.
- Integrate allocation, ready/running transitions, cleanup, expiry, and conservative readback.
- Extend persistence and OpenAPI contracts additively.

## Phase T501 — Credential binding

- Reuse the governed credential resolver.
- Bind authority to one worker and repository for a bounded lifetime.
- Keep credential bytes in memory and zeroize temporary and retained buffers.
- Disable platform fallback in the orchestrator integration path.
- Release credentials before workspace cleanup in success and failure flows.

## Validation

- Register focused tests in the canonical test manifest.
- Preserve existing operation orchestrator lifecycle behavior.
- Refresh deterministic generated surface artifacts.
- Pass Spec Kit governance, Syntax Check, architecture drift, execution resolver, and unit/integration gates.

## Remaining phases

- **T502:** governed remote Git transport using the isolated workspace and credential binding.
- Apply `20260728_operation_managed_git_ephemeral_checkout.sql` through governed migration authority.
- Perform runtime readback after migration and any future T502 activation.

## Rollback

Code changes may be reverted normally. Before narrowing the database enum, verify that no persisted worker lease uses `ephemeral_checkout`.