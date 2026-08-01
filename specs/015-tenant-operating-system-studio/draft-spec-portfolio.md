# Open Draft Spec and Delivery Portfolio

## Purpose

This document is the human-readable companion to `draft-spec-portfolio.json`.

Observed snapshot:

```text
observed_at: 2026-08-01T15:48:00Z
main_sha: 464c11803d8cb84ba39863c5e55e05f30dbca8da
primary Draft Specs: 12
related open Draft PRs: 22
total classified open Draft PRs: 34
```

The registry provides architecture and delivery awareness. It grants no merge, close, rebase, migration, provider, permission, deployment, or Production authority.

## Identity and classification rules

Canonical portfolio identity:

```text
feature_key + canonical_role
```

Every open Draft PR is classified as one of:

```text
primary Spec
or
related implementation / reconciliation / repair / migration / security / docs / closure PR
```

A numeric Spec number is not a unique identity. The portfolio contains:

- two unrelated Draft Specs numbered `011`;
- three unrelated Draft Specs numbered `014`;
- one `013-system-tool-catalog-v2` feature represented by three competing or helper Draft PRs.

## Architecture map

```text
Foundation doctrine
└── #1898 Shared Asset Fabric and Contextual Platform Planes

Authority and execution kernels
├── #1935 Adaptive Authorization and Execution Governance
├── current Spec 006 Dynamic Workflow Runtime
├── current Spec 011 Dynamic Multi-Tenant Growth Control Plane
└── current Spec 012 Context Kernel

Repository, operation, and tool projection
├── #2284 Governed PR Delivery Orchestration
├── #2949 Database-Driven Operation Fabric
├── #3159 System Tool Catalog v2
└── generic CI assurance extracted from #4432

Infrastructure and recovery
├── #2385 Local Connector Recovery
└── #4386 Hostinger Storage Orchestration

Tenant authoring and assistant products
├── #2950 Tenant GPT Capability Envelope
└── #4456 Tenant Operating System Studio

External integration surface
└── #4460 ChatGPT Plugin and MCP Integration
    └── #4462 read-only feature-flagged adapter

Reference packages and services
├── #3922 Retail Commerce Operations
├── #4432 Evidence Intelligence Operations
├── #4386 Hostinger Storage Operations
└── #2385 Local Connector Recovery
```

## Primary Draft Specs

The comparison values are live snapshots against the recorded `main` SHA.

| PR | Feature key | Canonical role | Mode | Ahead | Behind | Mergeable | Recommended posture |
|---:|---|---|---|---:|---:|---|---|
| #1898 | `004-tenant-asset-federation` | architectural doctrine source | Spec only | 504 | 3248 | No | extract decisions; do not merge umbrella branch |
| #1935 | `006-adaptive-authorization-execution-governance` | authority kernel candidate | Spec only | 3 | 5297 | No | reconcile with current auth/context authorities |
| #2284 | `008-governed-pr-delivery-orchestration` | repository delivery subsystem | Spec only | 2 | 4256 | No | consolidate with current automation and CI assurance |
| #2385 | `009-local-connector-reachability-recovery` | infrastructure recovery subsystem | Spec only | 5 | 3877 | No | rebuild as bounded service/package |
| #2949 | `011-database-driven-operation-fabric` | operation-fabric subsystem | Spec only | 15 | 1873 | No | reconcile complete implementation stack |
| #2950 | `011-tenant-gpt-effective-capability-envelope` | tenant application component | mixed | 13 | 1901 | No | rebuild as Studio assistant components |
| #3159 | `013-system-tool-catalog-v2` | system tool catalog subsystem | mixed | 2 | 1570 | No | select one clean current-main reconstruction |
| #3922 | `014-retail-commerce-operations-growth-os` | reference package source | Spec only | 95 | 278 | Yes | extract generic profile substrate; rebuild Retail Commerce |
| #4386 | `014-governed-hostinger-storage-orchestration` | integration rollup | rollup | 256 | 2 | Yes | bounded Hostinger service/package; keep live effects disabled |
| #4432 | `014-gemini-evidence-intake-automation` | reference package source | Spec only | 43 | 1 | Yes | extract assurance; rebuild Evidence Intelligence |
| #4456 | `015-tenant-operating-system-studio` | portfolio convergence parent | Spec only | 43 | 0 | Yes | maintain package composition and portfolio awareness |
| #4460 | `016-chatgpt-plugin-mcp-integration` | external integration surface | Spec only | 26 | 0 | Yes | canonical ChatGPT/Codex MCP surface; no independent authority |

## Important relationships

### Shared Asset doctrine — #1898

Useful as a decision source for canonical assets, contextual inheritance, policy composition, privacy, FinOps, model governance, durable effects, provenance, portability, recovery, and human operations. It is too broad and stale to become a mergeable universal parent.

### Adaptive Authorization — #1935

Reusable PDP, scoped-grant, approval, PEP, certified-adapter, and capability-specific readback concepts must converge into current capability, Context Kernel, resource, approval, and execution authorities. Studio and external integrations consume these authorities; they do not replace them.

### Repository delivery and assurance — #2284, #2949, #4432

These overlap in drift handling, work packets, exact-candidate evidence, retries, receipts, CI diagnosis, phase governance, and closeout. A single current-main repository delivery and assurance subsystem is preferable to three competing orchestration layers.

### Operation Fabric — #2949

Correct role:

```text
intent / Solution Package component
→ versioned operation contract
→ compiled binding manifest
→ current Context, capability, resource, credential, approval, dispatch, and readback authorities
```

It must not become a second workflow engine or authorization kernel.

### System Tool Catalog v2 — #3159 cluster

The feature projects focused tool metadata through System Layer routes and OpenAPI. It overlaps:

- Operation Fabric tool projection;
- Tenant GPT capability presentation;
- Spec 016 MCP `tools/list` and tool schemas.

The catalog is a discovery/projection contract. It cannot grant permission. Select one current-main implementation, then make Spec 016 consume reviewed focused tools from that canonical source.

### Tenant GPT — #2950

Reusable as Studio assistant components:

- capability and readiness explanation;
- exact resource/connection binding;
- questionnaires;
- contradiction-checked recommendations;
- preview-only planning.

It is not a second Spec 011 kernel and is not the public ChatGPT transport surface.

### ChatGPT Plugin and MCP — #4460

Spec 016 is the canonical external integration surface for ChatGPT and Codex:

```text
authenticated external user
→ Streamable HTTP MCP transport
→ focused reviewed tool catalog
→ Context Kernel resolution
→ capability and policy authorization
→ existing operation/readback authority
```

It consumes:

- current MCP schema/runtime foundations;
- System Tool Catalog projections;
- Operation Fabric and existing operation endpoints;
- Tenant GPT/Studio product metadata where appropriate;
- Context, capability, resource, connection, confirmation, idempotency, and readback authorities.

It does not create a new execution authority. PR #4462 is only the first read-only, feature-flagged implementation wave.

### Reference package and service sources

```text
#3922 → platform.reference.retail_commerce_operations
#4432 → platform.reference.evidence_intelligence_operations
#4386 → platform.reference.hostinger_storage_operations
#2385 → platform.reference.local_connector_recovery
```

Each remains optional and bounded. Provider, credential, resource, approval, and execution authority remains kernel-owned.

## Duplicate identities and feature clusters

### Numeric `011`

| PR | Distinct role |
|---:|---|
| #2949 | operation registry and compiled execution fabric |
| #2950 | Tenant GPT capability discovery and application orchestration |

Neither replaces the current canonical Dynamic Multi-Tenant Growth Control Plane.

### Numeric `014`

| PR | Distinct role |
|---:|---|
| #3922 | Business Profile substrate and Retail Commerce |
| #4386 | Hostinger Storage service/integration rollup |
| #4432 | Evidence Intelligence and CI assurance |

Use semantic feature keys and reconstruct bounded package/service targets.

### Feature `013-system-tool-catalog-v2`

| PR | Role |
|---:|---|
| #3159 | representative mixed Spec/runtime reconciliation |
| #3139 | competing reconciliation candidate |
| #3145 | two-line test-manifest helper |

Required resolution:

```text
compare #3139 and #3159 against current main
→ choose one bounded reconstruction
→ absorb #3145 helper
→ run exact-head CI
→ supersede duplicate branches
```

## Related open Draft PRs

### Operation Fabric delivery train

```text
#3005 registry foundation
→ #3021 repository contracts
→ #3026 binding compiler
→ #3044 immutable manifest persistence
→ #3054 runtime verifier
→ #3070 authority preflight
→ #3083 SQL contract loader/cache
→ #3089 guarded code fallback
→ #3097 immutable run revision pinning
→ #3109 capability lifecycle binding
→ #3119 governed chunk collection
→ #3130 durable lifecycle state
→ #3134 write receipts
```

PR #3160 is a broad later binding-eligibility candidate and must be compared against the original stack and current main. No middle PR should be merged independently.

### Hostinger parallel workstreams

- #4390 contracts: integrated into #4386.
- #4458 and #4459 synthetic adapter provenance corrections: integrated.
- #4455 Tenant Canary hardening: open child PR at the snapshot.
- live provider dispatch, SSH mutation, migration, and Production remain blocked.

### ChatGPT/MCP train

- #4460: canonical specification.
- #4462: feature-flagged read-only runtime adapter.
- remaining gates: OAuth 2.1 conformance, approved tool catalog, Context Kernel binding, public endpoint, Developer mode acceptance, plugin packaging, review, and Production.

### Other related Drafts

| PR | Classification | Relationship and disposition |
|---:|---|---|
| #2030 | security hardening | Admin-control permission floor; revalidate on current main and repair release-readiness blockers |
| #3139 | reconciliation candidate | competing Spec 013 reconstruction |
| #3143 | readiness repair | reconcile with current repository readiness contracts; close if superseded |
| #3144 | migration candidate | re-audit current need/checksum before governed dry run |
| #3145 | test-manifest helper | fold into selected Spec 013 branch |
| #3160 | implementation child | broad Operation Fabric constraints candidate; requires overlap audit |
| #3181 | contract/docs | verify support-ticket tests/OpenAPI are not already on main |
| #4002 | closure workflow | recalculate live Surface queue before running any temporary patcher |
| #4462 | implementation child | Spec 016 read-only MCP wave; flags stay disabled |

The machine-readable registry contains all 22 related Draft entries, including every Operation Fabric child.

## Truthfulness findings

1. #1898 completion head and synchronization claims are stale.
2. #2949 says implementation has not started despite fourteen related implementation candidates, including the original thirteen-PR stack and #3160.
3. #2950 reports no implementation while changing runtime modules and tests.
4. #3159 completion names another branch, records no implementation PRs, and coexists with duplicate reconciliation branches.
5. #3922 describes an older zero-behind state.
6. #4386 completion predates later child-workstream integrations.
7. #4432 still says exact-head CI is pending despite canonical E2E evidence.
8. #4460 correctly records PR #4462 as implementation started, while OAuth, public endpoint, tool-catalog approval, Developer mode, submission, and Production remain incomplete.
9. #4002 temporary closure patchers have not run and must not be executed against a stale queue snapshot.
10. #2030 has green historical branch CI but failed release readiness and an unapplied governed migration gate.

## Approved portfolio rules

- Every Draft must be primary or related delivery.
- Feature key plus role is the authority identity.
- Numeric numbers do not establish uniqueness.
- Diverged branches are reconstructed, not blindly merged.
- Mixed Spec/runtime and integration-rollup PRs are reported explicitly.
- Tool metadata and MCP discovery do not grant authorization.
- Documentation or CI success does not prove runtime, migration, deployment, or Production completion.

## Remaining decisions

- field-level current-main reuse matrices;
- canonical paths for each extracted subsystem/package;
- one System Tool Catalog v2 implementation;
- one repository delivery/assurance subsystem;
- Operation Fabric stack reconstruction plan;
- package and service boundaries;
- Spec 016 tool-catalog and Context Kernel binding;
- stale completion-ledger repairs;
- close/supersede decisions for duplicate and obsolete Drafts.

## Safety boundary

This review performs no merge, close, force push, migration, provider call, credential access, permission change, deployment, external send, plugin connection, submission, publication, or Production activation.
