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

## T500/T501 reconciliation and delivery

- [x] Rebuild T500/T501 over current `main` without force-pushing stale stacked branches.
- [x] Preserve current operation security, capability, ownership, artifact, and finalization behavior.
- [x] Register focused tests without replacing existing manifest commands.
- [x] Refresh deterministic generated surface artifacts.
- [x] Pass all required repository CI gates.
- [x] Merge reconciliation PR #3394 and verify default-branch readback at `cbbc5c4ee1a49449f81e56f4c85960fd9fbee7e6`.
- [x] Merge evidence closeout PR #3422 at `40bb6461e3399213080a63956ab82460c18b38a6`.
- [x] Close superseded PRs #3240, #3259, and #3326 with replacement references.

## T502 — Governed remote Git transport

- [x] Bind canonical remote transport to the isolated workspace and credential scope.
- [x] Fetch and checkout the exact governed branch head.
- [x] Add bounded commit and fast-forward-only push operations.
- [x] Reject remote drift, non-fast-forward history, and force push.
- [x] Verify same-cycle push readback and secret/path containment.
- [x] Attach the transport as a non-enumerable operation-orchestrator dependency.
- [x] Register focused real-Git and orchestrator regression tests.
- [x] Pass all required repository CI gates for T502 in run `30535282634`.
- [x] Merge PR #3499 at `7553051d1d7f0912aace41090aec552c32d7de22` and verify default-branch readback.
- [x] Harden branch/workspace input validation through PR #3553 at `bdf3c72143d8942b04da6ef3d83919d0502e5985`.
- [x] Pass hardening CI in run `30536413250` and verify the final source/test blobs on `main`.
- [x] Merge T502 evidence closeout PR #3586 at `fee5b710cfce072c91effdf02d01394a4c20a41d`.

## Governed production migration and verification

- [x] Authorize the checksum-bound migration through governed migration authority.
- [x] Apply `20260728_operation_managed_git_ephemeral_checkout.sql` with confirmation `APPLY_20260728_OPERATION_MANAGED_GIT_EPHEMERAL_CHECKOUT`.
- [x] Record governed ledger run `99f726d7-4f09-4d1c-900d-378d5c89d5b9` in mode `apply` with preflight status `pass` and risk count `0`.
- [x] Complete Production apply/readback workflow run `30618204241` and job `91116246777` without retrying Apply.
- [x] Verify the exact Production column contract in read-only workflow run `30619520100` and job `91120461783`.
- [x] Confirm `operation_managed_git_worker_leases.checkout_strategy` is `enum('virtual_git_tree','ephemeral_checkout')` and `IS_NULLABLE=NO`.
- [x] Confirm schema expectation gaps, provider calls, external writes, row-data reads, freeform SQL, and secret output are all zero/false.
- [x] Close temporary execution PR #3880 and readback PR #3971 without merging operational workflows.

## Completion

- [x] T500, T501, and T502 are implemented, merged, hardened, and verified on the default branch.
- [x] The additive migration is applied and recorded through governed authority.
- [x] Runtime/DB parity, governed ledger readback, and exact Production schema readback passed.
- [x] No Spec 011 feature tasks remain open.
