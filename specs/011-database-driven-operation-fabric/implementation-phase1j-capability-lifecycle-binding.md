# Phase 1J Implementation — Operation-Scoped Capability Lifecycle Binding

## Purpose

Implement task T303 by binding the existing capability envelope lifecycle to SQL-resolved operation contracts, governed authority preflight evidence, and immutable run revision pins.

## Authority context

`operationCapabilityAuthorityContext.js` composes:

- the SQL-first runtime contract resolution;
- the Phase 1F authority preflight readiness result;
- the T302 immutable run revision pin.

For capability-required execution it verifies operation identity, contract revision, manifest and source hashes, and exactly one pinned binding matching the capability key. The pinned binding supplies the governed app, operation intent, runtime surface, and source tier. A legacy code fallback may support read-only migration behavior, but it cannot grant mutation authority.

The context computes deterministic binding and capability SHA-256 evidence and always reports `runtime_dispatch_authorized=false`.

## Lifecycle reuse

`operationCapabilityLifecycleService.js` remains the acquisition, renewal, consumption, expiry, and bounded-retry authority. The new optional `authorityContext` input:

- replaces static-registry capability classification when present;
- constrains existing envelope resolution by app, capability, intent, tenant, and user;
- verifies the resolved runtime surface against the pinned binding;
- builds just-in-time renewal requests from the pinned app, capability, intent, runtime surface, and source tier;
- re-resolves a renewed envelope in the same cycle before returning it as ready;
- projects bounded authority evidence without raw contract, resource, credential, or provider payloads.

When the authority context is absent, legacy behavior remains unchanged for backward compatibility. It does not become a substitute for the SQL authority path.

## Failure handling

- mismatched contract, binding, intent, or runtime surface fails closed;
- capability-required execution without a run revision pin fails closed;
- a renewed envelope that does not match the pinned authority is rejected;
- successful operations consume the envelope;
- blocked, awaiting-input, or failed operations retain it for bounded retry under the existing lifecycle policy.

## Scope boundaries

This phase adds no migration, route, OpenAPI change, live envelope creation, database write, provider call, credential payload read, runtime activation, deployment, or merge. Route integration and operation execution remain separate governed work.
