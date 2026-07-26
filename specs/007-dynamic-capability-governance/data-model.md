# Data Model

## Rule: no second canonical capability table

The implementation MUST not introduce a new competing canonical capability authority. `platform_plugin_capabilities` remains the canonical assurance-graph capability identity. `platform_semantic_capabilities` is linked through explicit provenance/source mappings until a separately verified consolidation cutover.

## Existing authorities reused

| Concern | Existing authority |
|---|---|
| Canonical capability graph | `platform_plugin_capabilities` and source links |
| Semantic capability contracts | `platform_semantic_capabilities` |
| Provider implementation | `platform_capability_provider_bindings` |
| Endpoint aliases | `platform_endpoint_aliases` |
| Tool/endpoint dispatch | `platform_tool_dispatch_bindings`, endpoint exports |
| Policies | `execution_policies`, target policy registries/rules |
| Invocation evidence | `capability_resolution_envelope_ledger` |
| Resource authority | resource authority requirements and effective bindings |
| Certification | `platform_capability_certifications` and explicit specialized source links |
| Evidence | `platform_evidence_events` and envelope evidence links |
| Debt | `platform_capability_debt`, closure threads |
| Secret movement | hash/reference-only secret movement ledger |

## Proposed additive objects

Physical names remain subject to live census and collision review.

### `platform_capability_governance_profiles`

Declarative static classification and requirement overrides for canonical capabilities.

Key fields:

```text
profile_id
canonical_capability_id
profile_version
effect_class
risk_class
resource_type
exposure_policy
base_requirements_json
classification_source
status
created_at
updated_at
```

Unique identity: capability + profile version. Surface overrides are stored separately and may only strengthen requirements.

### `platform_capability_surface_overrides`

Strict bounded overrides for one surface alias/binding.

```text
override_id
canonical_capability_id
surface_family
surface_key
additional_requirements_json
exposure_restriction
reason
expires_at
status
```

The compiler rejects any override that weakens the base profile.

### `platform_capability_compilation_runs`

```text
run_id
source_revision_vector_json
source_count
manifest_count
gap_count
status
started_at
completed_at
compiler_version
input_hash
output_hash
secrets_included
```

### `platform_capability_compiled_manifests`

```text
manifest_id
canonical_capability_id
manifest_version
manifest_hash
source_revision_vector_json
classification_json
requirements_json
binding_summary_json
projection_summary_json
rollout_mode
status
valid_from
superseded_at
```

Manifests are immutable. A new source revision creates a new version.

### `platform_capability_projection_policies`

Defines Admin/Tenant exposure constraints, safe schema references, and projection rollout state. It does not grant actor/resource authority.

### `platform_capability_readback_contracts`

```text
contract_id
contract_key
contract_version
canonical_capability_id
verification_type
input_schema_json
observed_state_schema_json
provider_binding_constraints_json
certification_status
status
created_at
expires_at
```

### `platform_capability_manifest_source_links`

Many-to-many provenance from compiled manifests to source rows, revisions, and source hashes.

## Proposed views

- `v_platform_capability_compilation_input`
- `v_platform_capability_compiled_readiness`
- `v_platform_capability_governance_gaps`
- `v_admin_capability_projection_candidates`
- `v_tenant_capability_projection_candidates`
- `v_platform_capability_projection_reconciliation`
- `v_platform_capability_readback_readiness`

## Manifest structure

```json
{
  "manifestId": "id",
  "canonicalCapabilityId": "content.article.create_draft",
  "manifestVersion": 4,
  "effectClass": "external_write",
  "riskClass": "C",
  "resourceType": "content_article",
  "requirements": {
    "scopeGuard": true,
    "resourceBinding": true,
    "validatedConnection": true,
    "approvalMode": "per_request_or_policy_bounded",
    "capabilityEnvelope": true,
    "idempotency": true,
    "certification": true,
    "readback": true,
    "audit": true
  },
  "projection": {
    "admin": "eligible",
    "tenant": "cohort_gated"
  },
  "rolloutMode": "shadow",
  "sourceRevisionVector": {},
  "manifestHash": "sha256"
}
```

## Lifecycle

```text
draft -> shadow -> canary -> active
                 \-> disabled
active -> stale -> recertified | disabled
any nonterminal -> revoked
```

Compiled manifests use `current`, `superseded`, `invalid`, or `revoked`. Historical manifests and evidence are never deleted by normal lifecycle operations.

## Indexing and scale

- Keyset pagination for source and gap scans.
- Index canonical capability, status, effect/risk, rollout mode, and updated revision.
- JSON is bounded and never used as the only join authority.
- High-volume execution evidence remains append-only and partition/retention policy is separate from governance authority.
- Compilation runs use advisory locks and checkpoints; overlapping apply runs are denied.

## Secret policy

No proposed table stores raw credentials, authorization headers, provider tokens, unrestricted request payloads, or provider response bodies. References and hashes only.
