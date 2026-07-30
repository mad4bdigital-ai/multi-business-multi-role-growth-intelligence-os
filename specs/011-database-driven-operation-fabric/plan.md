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

## Phase T502 — Governed remote Git transport

- Bind the canonical GitHub remote to the isolated workspace without accepting arbitrary request URLs.
- Fetch and checkout only the exact governed branch head.
- Expose bounded non-enumerable read, commit, and push operations to repository execution handlers.
- Re-read the remote head before push, require fast-forward ancestry, forbid force push, and verify same-cycle readback.
- Keep credential material in child-process environment only and disable persistent credential helpers.

## Validation

- Register focused real-Git and orchestrator tests in the canonical test execution chain.
- Preserve existing operation orchestrator lifecycle behavior.
- Refresh deterministic generated surface artifacts when required.
- Pass Spec Kit governance, Syntax Check, architecture drift, execution resolver, and unit/integration gates.

## Remaining phases

- Apply `20260728_operation_managed_git_ephemeral_checkout.sql` through governed migration authority.
- Perform migration ledger and runtime readback.

## Rollback

Code changes may be reverted normally. Before narrowing the database enum, verify that no persisted worker lease uses `ephemeral_checkout`. Remote transport never uses force push, so branch rollback remains a normal governed commit or revert operation.
