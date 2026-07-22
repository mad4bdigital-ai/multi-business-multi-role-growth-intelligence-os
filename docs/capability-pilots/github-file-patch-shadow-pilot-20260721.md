# GitHub File Patch Shadow Pilot — 2026-07-21

## Purpose

This document is the bounded production pilot artifact for the certified `github_file_patch_apply` capability.

## Governed execution path

- Capability: `github_file_patch_apply`
- Adapter: `repository_change_set_apply`
- Branch: `gpt/pilot/github-file-patch-shadow-20260721`
- Base commit: `8cc98036a9517c7e5babbb016d61d85315ef7918`
- Resource-authority binding: `0ab11ff6-b27b-4c84-bf42-b0737b917257`
- Capability envelope: `e891aade-d1ca-4a94-b971-e8cb969a02d3`
- Shadow certification: `shadow-cert:github-file-patch-apply:v1`
- Certified readback contract: `github_file_patch_apply__github_change_set_branch_head_v1__52d0eb30144b4bb4`

## Safety boundaries

- The change is documentation-only.
- The target is a non-protected work branch.
- No direct write to `main` or another protected branch is permitted.
- No Tenant authority or active capability export is created.
- Capability-level `apply_allowed` remains disabled.
- The existing specialized runtime-certification snapshot is preserved.
- Same-cycle branch-head and file-content readback are required.

## Expected outcome

A single atomic commit adds this file, the branch head advances from the pinned base commit, and the committed blob is read back from GitHub before a pull request is opened.
