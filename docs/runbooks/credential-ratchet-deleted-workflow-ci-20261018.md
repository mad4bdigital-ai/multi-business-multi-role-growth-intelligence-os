# Credential Environment Scope Ratchet — Deleted Workflow Handling

## Problem and scope

The credential-environment-scope ratchet compares workflow files between the immutable base SHA and the current candidate HEAD. The Git three-dot diff includes deleted workflows. Earlier code attempted to read every changed path from the working tree and crashed with `ENOENT` for a deleted workflow such as `.github/workflows/device-runtime-contract.yml`.

## Fail-closed rule

1. Continue validating the four named governed rollout workflows; no change to required jobs, Production Environment bindings, or secret-scanning rules.
2. For each changed workflow, prove whether it existed in the immutable baseline and whether it is still tracked at HEAD using `git ls-tree`.
3. A workflow deleted since the baseline may be omitted from current-content secret inspection, because its current content does not exist. Retain its baseline provenance check.
4. Reject an anomalous changed path that is absent from both the baseline and HEAD.
5. Continue inspecting every current changed workflow; no authentication or authorization bypass.

## Validation

- Run `node http-generic-api/scripts/credential-environment-scope-ratchet.mjs` from the repository root with the CI-provided `CREDENTIAL_PROVENANCE_BASE_SHA` and `CREDENTIAL_PROVENANCE_EVENT` bindings.
- Confirm deletion-only cases do not trigger `ENOENT` and that modified credential-consuming jobs without explicit Environment bindings still fail.
- Complete the existing Syntax Check and staging-migration CI gates on the exact PR head.

This is a CI correctness change only. It does not grant merge, secrets, Production deployment or runtime authority.
