# Phase 1E Implementation — Read-Only Runtime Verifier

## Purpose

Verify that a persisted current operation manifest remains internally consistent and still maps to active dispatch, endpoint-export, and runtime-certification authorities. This phase is read-only and does not authorize or execute runtime work.

## Verification contract

The verifier checks:

- exactly one current manifest for the operation version and scope fingerprint;
- canonical manifest hash and source revision integrity;
- operation identity and current operation revision;
- operation, validation, rollout, certification, revocation, and expiry lifecycle state;
- compiler allowlist compatibility;
- manifest safety markers and absence of raw scope or sensitive fields;
- selected binding authority keys and readback posture;
- unique active `platform_tool_dispatch_bindings` resolution;
- unique active `platform_endpoint_tool_exports` resolution;
- endpoint identity consistency between dispatch binding and export;
- certified, non-expired `runtime_dispatch_certification_registry` evidence;
- risk-class, dispatch, and readback compatibility.

## Result semantics

A passing result is `ready_for_runtime_authority_resolution`, not `ready_for_dispatch`. Resource authority, credential resolution, approval, quota, kill-switch, and same-cycle readback authorization remain required immediately before execution.

Blocked verification returns structured blocker codes and bounded, non-secret evidence. It does not throw for runtime-state failures; invalid caller input and corrupted persisted JSON remain explicit errors.

## Safety posture

The verifier issues `SELECT` statements only. It performs no provider call, credential payload read, external write, runtime activation, cache population, tool projection, deployment, or merge.

## Scope boundaries

No route or OpenAPI change is included. A later phase may wire this verifier behind an internal application service after migration rollout and live authority validation are separately approved.
