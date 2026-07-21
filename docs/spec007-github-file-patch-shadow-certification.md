# Spec 007 GitHub File Patch Shadow Certification

## Purpose

Issue an evidence-backed generic certification for `github_file_patch_apply` without enabling runtime apply, active capability exports, Tenant authority, or direct protected-branch writes.

## Fixed evidence

- Smoke write envelope: `71024f58-21fa-45b5-83f2-a75d05694f92`.
- Smoke write commit: `3de5e578102ab1921e233abcda3dee77535c103b`.
- Smoke blob SHA: `1cfe465f2e278172bd4b2d3c93bf9df6a6023673`.
- Smoke cleanup envelope: `bb74693c-2b7b-4f05-a391-a918fab67cfa`.
- Smoke cleanup commit: `0a77bd528150939db7bd4ba1f07490cbc458edc5`.
- Disposable branch: `gpt/smoke/github-file-patch-shadow-cert-20260720`.
- Write and cleanup resource-authority bindings were branch-scoped, short-lived, and limited to `repo_patch_apply` write/delete modes.

## Corrective scope

- Register the canonical adapter key `repository_change_set_apply` as an active write-capable GitHub adapter delegated to `repo_patch_apply`.
- Record separate acknowledgement and same-cycle readback verification evidence.
- Issue a time-bounded generic `shadow_certified` certification for `github_file_patch_apply` without linking it to runtime dispatch certification.
- Certify the current readback contract `github_file_patch_apply__github_change_set_branch_head_v1__52d0eb30144b4bb4` while preserving shadow rollout.
- Keep `runtime_dispatch_certification_registry` unchanged, including `dispatch_allowed=0` and `apply_allowed=0` for the after-review surface.
- Keep capability exports shadow-only and Tenant exports absent.

## Safety boundaries

- No provider call during certification issue.
- No external write during certification issue.
- No credential payload read or secret output.
- No public API contract change.
- No runtime promotion, active export creation, Tenant authority, or `apply_allowed` promotion.
- Apply requires typed confirmation, a platform-orchestration capability envelope, transaction, and same-cycle SQL readback.

## Rollout

After merge, apply the additive registration migration through checksum-bound governed migration flow. Run issuer dry-run, verify the fixed plan hash and preconditions, issue the certification with a fresh envelope, consume that envelope after readback, refresh the persisted capability compilation, and confirm adapter/certification/readback pass while runtime certification remains blocked.
