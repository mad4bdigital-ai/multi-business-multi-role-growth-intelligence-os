# Source Consolidation Map

## Purpose

Prevent the dynamic governance implementation from creating duplicate authorities. Every source is assigned one role: canonical authority, transitional authority, projection, compatibility input, evidence, or diagnostic.

## Authority map

| Concern | Canonical/target authority | Transitional or compatibility input | Not authority |
|---|---|---|---|
| Capability identity | `platform_plugin_capabilities` plus source links | `platform_semantic_capabilities`, action/skill/tool identities | UI labels, route names |
| Semantic operation | canonical capability profile | semantic capability operation/resource fields | provider operationId alone |
| Endpoint execution | active canonical `endpoints` row and action binding | `platform_endpoint_aliases`, imported OpenAPI rows pending review | caller method/URL/header |
| Provider binding | capability/provider and dispatch binding registries | app action/tool bindings | adapter self-selection |
| Runtime policy | `execution_policies` during transition; target policy rules after parity cutover | tags and specialized policy registries | display metadata |
| Actor/tenant | signed principal, membership, relationship authority | explicit Admin scope | caller-supplied tenant/user override |
| Resource authority | capability-specific effective resource binding | legacy grants mapped with evidence | unrelated active binding |
| Credential usability | governed connection/binding lifecycle | specialized credential readiness ledgers | presence of a credential-like value |
| Approval | approval request/decision and invocation envelope links | existing typed holds | free text or stale approval |
| Certification | generic certification registry | specialized smoke/runtime certifications linked explicitly | endpoint status alone |
| Readback | capability readback contract and evidence | specialized readback policies linked explicitly | HTTP 2xx alone |
| Projection | derived Admin/Tenant projection policy and reconciliation | existing tool/export rows during migration | catalog visibility as authority |
| Operational state | typed gaps, debt, evidence, alert lifecycle | execution-log failure inputs | dashboard badge alone |

## Precedence rules

1. Authenticated actor and tenant scope are resolved before capability lookup.
2. Canonical capability identity is resolved before surface-specific policy.
3. Explicit canonical profile outranks inferred tags and method.
4. Surface policy may add restrictions only.
5. Capability-specific resource authority outranks generic active grants.
6. Current validated connection and credential scope outrank primary/display preferences.
7. Current generic certification outranks specialized status after source-link reconciliation; until then both required sources must agree for cutover cohorts.
8. Readback contract is capability-specific and versioned.
9. Projection eligibility does not grant execution.
10. Any unresolved conflict yields a typed blocking gap.

## Consolidation rules

### Semantic capability foundation

`platform_semantic_capabilities` remains a valid semantic source. Each row must map to one canonical capability source link. Duplicate semantic rows cannot create duplicate executable capability identities.

### Capability assurance graph

Generic evidence, certification, provenance, authority, and debt surfaces remain canonical. Specialized tables feed them through adapters or source links and are retired only after parity evidence.

### Tool catalogs

Admin and Tenant tool tables remain public descriptor stores. They are generated/reconciled from approved projections but are never read as the sole execution authority.

### Policy tags

Tags remain useful discovery metadata. They may trigger conservative requirements but cannot satisfy mutation, approval, certification, or readback requirements by themselves after target policy profiles are available.

### Hard-coded evaluators

Existing provider/tool-specific evaluators remain compatibility wrappers during shadow parity. Their semantics are migrated into declarative profiles or bounded domain evaluators. Removal requires usage, parity, rollback, and closeout evidence.

## Conflict classes

- `CAPABILITY_IDENTITY_MISSING`
- `CAPABILITY_IDENTITY_AMBIGUOUS`
- `CLASSIFICATION_CONFLICT`
- `POLICY_SOURCE_CONFLICT`
- `RESOURCE_AUTHORITY_CONFLICT`
- `PROVIDER_BINDING_AMBIGUOUS`
- `PROJECTION_AUTHORITY_DRIFT`
- `CERTIFICATION_SOURCE_CONFLICT`
- `READBACK_CONTRACT_CONFLICT`

All conflict classes are fail-closed for execution and create capability debt.
