# Tenant Capability Enforcement Kernel

## Purpose

This document records the T020 shared enforcement kernel for adaptive authorization. The kernel is intentionally shadow-only in this PR. It produces a deterministic enforcement decision from the semantic capability resolver output but does not call providers, execute adapters, write external state, or cut over runtime enforcement.

## Boundaries

The initial pilot boundaries are:

- `activation.skills.read`
- `platform.output-artifact.write`
- `content.wordpress.publish`

Each boundary maps to a shadow-only policy. The external high-impact WordPress publish pilot remains `provider_apply_forbidden` until separate approval, envelope, adapter, readback, parity and canary work is completed.

## Outputs

The kernel returns `enforcement_status`, `would_allow`, `revision_vector`, `policy`, `obligations`, `mismatch`, and `manifest_hash` while forcing `provider_apply_allowed: false`, `mutations_executed: false`, `enforcement_cutover: false`, and `secrets_included: false`.

## Status classification

The kernel emits shadow decisions only: `shadow_allow`, `approval_required_shadow_only`, `dependency_blocked`, `ambiguous_resolution_blocked`, `provider_apply_blocked_by_shadow_kernel`, and `resolver_blocked`.

Ambiguity remains fail-closed. Aliases do not grant authority. The resolver status and mismatch taxonomy remain the source for dependency and authority gaps.

## Descriptor tools

The system-layer descriptor source is `tenant_capability_enforcement_kernel_v1` and exposes `tenant_capability_enforcement_preview` and `tenant_capability_enforcement_readiness_smoke`.

## Non-goals

This PR does not implement provider mutation, live enforcement cutover, execution envelopes, scoped approval decisions, stale-envelope invalidation, adapter execution, migration execution, or canary enforcement.
