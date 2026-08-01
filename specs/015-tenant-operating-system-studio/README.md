# Spec 015 — Tenant Operating System Studio

## Purpose

Define the platform product that lets a freelancer, agency, or company create, publish, install, customize, operate, upgrade, hand over, and retire complete tenant-scoped business systems without changing the platform kernel.

A complete system is a versioned **Solution Package**, not one workflow or form. A package may compose entities, relationships, forms, surveys, client links, lifecycle state machines, workflows, file/evidence policies, AI use cases, dashboards, queues, portals, reports, role templates, capability/resource requirements, acceptance suites, sample data, migrations, runbooks, and rollback.

## Existing authorities reused

This Spec composes, and does not replace:

- Spec 006 Dynamic Workflow Runtime;
- current Spec 011 Dynamic Multi-Tenant Growth Control Plane;
- Spec 012 Context Kernel;
- Dynamic Container Authority;
- Spec 010 unified tenant-safe frontend dispatch;
- current resource, capability, policy, approval, connector, operation, evidence, observability, repository automation, and release authorities.

## Candidate and package sources

### PR #3922

Generic substrate: Business Operating Profile, activity taxonomy, inheritance, applicability predicates, Activity Capability Packs, Effective Business Profile, and Solution Blueprints.

Bounded package:

```text
platform.reference.retail_commerce_operations
```

### PR #4432

Generic substrate: machine-readable development and CI assurance.

Bounded package:

```text
platform.reference.evidence_intelligence_operations
```

### PR #4386

Bounded service/package:

```text
platform.reference.hostinger_storage_operations
```

### PR #2385

Bounded service/package:

```text
platform.reference.local_connector_recovery
```

## Open Draft portfolio

Spec 015 maintains the connected portfolio instead of reviewing candidate Specs in isolation:

- `draft-spec-portfolio.md` — architecture, dependencies, overlaps, staleness, truthfulness, and delivery trains;
- `draft-spec-portfolio.json` — machine-readable registry;
- `contracts/draft-spec-portfolio.schema.json` — fail-closed contract;
- `tools/validate-spec.mjs` — deterministic portfolio validator.

Current snapshot:

```text
12 primary Draft Specs
22 related open Draft PRs
34 total classified Draft PRs
2 duplicate numeric identities
1 duplicate feature cluster
4 delivery trains
```

Primary Specs:

- #1898 Shared Asset Fabric;
- #1935 Adaptive Authorization;
- #2284 Governed PR Delivery;
- #2385 Local Connector Recovery;
- #2949 Database Operation Fabric;
- #2950 Tenant GPT Envelope;
- #3159 System Tool Catalog v2;
- #3922 Retail Commerce;
- #4386 Hostinger Storage;
- #4432 Evidence Intelligence;
- #4456 Tenant Operating System Studio;
- #4460 ChatGPT Plugin and MCP Integration.

Canonical portfolio identity:

```text
feature_key + canonical_role
```

Numeric Spec numbers cannot establish uniqueness because the portfolio contains two `011` Specs and three `014` Specs. The `013-system-tool-catalog-v2` feature also has three open Draft branches: #3159, #3139, and helper #3145.

## System Tool Catalog relationship

PR #3159 is the representative System Tool Catalog v2 candidate. The selected current-main reconstruction should become a reviewed discovery/projection source for:

- Operation Fabric tool projection;
- Tenant GPT capability presentation;
- ChatGPT MCP focused tool catalogs.

Tool metadata never grants permission.

## ChatGPT and MCP relationship

PR #4460 is the canonical external integration surface. PR #4462 is its first feature-flagged read-only implementation child.

```text
ChatGPT/Codex principal
→ OAuth and MCP transport
→ focused reviewed tool catalog
→ Context Kernel
→ capability/policy authorization
→ existing operation/readback authority
```

Spec 016 consumes platform authorities; it does not create an independent execution kernel. OAuth conformance, public endpoint verification, approved tool catalog, Developer mode acceptance, plugin packaging, submission, publication, and Production remain separate gates.

## Product outcome

```text
Tenant or delegated agency operator
→ create/select business operating profile
→ create or install a Solution Package
→ configure Brand/client scope and connections
→ preview resolved package and impact
→ validate in sandbox
→ approve and activate an immutable installation revision
→ operate through generated tenant-safe surfaces
→ optionally expose reviewed focused surfaces through MCP
→ upgrade, rollback, transfer, suspend, archive, or retire with evidence
```

## Safety boundary

This branch is specification-only. It does not add runtime routes, apply migrations, activate registries, grant capabilities, create provider connections, access credentials, merge/close/rebase candidate PRs, connect ChatGPT, submit or publish a plugin, deploy, or promote Production.

Implementation begins only through bounded child PRs after current-main reuse review, identity and path resolution, architecture/security review, and implementation-readiness gates.
