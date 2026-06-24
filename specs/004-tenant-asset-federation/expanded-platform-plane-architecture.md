# Expanded Platform Plane Architecture

## 1. Architectural objective

The platform is not one policy engine. It is a set of independently governed planes that contribute evidence to a deterministic Context Compiler. Each plane keeps its own source of truth, lifecycle, permissions, versioning, and rollback.

```text
Signed principal + normalized request
                   │
                   ▼
       Identity and Organization Plane
                   │
                   ▼
     Tenant Federation and Lifecycle Plane
                   │
                   ▼
       Blueprint and Layer Inheritance Plane
                   │
                   ▼
     Context and Resource Authority Plane
                   │
                   ▼
          Policy Composition Plane
                   │
                   ▼
         Preference and Variant Plane
                   │
        ┌──────────┼──────────┐
        ▼          ▼          ▼
 Data Governance  FinOps   Model Governance
        │          │          │
        └──────────┼──────────┘
                   ▼
       Knowledge and Provenance Plane
                   │
                   ▼
        Runtime Orchestration Plane
                   │
        ┌──────────┼──────────┐
        ▼          ▼          ▼
 Connection/    Human       Resilience/
 Provider       Operations  Recovery
 Readiness
        └──────────┼──────────┘
                   ▼
       Effective Runtime Manifest
                   │
             ready or blocked
                   │
                   ▼
     Exact governed dispatch and readback
                   │
                   ▼
          Outcome and Adaptive Growth
```

## 2. Plane responsibility matrix

| Plane | Owns | Must not own |
|---|---|---|
| Identity and Organization | principal identity, group membership, service ownership, assurance, delegation | tenant asset content or provider credentials |
| Tenant Federation and Lifecycle | tenant relationships, ownership transfer, suspension, offboarding, export, legal hold, erasure | implicit cross-tenant access |
| Context and Resource Authority | containers, roles, resource bindings, authority epochs | user preference or commercial pricing |
| Policy Composition | typed fields, operators, mandatory floors, conflict behavior | asset copies or credential payloads |
| Preference and Variant | personal ranking and explicit sparse customization | grants, quotas, mandatory-policy weakening |
| Data Governance | purpose, classification, consent, residency, retention, legal hold, disposition | operational grant expansion |
| Commercial and FinOps | entitlement, quota, estimate, reservation, settlement, attribution | safety classification or hidden upsell ranking |
| Model Governance | model capability, eligibility, evaluation, fallback, deprecation | tenant secrets or final tool authority |
| Knowledge and Provenance | artifacts, lineage, verification, freshness, reuse rights | unverified authority changes |
| Runtime Orchestration | idempotency, events, retries, cancellation, compensation, concurrency | policy definition or credential ownership |
| Connection and Provider Readiness | eligible connection, installation, certification, provider health | authority bypass or preference |
| Human Approval and Operations | queue, SLA, approver availability, separation of duties, escalation | permanent grant inference from approval history |
| Resilience and Recovery | backup, restore, disaster mode, RPO/RTO, recovery validation | widening authority during degradation |
| Adaptive Growth | evidence attribution, proposals, simulation, experiment, calibration, promotion candidates | silent mutation of authority or provider state |

## 3. Manifest contribution contract

Each plane contributes a bounded result:

```json
{
  "planeKey": "model_governance",
  "status": "passed",
  "sourceVersion": "model-policy-v12",
  "observedAt": "2026-06-24T00:00:00Z",
  "expiresAt": "2026-06-24T00:05:00Z",
  "decision": {
    "eligibleModelKeys": ["model_a"],
    "selectedModelKey": "model_a"
  },
  "blockingCodes": [],
  "evidenceRefs": ["evaluation:eval_123"],
  "secretsIncluded": false
}
```

Required properties:

- deterministic for the same normalized input and versions;
- source authority and version;
- observed/expiry time;
- passed, blocked, unavailable, or not-applicable state;
- safe decision summary;
- blocking/recovery codes;
- no-secret evidence references;
- checksum contribution.

A plane never returns raw credentials, private cross-tenant content, or hidden model reasoning.

## 4. Fail-closed matrix

| Plane unavailable | Read-only discovery | Preview | Consequential execution |
|---|---|---|---|
| Identity/tenant/context authority | unavailable or safely restricted | blocked | blocked |
| Mandatory policy | safely denied | blocked | blocked |
| User preference | platform/default ordering | allowed with degraded label | allowed if all authority/readiness passes |
| Variant | shared base if variant is optional and safely ignorable | allowed with explanation | block if selected variant affects required runtime behavior |
| Data governance | metadata-only safe display at most | blocked for content processing | blocked |
| Commercial/FinOps | show unavailable estimate | allowed only for no-cost/no-reservation operations | cost-bearing execution blocked |
| Model governance | no model execution | candidate preview may be unavailable | model execution blocked |
| Provenance | catalog metadata may remain | content/result preview degraded | publication/promotion or sensitive reuse blocked |
| Orchestration | static read only | no durable operation creation | blocked |
| Connection/provider | catalog remains visible | readiness blocked | blocked |
| Human operations | no approval creation | approval route unavailable | approval-required execution blocked |
| Resilience | normal mode may continue if no incident | degraded label | block only when recovery policy or current incident requires it |
| Adaptive growth | no recommendation | normal runtime unaffected | normal governed execution unaffected |

## 5. Effective decision pipeline

```text
1. Authenticate principal
2. Resolve principal/group/service identity
3. Resolve tenant and federation relationship
4. Validate tenant lifecycle state
5. Resolve container graph, role, and resource authority
6. Select composition profiles and typed policy atoms
7. Apply optional variants and user preferences
8. Evaluate data classification, purpose, residency, and retention
9. Evaluate entitlement, quota, estimate, and reservation requirement
10. Resolve eligible models and evaluation evidence
11. Resolve artifacts/knowledge provenance and freshness
12. Create or validate universal runtime operation semantics
13. Resolve connection, installation, certification, and provider health
14. Resolve approval queue, approver availability, SLA, and separation of duties
15. Evaluate resilience/degraded-mode policy
16. Build and persist immutable Effective Runtime Manifest
17. Revalidate authority/time/environment/cost versions
18. Dispatch exact registered operation or return typed block
19. Verify external/internal readback
20. Attribute cost, quality, artifact, and business outcome
21. Feed no-secret evidence to adaptive proposal lifecycle
```

## 6. Context dimensions versus authority planes

A dimension identifies where a rule applies. A plane identifies who owns the decision.

Examples:

- `brand` is a context dimension; Brand Core and resource bindings remain in their owning authorities.
- `production` is an environment dimension; credential and approval eligibility remain separate planes.
- `Egypt` may be a jurisdiction/market dimension; data governance and localization own the consequences.
- `user preference` is a layer but never an authority plane for grants.
- `model` is an implementation candidate; model governance determines eligibility while action authority determines tool use.

## 7. Cross-plane version vector

The manifest binds a version vector rather than one global configuration number:

```text
principal_version
+ tenant_lifecycle_version
+ authority_epoch
+ composition_profile_versions
+ policy_semantics_version
+ preference_version
+ variant_versions
+ data_governance_version
+ entitlement_and_budget_version
+ model_policy_and_evaluation_version
+ provenance_version
+ operation_contract_version
+ connection_and_certification_versions
+ approval_policy_version
+ resilience_policy_version
+ resolver_version
```

Any contributing change invalidates only affected manifests/caches through registered dependency events.

## 8. Recovery actions

Blocking responses expose no more than three prioritized recovery actions. Recovery ranking considers safety, authority, value, effort, human capacity, cost, and reversibility.

Examples:

- complete exact connection validation;
- request role/resource delegation;
- select an eligible regional model;
- approve a cost reservation;
- resolve artifact provenance conflict;
- wait for scheduled policy effective time;
- switch to a certified compatible package version;
- request an available backup approver;
- run read-only preview instead of write.

## 9. Implementation boundary

The Context Compiler consumes plane interfaces through application ports. Domain logic remains framework-independent. Infrastructure adapters translate SQL registries, caches, queues, vault references, provider health, and evaluation stores into typed evidence.

```text
src/api/contextCompiler
src/application/contextCompiler
src/domain/contextCompiler
src/infrastructure/contextCompiler

src/domain/planes/<plane>
src/application/planes/<plane>
src/infrastructure/planes/<plane>
```

Controllers do not compose plane decisions directly, and provider adapters do not decide authority.

## 10. Design constraints

- no plane may silently infer an allow from missing evidence;
- commercial restrictions cannot be presented as safety policy;
- personalization cannot become authority;
- model quality cannot replace exact tool/action authority;
- tenant relationships cannot weaken isolation;
- degraded mode cannot widen access;
- cross-tenant learning cannot expose raw tenant content;
- restoration cannot revive revoked authority without current validation;
- compatibility adapters are versioned and temporary;
- production writes require a current manifest whose applicable P0 planes passed.