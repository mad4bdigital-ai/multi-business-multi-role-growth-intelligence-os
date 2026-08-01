# Convergence Architecture

## 1. Architectural decision

The Tenant Operating System Studio is a product layer over existing platform authorities. It does not create another workflow engine, another tenancy model, another permission model, or another provider runtime.

```text
Tenant Studio UI / Agent
        ↓
Package Authoring Application Services
        ↓
Package Compiler and Compatibility Resolver
        ↓
Existing registries and authorities
  ├─ Spec 006 assets/workflows/runtime
  ├─ Spec 011 control-plane registries and effective settings
  ├─ Spec 012 Context Kernel
  ├─ Dynamic Container Authority
  ├─ capability/policy/approval/resource authority
  ├─ connectors and certified adapters
  ├─ unified frontend surface catalog
  └─ observability/release governance
        ↓
Immutable Package Version / Installation Revision
        ↓
Generated tenant-safe runtime surfaces and governed execution
```

## 2. Stable kernel versus tenant-authored data

### Stable kernel owns

- authentication and principal resolution;
- Tenant/Workspace/Brand/resource context;
- authorization, policy, approval, certification, quotas, and effect classification;
- schema validation and bounded expression evaluation;
- lifecycle and workflow execution primitives;
- idempotency, outbox, callbacks, retries, compensation, and readback;
- file/provider adapter boundaries;
- audit, logs, metrics, retention, backup, and rollback coordination;
- registry publication and immutable version pointers.

### Tenant-authored definitions may contain

- strict schemas and metadata;
- references to eligible capabilities and adapters;
- lifecycle states and bounded guards;
- workflow graphs using certified step types;
- UI manifests and report definitions;
- file classification and routing rules;
- AI use-case and structured-output references;
- sample data, tests, documentation, and runbooks.

### Tenant-authored definitions may not contain

- arbitrary executable code;
- raw SQL, shell, JavaScript, provider calls, or unrestricted templates;
- credentials, tokens, signed URLs, authorization headers, or grants;
- implicit Tenant/Brand/resource selection;
- policy bypasses or hidden production effects.

## 3. Package resolution chain

```text
Platform mandatory policy and component eligibility
→ Tenant package publication policy
→ Business Operating Profile and activity constraints
→ Package definition and immutable version
→ installation owner and target scope
→ required component versions
→ sparse installation overrides
→ bounded extensions
→ connection/resource readiness
→ role/capability bindings
→ environment and rollout policy
→ acceptance and migration evidence
→ Effective Installation Revision
```

No step in the chain creates authority. Final execution revalidates current principal, resource, connection, capability, policy, approval, and expected effect.

## 4. Package/component mapping to current platform

| Studio concept | Existing foundation to reuse |
|---|---|
| Package definition/version | `asset_definitions` / `asset_versions` with package-specific schemas |
| Publication | `asset_publication_policies` plus audience and install modes |
| Installation | `asset_installations` extended with package scope and resolved revision |
| Override | `asset_overrides` and configuration authority |
| Extension | `asset_extensions` and named workflow/package extension points |
| Fork | `asset_forks` with immutable origin lineage |
| Workflow | Spec 006 `workflow_definitions`, versions, steps, edges, compiled plans |
| Effective configuration | Spec 011 resolution snapshots and lineage |
| Ownership graph | Dynamic Container Authority |
| Runtime context | Spec 012 Context Kernel |
| UI surface | Spec 010 surface catalog and dispatch |
| Provider requirement | connection/provider/capability registries and certification |
| Package tests | acceptance-suite registry plus CI/E2E evidence |

The implementation must first prove that these existing records can represent the required semantics. New tables are allowed only for missing package-specific identities, component registries, compatibility, installation revisions, and portability evidence.

## 5. Component model

Every component has:

```text
component_key
component_type
owner_container_ref
schema_version
component_version
normalized_payload
content_hash
compatibility_contract
eligibility_policy
lifecycle_status
created_by / approved_by
secrets_included = false
```

Initial component types:

```text
entity_definition
relationship_definition
form_definition
lifecycle_definition
workflow_definition
file_policy
ai_use_case
ui_surface
report_definition
role_template
connector_requirement
policy_binding
sample_dataset
migration_plan
acceptance_suite
runbook
```

New component types require platform certification and cannot be added by supplying an arbitrary renderer or executor.

## 6. Package compiler

The compiler is deterministic and side-effect free. It:

1. resolves package and component identities;
2. validates JSON Schemas and references;
3. verifies audience and tenant eligibility;
4. detects dependency and lifecycle cycles;
5. resolves Business Profile and Activity Pack applicability;
6. validates entity/form/workflow/lifecycle linkage;
7. validates UI-to-resource and form-to-handler bindings;
8. verifies provider/connection requirements without reading credentials;
9. composes mandatory policies and denies unsafe overrides;
10. validates upgrade/migration compatibility;
11. binds test and runbook requirements;
12. emits a normalized effective installation plan, lineage, conflicts, revision vector, and SHA-256 hash.

Compiler output is proposal/evidence. Activation is a separate governed operation.

## 7. Runtime isolation

All durable runtime data uses exact scope keys:

```text
tenant_ref
workspace_ref
brand_ref when applicable
installation_ref
installation_revision
resource_ref
```

Queues, caches, search indexes, embeddings, file roots, reports, and metrics must include compatible scope and revision keys. A package key alone is never a runtime partition.

## 8. Agency/client topology

### Model A — clients as Brands in one agency Tenant

```text
Tenant: Agency
└─ Workspace: Delivery
   ├─ Brand: Client A
   ├─ Brand: Client B
   └─ Brand: Client C
```

Each Brand has independent installation, data, files, connections, permissions, budgets, and approvals.

### Model B — client-owned Tenant with delegated agency operation

```text
Tenant: Client
└─ Workspace / Brand / Package Installation
   └─ delegated agency principal/resource grants
```

Delegation is a typed authority relationship, not ownership transfer. Removing delegation does not retire the package or business data.

## 9. AI architecture

AI is used in two distinct modes:

- **authoring assistance:** propose package/component drafts, mappings, tests, documentation, and migration notes;
- **package operation:** execute explicitly declared use cases through provider abstraction and structured schemas.

Both modes treat provider output as untrusted. AI cannot publish, activate, grant, delete, share, spend, deploy, or select hidden scope.

## 10. Upgrade architecture

Upgrade uses three-way resolution:

```text
installed origin version
+ target package version
+ installation overrides/extensions
→ compatibility and conflict report
→ migration/sample-data/acceptance plan
→ proposed installation revision
→ approval
→ activation and readback
```

A package publisher cannot silently rewrite installations or forks.

## 11. Portability architecture

A governed export contains:

- package and component canonical refs/versions;
- tenant-owned component payloads when exportable;
- installation configuration and lineage;
- data/file inventory references and classifications;
- provider/connection requirement descriptors, never credentials;
- non-transferable dependency report;
- schema/migration versions;
- content hashes and provenance.

Import performs trust, compatibility, ownership, scope, policy, and conflict validation before creating a draft installation.

## 12. Rollout architecture

```text
disabled
→ authoring_internal
→ sandbox
→ shadow
→ pilot
→ tenant_canary
→ broader_tenant
→ production
```

Each transition binds exact package/installation revisions and acceptance evidence. Rollback disables new effects first, preserves records/evidence, restores a prior working revision, and verifies manual operation or fallback.