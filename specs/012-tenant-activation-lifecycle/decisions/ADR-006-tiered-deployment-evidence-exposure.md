# ADR-006: Tiered Deployment Evidence Exposure

**Status**: Accepted  
**Date**: 2026-07-22  
**Decision owner**: Platform Admin / API / Security / Operations  
**Resolves**: Q-005

## Context

Tenant Activation diagnosis must distinguish current runtime behavior from requests that reached a stale, deploying, diverged, or unknown runtime. The prior incident demonstrated that a valid OAuth flow can be misdiagnosed as a tenant connection failure when the user request predates the production deployment containing the repair.

Exposing full Git commit SHAs to every public consumer provides precise diagnostics but leaks implementation detail, couples the public API to Git deployment mechanics, and adds unnecessary noise. Keeping all deployment evidence internal prevents the Tenant GPT from providing accurate user guidance without an operator.

## Decision

Adopt tiered deployment evidence exposure based on audience and operational need.

### Tenant/public responses

Expose an opaque release identifier and normalized deployment state when deployment evidence is relevant or explicitly requested:

```json
{
  "deployment": {
    "status": "current",
    "runtime_version": "rel_2026.07.22.3",
    "observed_at": "2026-07-22T15:50:00Z"
  }
}
```

Allowed public deployment states are `current`, `deploying`, `stale`, `diverged`, and `unknown`.

Public responses do not expose repository URLs, branches, full commit SHAs, deployment credentials, provider tokens, host filesystem paths, or internal infrastructure topology.

### Response headers

A bounded opaque release identifier may also be returned in a response header:

```http
Deployment-Revision: rel_2026.07.22.3
Request-Id: req_example
```

Headers are an additional channel and not the sole source of deployment diagnosis because clients may not expose custom headers to the conversation.

### Tenant diagnostic/status operations

Activation operation/status responses may include a deployment block by default when deployment state affects the result, or when the client requests bounded deployment detail such as `include=deployment`.

Example stale classification:

```json
{
  "status": "degraded",
  "current_stage": "deployment_verify",
  "deployment": {
    "status": "stale",
    "runtime_version": "rel_2026.07.22.2",
    "expected_version": "rel_2026.07.22.3",
    "reconnect_required": false,
    "next_action": "Wait for deployment completion and retry."
  }
}
```

### Admin responses

Authorized Admin/service diagnostics may expose full bounded deployment evidence, including GitHub `main` SHA, deployed SHA or release digest, merge SHA where relevant, deployment/release ID, deployment timestamp, environment, health and migration parity, contract/schema version, and authoritative source references.

Admin evidence remains authorization-gated, audited, bounded, and no-secret.

## Exposure levels

1. `none` — request ID only.
2. `opaque` — public release ID and normalized deployment state.
3. `diagnostic` — opaque release ID, deployment state, observation time, expected opaque version, freshness/completeness, and user next action.
4. `admin_full` — full Git/deployment parity evidence for authorized Admin/service principals.

Tenant principals can never receive `admin_full` through questionnaire or registry configuration.

## Dynamic policy integration

ADR-005 may configure bounded deployment-evidence presentation through a versioned `deployment_evidence_exposure_policy`, including endpoint applicability, tenant exposure level, whether detail appears by default or through `include=deployment`, freshness window, classification thresholds, and alert behavior.

Immutable safety bounds prevent tenant/user policy from selecting `admin_full` or exposing raw infrastructure detail.

## Release identifier

The public `runtime_version` is an opaque, non-secret release identifier. Consumers must not depend on its internal format or derive repository state from it.

It must be stable for one deployed runtime revision, change when behaviorally relevant runtime deployment changes, support comparison against an expected opaque release ID, and never serve as authorization, idempotency, or resource authority.

## Classification rules

- `current`: deployed runtime matches the expected reviewed release and required health/contract checks.
- `deploying`: a newer reviewed release is in progress and parity has not converged.
- `stale`: the observed runtime is older than the expected reviewed release.
- `diverged`: deployed evidence does not match an authorized release lineage or expected environment state.
- `unknown`: required evidence is unavailable, incomplete, stale beyond freshness, or contract-invalid.

Historical request evidence remains tied to the runtime observed at that request and is not rewritten by later deployment convergence.

## Error and user-guidance policy

- Deployment mismatch never produces OAuth reconnect guidance.
- `stale` or `deploying` normally returns `202` or `503` according to operation contract and retryability.
- `diverged` may require operator intervention and fail closed for sensitive mutations.
- `unknown` discloses incomplete evidence rather than claiming current parity.
- Public errors include stable codes and `requestId`.

## Architecture boundaries

- Infrastructure adapters collect GitHub, deployment/runtime, migration, health, and contract-version observations.
- Application services correlate observations with operation/request time and classify deployment state.
- Domain policy controls exposure level, freshness, and user guidance.
- Interface layers map opaque, diagnostic, or admin evidence into responses.
- Route handlers do not directly query deployment providers or decide exposure policy.

## Consequences

### Positive

- Tenant GPT can diagnose stale runtime without exposing full Git internals.
- Users are not told to reconnect for deployment lag.
- Admins retain detailed parity evidence for recovery and audit.
- Public contracts remain independent of Git SHA implementation details.
- Exposure can grow dynamically within immutable audience boundaries.

### Costs and risks

- Requires generation and propagation of a stable opaque release identifier.
- Requires request-time correlation with deployment observations.
- Header/body/admin evidence can drift unless they share one source.
- Opaque identifiers must not be mistaken for security or global ordering guarantees.

## Rejected alternatives

### Full SHA in every response

Rejected because it exposes implementation detail and couples the public contract to Git.

### SHA in headers only

Rejected as the sole solution because clients may not expose custom headers to user-visible logic.

### Internal-only deployment evidence

Rejected because it prevents the Tenant GPT from distinguishing stale runtime from authorization, membership, or provider failure without operator intervention.

## Implementation constraints

- Public schemas use `runtime_version`, not `git_sha`.
- Full SHA fields appear only in Admin-authorized contracts.
- `requestId` remains independently available.
- Deployment metadata is additive and optional except when deployment state is the classified failing stage.
- Expected/current comparison uses authoritative observations, not caller input.
- Evidence includes observation time, freshness, and completeness.
- Dynamic questionnaire policy cannot grant higher exposure than the principal's immutable maximum.

## Verification

Required verification includes public `none`, `opaque`, and `diagnostic` shapes; Admin-only `admin_full`; tenant denial for `admin_full`; consistent header/body release ID; all five deployment classifications; request-time historical correlation; no reconnect guidance for deployment mismatch; `unknown` for incomplete evidence; no full SHA/branch/repository/path/credentials/secrets in tenant responses; and OpenAPI/runtime/policy/test parity.
