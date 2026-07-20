# Policy, Provider, UI, Events, and Rollout Model

## Policy model

Policies are versioned declarative definitions evaluated by a bounded policy compiler. They may select values, impose requirements, or deny an operation. They cannot execute code or grant authority by themselves.

Initial condition operators:

```text
equals, not_equals, in, not_in, exists,
less_than, less_than_or_equal, greater_than,
greater_than_or_equal, contains_all
```

Initial effects:

```text
require_approval
require_typed_confirmation
require_resource_authority
require_certification
require_readback
require_rollback
limit_resources
limit_concurrency
limit_budget
force_environment
force_provider_write_false
deny
```

Security effects combine with deny-wins or most-restrictive semantics. Equal-priority contradictory policy outcomes block with `POLICY_AMBIGUOUS`.

### Approval profiles

Approval profiles declare actor roles, separation-of-duties requirements, expiry, request hash, target scope, effect class, resource count, environment, and whether approval may be delegated. Approval of an internal draft cannot authorize provider mutation.

### Policy decision output

```json
{
  "decision": "allow_with_requirements",
  "requirements": [],
  "denials": [],
  "matched_policy_versions": [],
  "reason_codes": [],
  "decision_sha256": "..."
}
```

## Provider abstraction

Workflows request semantic operations such as `content.draft.create` or `analytics.read`. The adapter resolver selects an implementation only after scope, compatibility, readiness, certification, credential, quota, and rollout checks.

Every adapter exposes:

- `describeCapabilities`
- `validateRequest`
- `checkReadiness`
- `prepareDispatch`
- `dispatch`
- `inspect`
- `cancel` where supported
- `readback`
- `normalizeError`
- `normalizeResult`

Provider adapters never receive credentials from configuration payloads. They resolve governed credential references at dispatch time.

### Adapter ranking

Deterministic ranking considers exact tenant/brand/resource binding, activity/channel compatibility, certification, environment, health, rollout, explicit preference, and stable tie-breakers. Equal top rank blocks.

### Effect handling

```text
no_effect          -> safe to retry under idempotency contract
confirmed_effect   -> continue to readback and terminal transition
unknown_effect     -> reconcile or inspect only
partial_effect     -> recovery/rollback workflow
```

## Dynamic UI manifests

UI manifests reference schemas and bounded components such as text, number, boolean, select, multi-select, date, code-free rule builder, graph viewer, diff viewer, evidence table, and approval panel.

A manifest declares:

- audience: Admin or Tenant;
- resource and operation;
- schema version;
- sections and fields;
- data sources by canonical registry key;
- visibility rules using bounded operators;
- field-level permission hints;
- change preview and readback views.

The backend remains authoritative. Hidden fields are not an authorization mechanism, and unknown fields are rejected.

## Events

Events use a typed envelope:

```json
{
  "event_id": "uuid",
  "event_type": "configuration.version.activated.v1",
  "tenant_id": "uuid-or-null",
  "workspace_id": "uuid-or-null",
  "brand_id": "uuid-or-null",
  "activity_binding_id": "uuid-or-null",
  "aggregate_id": "uuid",
  "aggregate_revision": 12,
  "occurred_at": "ISO-8601",
  "idempotency_key": "...",
  "payload": {},
  "payload_schema_version": 1
}
```

Events are no-secret, versioned, idempotent, and emitted through an outbox. Consumers include cache invalidation, projection rebuild, readiness refresh, analytics, notifications, and audit.

## Feature flags and rollout

Feature decisions support platform, tenant, workspace, brand, activity binding, user cohort, and percentage scopes. The resolver stores the cohort decision in the plan snapshot.

Supported modes:

```text
off
shadow
allowlist
percentage
canary
general_availability
hard_disabled
```

Rollback activates an earlier compatible version or hard-disables the feature. Rollout never bypasses capability, policy, resource, approval, or provider gates.

## Cache and invalidation

Cache keys include tenant, workspace, brand, activity binding, config key, schema version, active version IDs, and revision vector. Activation, rollback, binding change, grant revocation, provider degradation, and policy change emit invalidation events.

Security-relevant revocations bypass ordinary TTL and trigger immediate invalidation and final-boundary revalidation.

## Portfolio analytics

Activity-native KPI definitions map to normalized portfolio categories while retaining native key, unit, definition version, source, confidence, freshness, and lineage. Portfolio comparison never merges raw data across tenants and never assumes two activity metrics are equivalent solely because their display names match.
