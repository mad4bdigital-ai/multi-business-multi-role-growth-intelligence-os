# Observability and SLOs

## Structured decision evidence

Every resolution and execution emits bounded structured evidence with:

```text
request_id, trace_id, tenant_id, workspace_id, brand_id,
activity_binding_id, plan_id, run_id, capability_key,
workflow_version, config_snapshot_id, policy_snapshot_id,
selected_adapter, gate results, reason codes, duration,
result classification, readback status
```

Credentials, tokens, raw provider secrets, and unrestricted payloads are excluded.

## Core metrics

### Resolution

- context resolution success/block rate;
- configuration resolution latency and conflict rate;
- capability/workflow/adapter ambiguity rate;
- stale revision and schema validation failures;
- cache hit and invalidation latency.

### Execution

- plans compiled and blocked by reason;
- runs by environment/effect/status;
- approval wait and expiry rate;
- dispatch attempts and idempotency reuse;
- provider success/failure/timeout/unknown-effect rate;
- readback success and latency;
- rollback and recovery rate.

### Isolation and security

- cross-scope denial count;
- revoked-grant dispatch prevention;
- secret-redaction violations;
- policy weakening attempts;
- certification or resource-authority gaps.

### Control-plane health

- active/draft/blocked versions;
- projection drift and reconciliation age;
- event/outbox backlog;
- invalidation failures;
- feature cohort distribution.

## Proposed SLOs

Initial targets require validation at implementation time:

- 99.9% availability for read-only catalog and effective configuration reads.
- 99.5% availability for internal plan compilation.
- 99.9% of security-relevant revocations reflected at final execution boundary immediately; cache invalidation p95 under 30 seconds.
- effective configuration resolution p95 under 250 ms on cache hit and under 1 second on bounded cold resolution.
- workflow compilation p95 under 2 seconds for graphs within supported limits.
- 99.9% of completed mutations have required same-cycle readback evidence.
- zero tolerated cross-tenant data or credential disclosure.

## Alerts

Critical:

- cross-tenant access anomaly;
- provider mutation without valid approval/resource/certification/readback;
- active pointer corruption or duplicate active canonical identity;
- secret detected in response/event/log;
- unknown effect followed by automatic retry.

High:

- invalidation backlog beyond threshold;
- projection drift beyond freshness SLO;
- adapter ambiguity spike;
- policy/config conflict spike;
- readback failure above threshold.

## Tracing

A trace spans context resolution, configuration/policy/capability/workflow selection, plan compilation, approval, dispatch, and readback. Provider calls use child spans with normalized status and no secret headers or bodies.

## Audit and reconciliation

Reconciliation compares active pointers, published versions, projections, cache revisions, queued work, grants, approvals, provider receipts, and readback. Drift produces typed findings and never silently repairs high-risk authority.

## Dashboards

Admin dashboards show global registry health, blocked versions, drift, SLOs, cohorts, and security gaps. Tenant dashboards show tenant-safe brands, activities, plans, approvals, runs, readback, and effective settings. Tenant views do not expose platform-internal policy payloads or other tenants.
