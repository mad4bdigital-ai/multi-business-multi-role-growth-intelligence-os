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

Evidence authority is `platform_evidence_events`. Envelope evidence and resource bindings are linked through `platform_capability_envelope_evidence_links` and `platform_capability_envelope_binding_links`. Evidence must preserve freshness, revocation, supersession, payload hashes, and bounded no-secret metadata.

Authority requirement types are:
- `none`
- `invocation`
- `resource`
- `approval`
- `quota`
- `combined`

Admin or Tenant exposure alone does not create permanent external-resource authority requirements. External resource mutation requires an effective resource binding. Destructive or high-risk execution may additionally require approval, quota, readback, and rollback evidence.

Readiness must be evaluated as independent dimensions through `v_platform_capability_readiness_vector`; a single maturity score must not override a failed hard gate. Typed operational gaps are read from `v_platform_capability_assurance_gaps`.

Generic certification authority is `platform_capability_certifications`. Persistent unresolved gaps are tracked in `platform_capability_debt`, and closure lifecycle state is tracked in `platform_closure_threads`.

Capability provenance is resolved through `platform_capability_source_links`, `platform_capability_source_resolutions`, and `repo_capability_candidates`. Source resolution must preserve source kind, reference, commit/hash when available, resolution state, and confidence.

`platform_capability_assurance_reconcile` is dry-run by default. Apply requires a fresh `ready_for_dispatch` capability envelope, performs SQL registry/evidence/debt upserts only, performs no provider calls or external writes, and must verify readback.

Secret movement traceability uses `platform_secret_movement_ledger`. Only source and target references, target field, value hash, policy, actor, reason, status, and readback hash may be stored. Plaintext secret material is forbidden.
