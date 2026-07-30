# Logical Data Model

## 1. Principles

- SQL remains the primary dynamic authority.
- Migrations are additive first.
- Existing tables are reused where semantics fit.
- No credential values are copied.
- Decision records store references and hashes, not secrets.
- Every mutable authority source exposes a revision.

## 2. Logical entities

### Principals and roles

- `principals`
- `principal_role_assignments`
- `principal_authentication_evidence`
- existing authoritative user and service-principal registries

### Subject and scope

- `scope_grants`
- `delegation_contexts`
- `agency_tenant_assignments`
- existing memberships and workspace roles

### Resource graph

- `resource_nodes`
- `resource_edges`
- `resource_access_grants`
- `resource_restrictions`

Suggested edge fields:

```text
edge_id, source_resource_id, relation_type, target_resource_id,
inheritance_policy_key, valid_from, valid_until, revision, status
```

### Capability and policy

- existing semantic-capability registries
- existing capability/provider bindings
- `capability_operation_policies`
- `capability_risk_classes`
- `authority_policy_versions`

### Connections and runtime

- existing user/app connections
- existing workspace/app links
- existing action grants
- existing endpoint aliases
- existing runtime certification registry
- `connector_readiness_snapshots`

### Decisions and projections

- `effective_authority_decisions`
- `authority_decision_evidence`
- `authority_projection_snapshots`
- `authority_projection_items`
- `authority_drift_findings`
- `authority_invalidation_events`

## 3. Effective decision record

Minimum safe fields:

```text
decision_id
actor_principal_id
subject_scope_type
subject_scope_ref_hash
capability_key
operation
resource_type
resource_ref_hash
decision_state
reason_codes_json
version_vector_json
manifest_sha256
evaluated_at
expires_at
consumed_at
execution_ref
audit_ref
secrets_included = false
```

Tokens, keys, credential bodies, and raw provider authentication payloads are forbidden.

## 4. Connector readiness snapshot

```text
system_id
subject_scope_hash
registry_status
authorization_status
configuration_status
installation_status
credential_status
connectivity_status
certification_status
freshness_status
execution_readiness
blocked_reason_codes_json
source_versions_json
evaluated_at
```

## 5. Delegation context

```text
delegation_id
actor_principal_id
subject_tenant_id
subject_workspace_id
mode
allowed_operations_json
reason_code
ticket_ref
created_at
expires_at
revoked_at
approved_by
status
```

Delegation never replaces actor identity and cannot silently broaden operations.

## 6. Views

- `v_effective_authority_inputs`
- `v_authorized_resource_candidates`
- `v_connector_readiness_dimensions`
- `v_authority_projection_consistency`

Views aggregate evidence but do not override code-level invariants.

## 7. Indexing concerns

Index active grants by principal/scope/capability; graph edges by source/target/relation/interval; connections by tenant/workspace/app/status; certifications by surface/action/status/expiry; decisions by actor/subject/capability/resource/expiry; drift findings by lifecycle and severity.

Avoid unbounded recursive graph queries on request paths. Use bounded relation policies and measured closure strategies.
