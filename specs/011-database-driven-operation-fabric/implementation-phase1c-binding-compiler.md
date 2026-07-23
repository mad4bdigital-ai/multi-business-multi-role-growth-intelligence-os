# Phase 1C Implementation — Deterministic Binding Compiler

## Purpose

Implement the pure, fail-closed compiler contract for the Database-Compiled Binding Graph without persisting manifests or activating runtime execution.

## Deliverables

- `http-generic-api/operationBindingCompiler.js`
- `http-generic-api/test-operation-binding-compiler.mjs`
- canonical test-manifest registration

## Resolution order

Candidates pass hard eligibility before scoring. The compiler applies deny-wins policy, lifecycle and validity windows, exact scope matching, provider and capability compatibility, dispatch/export/resource/credential readiness, adapter health, capacity, effect policy, approval readiness, and readback readiness.

Eligible bindings are ranked by resource, workspace, tenant, then platform scope; exact provider and capability matches; explicit priority; fallback rank; then bounded quality scoring. Equal highest effective rank is rejected as `blocked_ambiguous_binding` rather than resolved by row order.

## Manifest contract

The output includes operation revision, source revision hash, scope fingerprint, selected and ordered fallback bindings, per-candidate evidence, scoring policy, and a deterministic manifest hash. Raw scope references, credential readiness inputs, provider secrets, and metadata payloads are not projected.

## Scope boundaries

This phase performs no SQL write, manifest persistence, route exposure, runtime activation, tool projection, provider call, external send, deployment, or merge. Persistence and current-manifest uniqueness are deferred to Phase 1D after this compiler contract passes CI.
