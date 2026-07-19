# Spec 007 Single-File Mutation Classification Correction

## Problem

`single_file_mutation` is currently classified as `unclassified` while `atomic_change_set` is classified as `state_changing`. Both atomicity modes can resolve to the same canonical capability, which causes operation-family ambiguity and correctly blocks compiler projection.

## Corrective scope

- Add an additive migration that classifies `single_file_mutation` as `state_changing` with risk class `C`.
- Reconcile capabilities, bindings, exports, provenance, shadow readback contracts, and typed debt idempotently.
- Keep all projected capabilities `apply_allowed=0`.
- Add deterministic regression coverage without tool-name special cases.
- Normalize registry tool tags from JavaScript arrays, JSON-array strings, or legacy CSV strings.

## Safety boundaries

- No protected-branch write.
- No destructive SQL.
- No provider call, credential payload read, external send, external runtime write, or secret output.
- No automatic Tenant projection or capability activation.

## Rollout

The corrective migration requires checksum-bound authorization, zero-risk dry-run, governed apply, same-cycle ledger/schema readback, compiler projection verification, Admin-only alias verification, Tenant-projection absence, and confirmation that `apply_allowed` remains zero.
