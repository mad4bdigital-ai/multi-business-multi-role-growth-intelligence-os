# Spec 015 Phase 1 Owner Decision Matrix

## Status

```text
T008 = decision-ready, pending owner approval
Phase 1 authorized = false
runtime mutation authorized = false
```

Machine-readable companion:

```text
phase1-owner-decision-matrix.json
```

This matrix exists so Phase 1 implementation cannot quietly make product, persistence, security, privacy, commercial, agency, knowledge, model, or external-integration decisions while writing code.

## Decisions proposed for owner approval

### 1. Package authority

Use current authorities first:

```text
platform_private_packages
platform_package_versions
platform_private_package_assets
```

New persistence is allowed only for proven Product semantics that cannot be represented safely by bounded extension. A complete parallel `solution_package_*` authority is not the default.

### 2. Generic Component model

A Component layer is permitted only as a thin typed identity/composition layer referencing canonical assets.

It must not copy Agent, Skill, Workflow, Policy, Plugin, App or Logic payloads into a second source of truth.

### 3. Installation Revision

`tenant_package_installs` remains the installation identity/lifecycle root unless owner review proves otherwise.

The likely bounded semantic gap is an immutable revision child that pins:

```text
package version
exact target scope refs
component version refs
configuration snapshot
requirement bindings
lineage
revision vector
content hash
```

Legacy JSON fields such as `agent_grants_json` and `policy_overrides_json` remain compatibility inputs only.

### 4. Authorization / policy boundary

Package and Installation payloads declare requirements and references.

They never become the final permission decision.

Runtime path remains:

```text
requirement
 -> exact principal/resource/context
 -> capability/policy/grant resolution
 -> approval where required
 -> execution envelope
 -> dispatch/readback
```

### 5. Data governance

Before consequential autonomy, minimum P0 controls are:

```text
data classification
processing purpose
retention
region/residency
legal hold
deletion propagation into derived data
minimal audit retention separation
```

Cross-Tenant raw examples and silent retention of deleted embeddings are prohibited.

### 6. Knowledge and provenance

Canonical knowledge and provenance are distinct from retrieval projections.

```text
Canonical Knowledge / Provenance
  -> authorized immutable Context Snapshot
  -> vector / lexical / search projections
```

Vector storage is rebuildable and never becomes canonical authority.

### 7. Model governance

Model selection follows:

```text
registered task/capability
 -> hard policy/data/region/risk/tool/output gates
 -> evaluation/readiness floors
 -> eligible candidates only
 -> optimization
 -> candidate-specific commercial reservation
```

Fallback cannot weaken a hard gate.

### 8. Commercial / FinOps

Execution economics follow:

```text
Estimate -> Reserve -> Execute -> Verify -> Settle -> Adjust/Refund
```

A balance check without reservation is insufficient for parallel Agents.

### 9. Agency/client ownership

Treat these ownership dimensions separately:

```text
Package IP
Installation
Client business data
Brand knowledge
Files
Connections
Deliverables
Derived insights
```

Delegation never silently changes membership or ownership.

### 10. Portability/offboarding

A client or agency relationship ending must not strand the operating system.

Required lifecycle:

```text
freeze consequential new effects
 -> export
 -> transfer/rebind
 -> revoke delegation
 -> revoke/rebind connections
 -> retention/legal hold
 -> erasure where applicable
 -> completion evidence
```

Credentials are never exported.

### 11. External protocols

MCP or future external agent protocols remain transport/projection adapters:

```text
external principal
 -> authenticated transport
 -> focused Tool/Operation projection
 -> Context Kernel
 -> capability/policy
 -> governed execution/readback
```

No external protocol gets its own execution kernel.

### 12. Human approval

Consequential approval is bound to an exact frontier, not a broad session.

It includes exact plan/context/resources/effects/limits/expiry and may require separation of requester/approver/executor for high-risk operations.

### 13. Content Intelligence reference package

Content Intelligence remains a staged architecture fitness package:

```text
CI-0 Research / Knowledge / Blueprint / Internal Draft
CI-1 Governed WordPress Draft + readback
CI-2 Approved/Scheduled Publish
CI-3 Bounded Low-Risk Auto Publish
CI-4 Performance -> Improvement Candidate -> Eval -> Promotion
```

It may not skip Package foundation, provenance, model/budget policy, certified provider binding, idempotency or readback.

## What T008 approval would mean

Approval would authorize **bounded Phase 1 implementation PR design** only.

It would not authorize:

```text
migration apply
provider writes
Production deployment
protected-branch mutation
external publication
permission broadening
```

T008 therefore stays unchecked until owner approval is explicit and exact-head CI is clean.
