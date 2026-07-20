## Capability Assurance Graph

SQL-primary capability assurance follows:

`Capability -> Envelope -> Evidence -> Authority -> Dispatch -> Readback -> Certification`

Static capability metadata declares requirements but never proves a live actor or resource is authorized. A fresh capability envelope is invocation-scoped evidence and must preserve actor, tenant, workspace, operation, selected runtime surface, authority decision, expiry, audit requirements, and `secrets_included=false`.

Canonical capability authority is represented by:
- `platform_plugins`
- `platform_plugin_capabilities`
- `platform_plugin_bindings`
- `platform_plugin_capability_exports`

Compatibility projections remain valid during cutover and must not be removed until canonical parity, dispatch, readback, and rollback evidence pass.

Active virtual governed tools are projected generically from `platform_tool_dispatch_bindings` through deterministic identity, operation, scope, export, provenance, and readback-contract views. Tool aliases never create authority. Missing or conflicting identity, scope, operation class, readback, or source ownership fails closed into persistent capability debt. Virtual Admin surfaces cannot become Tenant projections, and projected state-changing capabilities remain `apply_allowed=0` until generic certification and shadow/canary evidence authorize promotion.

Atomicity modes that perform a bounded mutation, including `single_file_mutation`, `atomic_change_set`, `compound_mutation`, and `transactional_guarded`, must normalize to the same `state_changing` operation family before capability aggregation. Conflicting or unclassified mutation semantics remain blocking debt. Registry tool tags must be normalized from arrays, JSON-array strings, or legacy CSV before preflight policy evaluation.

Virtual-tool alias rows in `platform_plugin_capability_exports` are assurance projections, not runtime dispatch authority. They must remain `shadow` while the canonical capability is blocked or uncertified; only a separately governed certification and promotion flow may mark them active. Admin tool catalog rows and `platform_tool_dispatch_bindings` remain the runtime authority and are not changed by export-shadow reconciliation.

Evidence-backed shadow certification for `github_file_patch_apply` may activate only the canonical `repository_change_set_apply` adapter and certify its current readback contract after consumed write/cleanup envelopes and branch-scoped resource-authority evidence are verified. It must keep the target runtime certification, `apply_allowed`, capability-export status, Tenant projection, and protected-branch authority unchanged; certification issuance itself performs no provider call or external write.

Evidence authority is `platform_evidence_events`. Envelope evidence and resource bindings are linked through `platform_capability_envelope_evidence_links` and `platform_capability_envelope_binding_links`. Evidence must preserve freshness, revocation, supersession, payload hashes, and bounded no-secret metadata.

Authority requirement types are `none`, `invocation`, `resource`, `approval`, `quota`, and `combined`. Admin or Tenant exposure alone does not create permanent external-resource authority requirements. External resource mutation requires a capability-specific effective resource binding. Destructive or high-risk execution may additionally require approval, quota, readback, and rollback evidence.

Readiness must be evaluated as independent dimensions through `v_platform_capability_readiness_vector`; a single maturity score must not override a failed hard gate. Typed operational gaps are read from `v_platform_capability_assurance_gaps`.

Generic certification authority is `platform_capability_certifications`. Persistent unresolved gaps are tracked in `platform_capability_debt`, and closure lifecycle state is tracked in `platform_closure_threads`.

Capability provenance is resolved through `platform_capability_source_links`. SQL registry provenance uses `source_kind=mysql_registry`; repo-derived candidates remain traceable through their specialized repository tables and must not be fabricated from SQL rows.

`platform_capability_assurance_reconcile` is dry-run by default. Apply requires a fresh `ready_for_dispatch` capability envelope, performs SQL registry/evidence/certification/debt upserts only, performs no provider calls or external writes, and must verify readback.

Secret movement traceability uses `platform_secret_movement_ledger`. Only source and target references, target field, value hash, policy, actor, reason, status, and readback hash may be stored. Plaintext secret material is forbidden.

## Dynamic Container Authority Foundation

Dynamic Container Authority begins as an additive SQL-primary registry and pure domain-contract layer. The initial canonical surfaces are `container_type_registry`, `containers`, `container_relationship_type_registry`, `container_relationships`, `container_closure`, `container_classification_type_registry`, `container_classifications`, `container_role_template_registry`, `container_role_template_permissions`, `container_role_assignments`, `container_resource_dimension_registry`, `container_resource_bindings`, and `container_authority_epochs`.

The default topology is Platform → Tenant → Workspace → Brand → Activity / Workflow, but types and allowed parent/child relationships remain registry-driven. Multiple containment parents are allowed only when the child type declares support. Containment cycles, cross-tenant edges, invalid type pairs, ambiguous equal-precedence replacements, and traversal-limit exhaustion fail closed.

Containment, sharing, delegation, reference, and management are distinct relationship classes. Sharing is read-only by default and never implies containment, role inheritance, credential ownership, or write permission. Delegation is a later exact-operation authority layer and cannot exceed the delegator's effective authority. Classifications influence defaults or restrictions but never grant authority by themselves.

Migration `319_sprint69_dynamic_container_authority_foundation.sql` and `dynamicContainerAuthority.js` are foundation-only. They do not change execution ordering, authorize provider calls, read credential payloads, create authenticated clients, or enable runtime enforcement. Runtime integration must begin with a separately reviewed no-secret shadow resolver and legacy-versus-container comparison evidence.
