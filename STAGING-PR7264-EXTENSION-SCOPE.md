# PR #7264 Extension Scope

## Source

The attached architecture audit argues that capabilities are fragmented across Custom GPT, System Layer, Legacy MCP, Remote MCP, Resource API, Growth Control Plane, REST routes, and Frontend. The proposed source of truth is a canonical Business Operation Registry / Capability Graph, with Custom GPT, MCP, REST, Frontend, and internal agents treated as generated projections.

## Safe scope for the current PR

The current PR is a local Staging and governance PR. The safe extension is therefore a **read-only, deterministic contract layer** rather than a Production mutation or full lifecycle cutover. It should:

1. Define a canonical operation descriptor schema with operation key, domain, lifecycle action, resource type, authority references, effect/risk class, approval/readback/idempotency contracts, revision domains, executor reference, and projection policy.
2. Build a bounded registry inventory from existing runtime descriptors and Remote MCP scope data without changing activation status or executing writes.
3. Generate a Staging parity matrix for Custom GPT, System Layer, Remote MCP, REST, and Frontend, explicitly distinguishing active, shadow, blocked, absent, and intentional exclusions.
4. Preserve `activation_dev.mad4b.com` as blocked and keep Production hostnames and Hostinger outside the Staging projection.
5. Add structural performance gates as contract assertions, not unverified latency claims: known intents must be able to resolve without mandatory `listTools`; no mutation may omit expected revision or required readback; no hard delete may bypass a dependency plan.
6. Add E2E and integrity coverage for deterministic registry/projection generation and no-secret/no-Production leakage.
7. Declare `brand.context.read` as a read-only shadow descriptor and expose a bounded `next_operations` continuation array from the existing Brand create executor without activating a new write path.
8. Record Asset create/readback evidence separately from the missing update/archive/restore CAS contract, so the parity artifact reports the lifecycle gap rather than hiding it behind generic CRUD.

## Deferred scope requiring separate reviewed slices

The following should not be silently implemented as part of a local Staging hardening PR: typed Brand update/deactivate/archive/restore executors; Asset attach/detach/reparent writes; Policy revision kernel; Growth semantic execution; Execution Capsule production cutover; internal dispatch replacement; Archive Outbox writes; Remote MCP internal mutation activation; Custom GPT behavior migration from tool navigation to operation fast path; and any Hostinger, Production DB, Production OAuth, or Cloudflare provider mutation.

## Required semantics for future contracts

The common lifecycle vocabulary should be `create`, `configure`, `validate`, `activate`, `update`, `deactivate`, `archive`, `unlink`, `revoke`, `supersede`, `restore`, and exceptional `purge`. Mutations should use optimistic concurrency (`expected_revision`, `expected_version`, `expected_sha`, or ETag equivalent), require same-cycle readback where declared, and preserve immutable policy/evidence history. Plan-level approvals should bind operation keys, resources, expected revisions, plan hash, context hash, expiry, and write limits.

## Acceptance criteria for the safe extension

The generated registry is deterministic, uses dot-notation keys, contains no secrets, does not activate shadow operations, produces an explicit parity matrix, records intentional exclusions with evidence, exposes `brand.context.read` only as read-only shadow metadata, and reports zero structural performance-gate violations. It keeps Production and `activation_dev` excluded and passes the existing fail-closed E2E, configuration-drift, Remote MCP inventory, OpenAPI, and Staging boundary gates.
