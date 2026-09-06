# Spec 015 Phase 1 Owner Decision Matrix

## Status

```text
T008 = owner approved
Phase 1 bounded implementation PR design = authorized
runtime mutation authorized = false
```

Owner approval was recorded on `2026-09-06` for all thirteen recommended decisions in this matrix. This approval authorizes bounded Phase 1 implementation PR design only. It does not authorize migration apply, provider writes, Production deployment, protected-branch mutation, external publication, permission broadening, or any live runtime effect.

Machine-readable companion:

```text
phase1-owner-decision-matrix.json
```

## Approved decisions

### 1. Package authority
Use current authorities first: `platform_private_packages`, `platform_package_versions`, and `platform_private_package_assets`. New persistence is allowed only for proven Product semantics that cannot be represented safely by bounded extension. A complete parallel `solution_package_*` authority is prohibited by default.

### 2. Generic Component model
A Component layer is permitted only as a thin typed identity/composition layer referencing canonical assets. It must not copy Agent, Skill, Workflow, Policy, Plugin, App or Logic payloads into a second source of truth.

### 3. Installation Revision
`tenant_package_installs` remains the installation identity/lifecycle root. An immutable revision child may be introduced only for a proven storage gap and bounded schema review. It may pin package version, exact target refs, component refs, configuration snapshot, requirement bindings, lineage, revision vector, and content hash. Legacy grant/policy JSON remains compatibility-only.

### 4. Authorization / policy boundary
Package and Installation payloads declare requirements and references. They never become the final permission decision. Runtime remains principal/resource/context -> capability/policy/grant -> approval where required -> execution envelope -> dispatch/readback.

### 5. Data governance
Before consequential autonomy, P0 controls are data classification, processing purpose, retention, region/residency, legal hold, deletion propagation into derived data, and minimal audit-retention separation. Cross-Tenant raw example reuse and silent retention of deleted embeddings are prohibited.

### 6. Knowledge and provenance
Canonical knowledge/provenance is separate from vector, lexical, cache and search projections. Runtime model context must come from an authorized immutable context snapshot; derived indexes are rebuildable and non-authoritative.

### 7. Model governance
Model selection is capability-first, policy-gated, and evidence-ranked. Hard data/region/risk/tool/output/evaluation/readiness/commercial gates cannot be weakened by fallback.

### 8. Commercial / FinOps
Execution economics follow `Estimate -> Reserve -> Execute -> Verify -> Settle -> Adjust/Refund`, with tenant/workspace/brand/activity/package/operation/model/provider attribution. Parallel Agents require reservation, not a balance check alone.

### 9. Agency/client ownership
Package IP, Installation, client business data, Brand knowledge, files, connections, deliverables and derived insights are independent ownership dimensions. Delegation does not silently become membership or ownership.

### 10. Portability/offboarding
Required lifecycle is freeze consequential new effects -> export -> transfer/rebind -> revoke delegation -> revoke/rebind connections -> retention/legal hold -> erasure where applicable -> completion evidence. Credentials are never exported.

### 11. External protocols
MCP and future external agent protocols remain transport/projection adapters over focused Tool/Operation projections, Spec 012 Context Kernel, and Spec 011 governed execution/readback. No protocol-specific execution kernel is authorized.

### 12. Human approval
Consequential approval is plan/context/resource/effect/limit/expiry bound and may require separation of requester/approver/executor for high-risk operations. Approval never executes the effect itself.

### 13. Content Intelligence reference package
Content Intelligence remains staged:

```text
CI-0 Research / Knowledge / Blueprint / Internal Draft
CI-1 Governed WordPress Draft + readback
CI-2 Approved/Scheduled Publish
CI-3 Bounded Low-Risk Auto Publish
CI-4 Performance -> Improvement Candidate -> Eval -> Promotion
```

It may not skip Package foundation, provenance, model/budget policy, certified provider binding, idempotency or readback.

## Exact-head CI attestation boundary

Exact-head CI remains an external attestation bound to the candidate Git SHA. The candidate tree does not claim that it has passed its own checks.

```text
exact_head_ci.required = true
exact_head_ci.attestation_location = external
exact_head_ci.binding = candidate_head_sha
exact_head_ci.source_tree_may_self_attest = false
```

Every new implementation candidate still requires its own external exact-head evidence.

## T008 closure boundary

T008 is complete as an **owner decision task**. `phase1_authorized=true` means the approved architecture may now be used to design bounded implementation PRs. `runtime_mutation_authorized=false` remains mandatory.

The approval does not approve a specific migration or a specific new table. Any persistence addition still requires a proven semantic gap, schema review, compatibility/rollback path, exact-head CI, and the relevant implementation evidence.
