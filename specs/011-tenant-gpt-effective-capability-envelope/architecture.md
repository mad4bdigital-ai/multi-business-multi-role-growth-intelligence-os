# Architecture

## Ownership boundaries

This feature is a composition layer, not a competing authority.

- Spec 007 owns canonical capability identity, governance manifests, projections, certification, and enforcement.
- Spec 009 owns operation lifecycle, persistence, approval, idempotency, resume, execution, and readback.
- Resource context registries own resource graph resolution.
- `business_activity_type_registry` owns Business Activity resolution.
- Connection and credential registries own connection metadata and credential references.
- Provider and Local Manager adapters remain infrastructure concerns.

The new layer owns natural-language intent interpretation, context inheritance, ECE projection, schema-driven questionnaires, contradiction detection, customer-safe response projection, and operation handoff.

## Layering

```text
src/api
  Tenant conversation routes and DTO validation
      ↓
src/application
  ResolveTenantIntent
  BuildEffectiveCapabilityEnvelope
  GenerateQuestionnaire
  BuildOperationPreflight
  ResumeBlockedConversationOperation
      ↓
src/domain
  intent ranking
  readiness vector
  evidence precedence
  contradiction policy
  projection/redaction policy
  questionnaire state machine
      ↓
src/infrastructure
  resource-context adapter
  governance-manifest adapter
  connection/readiness adapter
  schema-discovery adapter
  operation-orchestrator adapter
  support-continuity adapter
```

Routes do not query registry tables directly and do not call providers.

## Decision pipeline

1. Authenticate principal.
2. Resolve authorized Workspace.
3. Resolve Brand or ask bounded clarification.
4. Resolve Business Type and Business Activity.
5. Expand the authorized resource graph.
6. Interpret natural-language intent into candidate canonical capabilities.
7. Filter by Tenant exposure and activity/resource compatibility.
8. Resolve exact app/provider/resource/connection candidates.
9. Evaluate readiness vector and freshness.
10. Compile ECE candidates from the current governance manifest.
11. Run contradiction detection.
12. Select one safe candidate, ask clarification, or return blockers.
13. Generate questions from the verified action schema.
14. Build mutation preview and approval requirements.
15. Hand off to the operation orchestrator.
16. Perform readback and update conversation/support continuity.

## Evidence precedence

```text
same-cycle provider/runtime evidence
> unexpired verified provider evidence
> current governance and authority registries
> verified indexed non-sensitive metadata
> Brand Core and Business Activity context
> general inference
```

Lower tiers may improve discovery but cannot override denial, stale evidence, exact resource binding, or schema verification.

## ECE structure

The ECE contains only no-secret references and projections:

- subject scope reference;
- Workspace, Brand, resource type/key, and trusted aliases;
- Business Activity key;
- app, provider, exact connection reference, and connection scope;
- canonical capability, projected tool/action, effect, and risk;
- readiness dimensions and freshness;
- input schema key/version/fingerprint;
- authority, approval, idempotency, quota, audit, and readback requirements;
- callable state and public blockers;
- request/context/manifest hashes and expiry.

Execution re-resolves all referenced authorities and revisions.

## Readiness model

Each dimension uses `unknown | not_configured | pending | valid | invalid | stale | inaccessible | not_applicable`.

`operation_ready=valid` only when every applicable dimension is valid:

```text
configured
AND credentials_present
AND authorized
AND reachable
AND schema_verified
AND governance_callable
AND resource_binding_valid
AND approval_state_valid_for_requested_mode
```

Preview may remain available while apply is blocked.

## Questionnaire lifecycle

```text
created
→ context_resolving
→ capability_candidates_ready
→ clarification_required | schema_resolving
→ collecting_fields
→ preflight_ready
→ awaiting_approval | executable
→ executing
→ readback_pending
→ verified | blocked | failed | unknown_outcome | cancelled | expired
```

Answers are bounded non-sensitive values or opaque references. Schema fingerprint changes invalidate only impacted fields.

## Contradiction engine

The engine returns `allow`, `suppress_already_satisfied`, `suppress_conflicts_with_live_state`, `replace_with_safer_action`, or `clarification_required`.

Mandatory initial rules:

- healthy enabled device exists → suppress install/reinstall;
- Brand grant requested but only Workspace invitation available → suppress widened invitation;
- direct publish requested but only draft authority exists → replace with draft option;
- operation already verified → suppress duplicate execution;
- exact resource/connection mismatch → block;
- indexed evidence stale → require revalidation.

## Customer-safe projection

Allowed output includes localized labels, public resource references, callable state, public blocker codes, freshness, required action, bounded preview, and durable detail references.

Forbidden output includes SQL/table names, raw graph IDs, policy rows, credential payloads, foreign-Tenant references, stack traces, provider payloads, and secret hints beyond safe status.

## Idempotency, retry, and performance

- Mutation idempotency binds actor, resource, action, normalized input hash, and operation intent.
- Repeated confirmed requests return the existing operation.
- `unknown_outcome` permits readback/reconciliation only.
- Retry refreshes the ECE and preserves valid questionnaire context where policy permits.
- Intent ranking and resource expansion are bounded.
- Indexed evidence accelerates discovery but not final apply decisions.
- Provider/schema probes use declared timeouts and freshness policies.
- Large diagnostics return summaries plus durable detail references.
