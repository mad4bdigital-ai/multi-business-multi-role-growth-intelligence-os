# Testing and Parity Strategy

## Purpose

Prove authorization safety, deterministic behavior, tenant isolation, approval integrity, replay resistance, adapter correctness, readback quality, and migration parity before enforcement rollout.

## Test taxonomy

### Domain unit tests

Cover pure rules without databases, queues, or providers:

- active grant plus required approval yields `ready_requires_approval`;
- active grant is never reclassified as pending because approval is required;
- hard deny wins over allow;
- expired or revoked grant denies;
- changed request hash makes approval stale;
- changed revision vector makes envelope stale;
- equal highest-ranked adapters produce ambiguity;
- conditional decision is not dispatchable;
- provider acknowledgement is not verified success.

### Policy tests

Every policy version has fixtures for:

- intended allow;
- intended deny;
- conditional result and obligations;
- missing attributes;
- invalid attribute types;
- deny precedence;
- boundary values;
- unsupported operation;
- policy-version incompatibility.

Policy publication is blocked if required fixtures fail.

### Relationship tests

- direct membership;
- nested containment;
- delegated agent authority;
- expired relationship;
- cross-tenant edge rejection;
- cycle detection;
- maximum-depth enforcement;
- unsupported relation inheritance;
- deterministic path choice;
- revision invalidation.

### State-machine tests

Generate and test all legal transitions and reject illegal transitions for grants, approvals, envelopes, executions, and verification.

Examples:

```text
required -> approved -> consumed
required -> expired
ready_for_dispatch -> dispatch_reserved -> consumed
expired -> approved must fail
consumed -> ready_for_dispatch must fail
verified -> pending must fail
```

### Property-based tests

Properties hold across generated combinations:

1. Alias presence never grants authority.
2. Cross-tenant resource access never allows.
3. Request-hash changes never reuse approval.
4. Adapter-version changes never reuse an envelope.
5. A hard deny is never overridden.
6. A consumed envelope has at most one successful dispatch.
7. Identical normalized input and revisions yield identical decisions.
8. No public decision, approval, envelope, execution, or evidence response contains credential material.
9. Derived readiness is a function of source states only.
10. Projection state cannot authorize execution.

### Repository integration tests

- tenant-scoped reads and writes;
- unique constraints for aliases and idempotency identities;
- immutable decision and approval records;
- transaction rollback;
- optimistic concurrency conflicts;
- outbox creation in the same transaction as authority mutation;
- reconciliation checkpoint leasing;
- cursor pagination stability.

### Enforcement integration tests

Exercise the full internal path:

```text
request
-> canonical resolution
-> decision
-> envelope
-> approval
-> PEP freshness validation
-> idempotency reservation
-> adapter preflight
-> dispatch
-> evidence
-> readback
```

Test every blocking gate separately.

### Concurrency tests

- two workers attempt to consume one envelope;
- two approval decisions arrive concurrently;
- grant revocation races with dispatch;
- adapter certification revocation races with dispatch;
- idempotency reservation races;
- readback races with retry;
- compensation races with reconciliation;
- projection rebuild overlaps source updates.

Expected result: at most one state-changing dispatch wins, and every losing operation receives a stable conflict or stale-state error.

### Provider contract tests

Each adapter uses deterministic fixtures or a governed sandbox to test:

- request serialization;
- timeout behavior;
- retry classification;
- provider-specific idempotency;
- rate-limit parsing;
- authentication versus authorization errors;
- resource revision conflicts;
- readback normalization;
- sensitive-data redaction;
- partial-success handling.

### Failure-injection tests

Inject failures at:

- relationship lookup;
- grant lookup;
- policy load;
- adapter registry read;
- approval persistence;
- queue submission;
- provider request before and after possible mutation;
- readback;
- evidence persistence;
- reconciliation checkpoint update.

The system must fail closed for authority failures and preserve uncertainty for possible external effects.

## Shadow parity model

For each pilot request record:

```json
{
  "legacyDecision": "allow | deny | approval_required | error",
  "adaptiveDecision": "allow | deny | conditional | error",
  "legacyReasonClass": "bounded-code",
  "adaptiveReasonCodes": ["bounded-code"],
  "capabilityKey": "canonical-key",
  "resourceClass": "bounded-resource-type",
  "revisionVectorHash": "sha256",
  "requestShapeHash": "sha256",
  "providerMutationPerformed": false
}
```

No raw payload, prompt, credential, or unrestricted resource identifier is stored in parity evidence.

## Mismatch matrix

| Legacy | Adaptive | Risk | Required action |
|---|---|---:|---|
| allow | allow | low | verify reason and obligations |
| deny | deny | low | verify reason compatibility |
| approval required | conditional | expected | verify obligation equivalence |
| allow | deny | medium | classify legacy over-permission or adaptive false deny |
| deny | allow | critical | block rollout and investigate privilege expansion |
| error | decision | medium | classify dependency and availability behavior |
| decision | error | high | fix adaptive reliability before rollout |

Every mismatch receives one category:

```text
expected_semantic_translation
legacy_bug_detected
adaptive_bug_detected
missing_relationship_mapping
missing_grant_mapping
policy_difference
alias_difference
adapter_difference
stale_source
unsupported_operation
test_fixture_error
```

## Pilot acceptance thresholds

Thresholds require explicit approval. Recommended minimum before canary:

- 100% cross-tenant denial tests pass;
- 100% replay and stale-envelope tests pass;
- 100% critical `legacy deny / adaptive allow` mismatches resolved;
- at least 99.9% deterministic decision repeatability;
- no credential leakage findings;
- all state-changing pilots have idempotency and readback;
- no unresolved ambiguous adapter selection;
- bounded decision latency meets approved SLO;
- reconciliation lag remains within policy.

A global parity percentage alone is insufficient.

## Pilot-specific tests

### activation.skills.read

- active grants remain active;
- approval-gated active grants counted separately;
- admin/global grant visibility is correct;
- brand filters do not hide platform authority incorrectly;
- projection revision is visible.

### platform.output-artifact.write

- policy-dependent approval;
- idempotency conflict behavior;
- row/hash readback;
- transaction rollback;
- duplicate worker protection.

### content.wordpress.publish

- no provider mutation in shadow mode;
- brand and site authority;
- credential-reference scope;
- draft versus publish policy;
- request-bound approval;
- provider timeout with uncertain effect;
- post resource readback;
- adapter substitution denial;
- external high-impact rollout remains blocked until certification.

## Test manifest

Implementation tests must be explicitly registered in the repository test manifest or governed CI configuration. Unregistered tests do not count as release evidence.

## Evidence requirements

A passing test run records:

- code revision;
- policy and schema revisions;
- test manifest hash;
- environment;
- test counts;
- failures and skips;
- sensitive-data scan result;
- timestamp and run ID.

## Exit gate

Shadow mode can advance only when all critical tests pass, mismatch categories are resolved, security review is complete, and rollback/readback evidence is approved.
