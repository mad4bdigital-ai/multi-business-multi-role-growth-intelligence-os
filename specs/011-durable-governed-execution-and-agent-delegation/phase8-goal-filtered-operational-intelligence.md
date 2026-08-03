# Phase 8 — Goal-Filtered Operational Intelligence

## Purpose

Phase 8 projects durable operation state and Activation operational attention through the current goal. It answers what blocks this goal, what is a related risk, what is platform-wide, and what is unrelated without flooding the response or discarding diagnostic evidence.

The phase is read-only. It reuses the durable operation snapshots and `buildActivationOperationalIntelligenceEvidence()`; it does not create a second alert store, operation store, route, migration, provider call, or mutation authority.

## T240 — Goal-to-operation correlation

A goal is described by a stable goal id and one or more exact correlation anchors:

- operation keys;
- resource references;
- container keys;
- workspace id;
- Brand keys;
- system ids;
- tags.

Operations correlate through:

- an explicit goal reference;
- exact resource, container, workspace, Brand, or system identity;
- operation-key plus tag pairing;
- a compatible parent/child durable-operation relationship.

Tenant equality alone is insufficient. The kernel does not use fuzzy title or keyword matching because lexical similarity is not operational identity.

The goal state is derived only from linked operations:

- `blocked`;
- `attention_required`;
- `in_progress`;
- `completed`;
- `unknown`;
- `not_started`.

## T241 — Operational attention classification

Every Activation attention item is assigned exactly one class:

### `blocking`

The item has an exact goal or linked-operation relationship and contains a blocking signal, hard blocker, failure, missing requirement, expiry, outage, denial, drift, or stale dependency.

### `related_risk`

The item has an exact goal or linked-operation relationship but is not currently a hard blocker.

### `platform_wide`

The item is explicitly global or platform scoped and has no direct goal relationship. It is visible as a potential environmental risk, not presented as a direct blocker.

### `unrelated`

The item has neither a direct goal relationship nor platform-wide scope. It is counted and preserved by reference but not inlined in the goal summary.

Direct goal relationships take precedence over platform-wide classification.

## T242 — Summary-first bounded projection

The default response contains:

- goal identity and state;
- operation and attention counts;
- bounded blockers and next actions;
- bounded linked operation summaries;
- bounded `blocking`, `related_risk`, and `platform_wide` attention summaries;
- source health and completeness.

Default inline limits are:

- five blocking items;
- four related-risk items;
- three platform-wide items;
- six linked operations;
- eight blockers;
- eight next actions;
- 64 KiB total serialized summary.

Raw operation snapshots, attention evidence, and unrelated items are never placed inline.

## T243 — Full diagnostic preservation

Before projection, every operation and every attention item—including unrelated items—is registered through a governed diagnostic-reference registrar.

Each reference is bound to:

- item kind and id;
- goal subject;
- SHA-256 of the complete payload;
- reviewed source references;
- a governed read tool;
- no-secret boundary.

The projection fails closed when the registrar is unavailable, returns a digest mismatch, returns an invalid reference, or includes secrets. This preserves complete detail without exposing it in the bounded summary.

Degraded Activation sources remain visible in `source_health`; a degraded source never becomes an implicit successful observation.

## Reused authorities

- durable operation and repository automation snapshots;
- Activation subject-scoped operational intelligence;
- Activation attention queue and container graph;
- existing no-secret and tenant-scoping controls;
- governed diagnostic reference storage and read authority.

## Certification

Workflow:

`.github/workflows/spec-011-goal-filtered-operational-intelligence.yml`

The focused tests prove:

- exact primary/supporting operation linkage;
- parent/child propagation with scope compatibility;
- tenant-only non-correlation;
- all four attention classes;
- bounded inline summaries;
- full references for linked and unrelated details;
- degraded source visibility;
- invalid registrar and secret rejection;
- no-operation `not_started` behavior;
- no provider or mutation side effects.

The Spec 011 E2E contract executes the same goal-to-projection journey at `synthetic_runtime` level.

## Safety boundaries

- Read-only output.
- No provider calls.
- No external or internal mutation.
- No Production database write or authorization.
- No deployment or runtime authority change.
- No fuzzy matching.
- No tenant-only correlation.
- No secret fields, values, or inline raw diagnostics.
