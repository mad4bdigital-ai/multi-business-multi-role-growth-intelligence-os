# Observability, Audit, and Service Objectives

## Correlation identifiers

Every operation carries:

- `request_id`
- `correlation_id`
- `workflow_run_id`
- `workflow_step_run_id`
- `transition_id`
- `outbox_event_id`
- `adapter_dispatch_id`
- external provider receipt reference

Identifiers are non-secret and stable across retries.

## Structured event families

- authority resolution;
- settings resolution;
- workflow compilation and validation;
- approval lifecycle;
- run/step transition;
- claim/lease lifecycle;
- outbox dispatch and delivery;
- adapter readiness/dispatch/inspect/cancel;
- callback verification;
- retry and compensation;
- readback verification;
- asset publication/install/upgrade/fork.

## Required metrics

### Runtime

- runnable queue depth and oldest age;
- claim latency and lease expiries;
- step/run duration by type and adapter;
- transition conflicts;
- retry and dead-letter rates;
- unknown-outcome count;
- compensation count and success rate.

### Adapter

- readiness by state;
- dispatch latency, error, and rate-limit rates;
- callback latency and replay rejection;
- readback coverage, latency, mismatch, and staleness;
- cancellation success.

### Governance

- allow/deny/block decisions by reason;
- approval wait time and expiry;
- override rejection;
- cross-tenant denial count;
- uncertified adapter selection attempts;
- platform-admin tenant access events.

### Asset lifecycle

- catalog discovery/install/activation;
- version pin and upgrade approval;
- compatibility blockers;
- fork drift and security-upgrade debt.

## Initial pilot SLOs

- 99.9% API availability for read and run-control operations.
- 99% of runnable internal steps claimed within 30 seconds.
- Zero known unauthorized duplicate high-risk external effects.
- 99% required readback completed within adapter-specific SLA.
- 100% high-risk completed runs have authority, approval, dispatch, and readback evidence.
- Zero cross-tenant data exposure.

## Alerts

Critical:

- cross-tenant access anomaly;
- unauthorized provider dispatch;
- approval/hash bypass;
- duplicate high-risk external effect;
- missing audit/readback on completed high-risk run;
- callback verification bypass.

High:

- outbox oldest age over SLA;
- unknown-outcome growth;
- repeated lease expiration;
- selected adapter certification expired;
- readback mismatch;
- fork on unsupported security baseline.

## Audit views

Operators need bounded views for complete run timeline, effective authority, effective settings and lineage, adapter selection, approvals and hashes, external receipts/readback, retries/compensation, and asset origin/publication/install/fork lineage.

Audit views never return raw credentials or unrestricted provider payloads.
