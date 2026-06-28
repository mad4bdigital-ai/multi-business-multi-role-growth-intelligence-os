# Adapter Contract and Certification

## Purpose

Define how provider-specific implementations satisfy a canonical capability without becoming authorization authority.

## Adapter role

An adapter translates one canonical capability version into one provider or internal execution surface. It does not decide tenant scope, grants, approval, or policy.

## Required interface

```text
describe()
preflight(executionContext, normalizedRequest)
execute(executionContext, normalizedRequest, idempotencyIdentity)
readback(executionContext, expectedEffect, providerReference)
compensate(executionContext, executionEvidence) optional
```

## describe

Returns bounded metadata:

```json
{
  "adapterKey": "wordpress-rest-publisher",
  "adapterVersion": "5.2.0",
  "capabilityKey": "content.wordpress.publish",
  "capabilityVersions": [3],
  "providerFamily": "wordpress",
  "supportsIdempotency": true,
  "supportsReadback": true,
  "supportsCompensation": false,
  "readbackContractKey": "wordpress-post-state@4",
  "sensitiveValuesIncluded": false
}
```

## preflight

Preflight is side-effect-free and verifies:

- adapter version compatibility;
- capability input compatibility;
- connection and credential-reference readiness;
- tenant, workspace, brand, and resource binding;
- provider limits and required fields;
- expected readback strategy;
- idempotency support;
- request size and content constraints;
- provider-specific risk or policy obligations.

Preflight MUST NOT publish, mutate, spend, deploy, send, or decrypt credentials into a response.

## execute

Execution receives an already enforced execution context. The adapter MUST still validate:

- envelope identity and current dispatch reservation;
- adapter key and version match;
- tenant and resource scope match;
- normalized request hash match;
- idempotency identity match;
- credential reference scope match.

The adapter MUST NOT choose a broader credential, tenant, resource, or capability on its own.

## execute result

The immediate result is bounded acknowledgement evidence, not final verification:

```json
{
  "acknowledged": true,
  "providerRequestRef": "bounded-or-hashed-ref",
  "resourceRef": "provider-resource-ref",
  "retryClassification": "not_retryable_without_readback",
  "sensitiveValuesIncluded": false
}
```

## readback

Readback MUST use a capability-specific contract and return:

- observed resource reference;
- observed revision;
- normalized observed state hash;
- verification level;
- mismatch reason codes;
- bounded evidence references;
- observation timestamp.

It MUST NOT return credentials or unrestricted provider payloads.

## compensation

Compensation is optional and capability-specific. It requires a new authorization decision unless the original approved operation explicitly included bounded compensation authority.

Compensation never deletes or rewrites original execution evidence.

## Binding record

```json
{
  "bindingId": "binding-id",
  "capabilityKey": "content.wordpress.publish",
  "capabilityVersion": 3,
  "adapterKey": "wordpress-rest-publisher",
  "adapterVersion": "5.2.0",
  "providerFamily": "wordpress",
  "rolloutMode": "shadow | canary | active | fallback | disabled",
  "priority": 100,
  "certificationStatus": "certified",
  "certificationExpiresAt": "ISO-8601",
  "selectionConditions": {},
  "status": "active"
}
```

## Deterministic selection

Eligible adapters are filtered by:

1. canonical capability and version;
2. tenant and resource scope;
3. rollout mode;
4. certification validity;
5. connection and credential readiness;
6. typed selection conditions;
7. environment and provider policy;
8. explicit stable priority and tie-breaker.

If more than one candidate remains at the same highest rank and no approved tie-breaker exists, selection fails with `ADAPTER_BINDING_AMBIGUOUS`.

Database row order is never a tie-breaker.

## Rollout modes

### shadow

Adapter may run preflight and compare normalized outputs, but cannot perform provider mutation.

### canary

Adapter may execute only for an explicitly bounded tenant, workspace, resource set, or percentage cohort after all enforcement gates pass.

### active

Adapter is the primary eligible implementation.

### fallback

Adapter is considered only when no higher eligible active implementation remains and fallback policy permits it.

### disabled

Adapter cannot be selected or executed.

## Certification requirements

An adapter is certified only after evidence for:

- contract schema compatibility;
- input validation;
- tenant and resource scope enforcement;
- credential-reference isolation;
- timeout and retry behavior;
- idempotency behavior;
- provider-error normalization;
- readback correctness;
- sensitive-data redaction;
- concurrency behavior;
- shadow parity;
- rollback or compensation classification;
- bounded operational metrics.

Certification is version-specific and expires or becomes stale after material code, dependency, provider-contract, permission, or readback changes.

## Certification states

```text
draft
under_test
certified
certification_expiring
stale
revoked
disabled
```

`stale`, `revoked`, and `disabled` cannot execute state-changing operations.

## Certification evidence

```json
{
  "adapterKey": "wordpress-rest-publisher",
  "adapterVersion": "5.2.0",
  "capabilityVersion": 3,
  "testRunId": "run-id",
  "contractHash": "sha256",
  "codeRevision": "git-sha",
  "providerContractRevision": "provider-revision",
  "readbackContractVersion": 4,
  "result": "pass",
  "certifiedAt": "ISO-8601",
  "expiresAt": "ISO-8601"
}
```

## Failure normalization

Adapters translate provider-specific failures into stable internal categories:

```text
authentication_failed
authorization_failed
resource_not_found
resource_revision_conflict
rate_limited
provider_unavailable
timeout_unknown_effect
validation_failed
quota_exceeded
unsupported_operation
readback_mismatch
```

Raw provider stack traces and credential-bearing payloads are not returned to clients.

## Circuit breaking

Repeated provider or adapter failures may open a circuit. An open circuit changes adapter readiness but does not automatically authorize fallback. The resolver must issue a new current decision against the fallback candidate set.

## Version compatibility

Compatibility between capability and adapter versions is explicit. A major provider or adapter change requires recertification. Approval reuse across adapter versions is disabled by default.

## Adapter isolation

Provider SDKs, HTTP clients, retry code, serialization, and credential transport stay in the infrastructure layer. Domain authorization logic does not import provider SDK types.
