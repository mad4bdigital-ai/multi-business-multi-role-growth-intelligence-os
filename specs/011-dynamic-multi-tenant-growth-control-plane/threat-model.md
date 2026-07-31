# Threat Model

## Assets

- tenant, workspace, brand, and activity data;
- Brand Core and evidence;
- configuration and policy authority;
- capability, workflow, logic, and knowledge definitions;
- provider credentials and resource bindings;
- approvals, plans, runs, outputs, and readback;
- audit and operational evidence.

## Trust boundaries

1. User/client to authenticated API.
2. API to application/domain services.
3. Domain services to MySQL/cache/queue.
4. Runtime to provider adapters and external systems.
5. Admin control plane to tenant-safe projections.
6. Event producers to consumers.
7. Generated UI to backend contracts.

## Threats and required controls

### T-01 Cross-tenant object access

An actor supplies another tenant or brand ID.

**Controls:** signed tenant/user context, resource containment checks, SQL scope predicates, no caller tenant override, denial before credential/resource access, isolation tests.

### T-02 Alias or display-name authority escalation

A route, UI key, or alias is treated as capability authority.

**Controls:** canonical IDs and semantic capability resolution; aliases only aid discovery.

### T-03 Configuration injection

A user stores code, SQL, prompt injection, unknown fields, or unsafe expressions.

**Controls:** strict JSON Schema, bounded rule operators, `additionalProperties:false`, size limits, sanitization, no executable code in DB.

### T-04 Security weakening by override

A lower scope enables a write or removes approval.

**Controls:** deny-wins/most-restrictive merge, immutable platform controls, policy compiler tests, change preview.

### T-05 Workflow graph abuse

A graph creates cycles, unbounded fan-out, hidden provider writes, or incompatible data flow.

**Controls:** DAG compiler, explicit effect classes, node/edge limits, schema compatibility, provider nodes explicit, draft-only generation.

### T-06 Credential leakage

Credentials appear in configuration, events, logs, manifests, errors, or evidence.

**Controls:** credential references only, redaction, response allowlists, no-secret schemas, secret scanners, adapter-time resolution.

### T-07 Confused deputy provider write

A workflow valid for one brand writes to another brand's resource.

**Controls:** dynamic resource authority, brand/resource bindings, final-boundary revalidation, target resource in approval and idempotency key.

### T-08 Approval replay or overbreadth

An old approval is reused for another plan, resource, or environment.

**Controls:** request hash, plan/action/resource IDs, effect class, environment, expiry, typed confirmation, one-time or bounded use.

### T-09 Stale cache after revocation

A cached permission or policy survives a revocation.

**Controls:** event-driven invalidation, security cache version, short bounded TTL, final-boundary checks.

### T-10 Duplicate dispatch

Retries or concurrent workers write twice.

**Controls:** idempotency keys, uniqueness, leases, compare-and-set transitions, provider idempotency where supported, outbox.

### T-11 Unknown provider effect

Timeout occurs after the provider may have applied a change.

**Controls:** inspect/reconcile, no blind retry, readback contract, partial/unknown effect state, operator remediation.

### T-12 Malicious Activity Pack or adapter

A package claims broad compatibility or hides unsafe effects.

**Controls:** schema and security review, certification, code review for executors/adapters, fixtures, tenant eligibility, cohort rollout.

### T-13 Event spoofing or replay

A forged or duplicated event triggers projections or actions.

**Controls:** internal authenticated transport, event registry/schema, aggregate revision, idempotency key, consumer dedupe, no event grants authority.

### T-14 UI-only authorization

A hidden button is considered sufficient access control.

**Controls:** backend authorization and validation for every operation; UI manifests are presentation only.

### T-15 Analytics leakage

Portfolio aggregation exposes another tenant or sensitive raw data.

**Controls:** tenant-scoped queries, normalized projections, field allowlists, minimum aggregation policy where needed, no raw cross-tenant export.

### T-16 Denial of service through configuration or graph size

Huge manifests, rules, or DAGs exhaust resources.

**Controls:** payload, depth, node, edge, fan-out, query, and execution limits; rate limits; compilation timeouts; quotas.

### T-17 Supply-chain or version substitution

An active pointer changes to an unreviewed schema, workflow, logic, or adapter version.

**Controls:** immutable versions, approval, checksum, expected revision, signed release evidence, source links, rollback.

### T-18 Audit tampering

A run or approval is modified after the fact.

**Controls:** append-only transitions/evidence, immutable snapshots, hashes, restricted mutation paths, reconciliation.

## Abuse cases

- Tenant user attempts to select platform-owned resource without grant.
- Brand editor changes production approval policy through a brand override.
- Workflow author encodes a provider write as an internal artifact capability.
- Adapter resolver receives two equal top candidates.
- Operator retries after timeout without effect reconciliation.

All abuse cases fail closed with bounded reason codes and no secret disclosure.
