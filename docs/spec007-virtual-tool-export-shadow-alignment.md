# Spec 007 Virtual-Tool Export Shadow Alignment

## Problem

Projected virtual-tool alias exports are currently written as `active` while their canonical capability manifest remains blocked in `shadow` rollout. Projection preview therefore reports `UNSAFE_ACTIVE_ADMIN_EXPORT` even though runtime activation and Tenant projection remain disabled.

## Corrective scope

- Keep actual Admin tool catalog rows and dispatch bindings unchanged.
- Change only canonical capability-export projection rows sourced from `platform_tool_dispatch_bindings` to `shadow` until certification authorizes promotion.
- Add an additive migration that recreates the virtual-tool export view and reconciles existing projected export rows idempotently.
- Add deterministic regression coverage and synchronized governance documentation.

## Safety boundaries

- No public API contract change.
- No protected-branch direct write.
- No provider call, credential payload read, external runtime write, or secret output.
- No Tenant projection, certification, adapter registration, or `apply_allowed` promotion.
- No destructive SQL.

## Rollout

After merge, the migration requires checksum-bound authorization, zero-risk dry-run, governed apply, same-cycle ledger/schema readback, compiler persistence readback, projection preview verification, and confirmation that Admin aliases are shadow-only while Tenant exports remain absent.
