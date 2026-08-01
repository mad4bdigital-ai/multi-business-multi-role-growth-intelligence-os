# Spec 015 — Tenant Operating System Studio

## Purpose

Define the platform product that lets an individual freelancer, an agency, or a company create, publish, install, customize, operate, upgrade, hand over, and retire complete tenant-scoped business systems without changing the platform kernel.

A complete system is modeled as a versioned **Solution Package**, not as one workflow or one form. A package may compose:

- entity and relationship schemas;
- forms, surveys, and client links;
- workflow graphs and lifecycle state machines;
- file/folder, naming, sharing, retention, and evidence policies;
- AI use cases, prompts, schemas, model policies, and manual fallbacks;
- dashboards, tables, queues, timelines, portals, and reports;
- role templates, capability requirements, provider/connection requirements;
- acceptance suites, sample data, migration rules, runbooks, and rollback.

## Existing foundations reused

This Spec composes, and does not replace:

- Spec 006 Dynamic Workflow Runtime: install, override, extend, fork, tenant-authored assets, immutable versions, compiled plans, runtime state, idempotency, outbox, callbacks, readback;
- Spec 011 Dynamic Multi-Tenant Growth Control Plane: registries, schema-driven configuration, Activity Packs, capabilities, policies, provider compatibility, UI manifests, rollout, lineage, and resolution snapshots;
- Spec 012 Context Kernel and Tenant/Workspace/Brand authority;
- Dynamic Container Authority and typed relationship/inheritance graphs;
- Spec 010 unified tenant-safe frontend dispatch;
- existing resource, capability, approval, connector, observability, and release authorities.

## Relationship to open candidate Specs

### PR #3922

Source of reusable generic concepts:

- Business Operating Profile;
- business activity taxonomy;
- dimension-specific inheritance;
- bounded applicability predicates;
- Activity Capability Packs;
- Effective Business Profile;
- Solution Blueprint scoring and impact preview.

Commerce, inventory, POS, payment, WooCommerce, ERPNext, and retail operations remain a separate **Retail Commerce Solution Pack** and are not the generic studio itself.

### PR #4432

Source of the first complete reference package:

- evidence intake;
- client surveys;
- file lifecycle;
- Gemini processing;
- human review;
- Research/Audit linkage;
- machine-readable development and CI contracts.

Those artifacts become an **Evidence Intelligence Solution Pack** and a reusable package-development assurance template, not the universal tenant customization model.

## Open Draft Spec portfolio

Spec 015 now maintains a portfolio-level view of all verified open Draft Specs rather than treating PR #3922 and PR #4432 in isolation.

- `draft-spec-portfolio.md` — human-readable architecture, dependency, overlap, staleness, and implementation-train review.
- `draft-spec-portfolio.json` — machine-readable registry of ten open Draft Specs, duplicate numeric identities, relationship edges, implementation trains, truthfulness findings, and dispositions.
- `contracts/draft-spec-portfolio.schema.json` — fail-closed contract for the registry.

The portfolio currently covers:

- PR #1898 — shared asset and contextual platform doctrine;
- PR #1935 — adaptive authorization and execution governance;
- PR #2284 — governed PR delivery orchestration;
- PR #2385 — Local Connector reachability recovery;
- PR #2949 — database-driven operation fabric;
- PR #2950 — Tenant GPT effective capability envelope;
- PR #3922 — Business Profile and Retail Commerce;
- PR #4386 — governed Hostinger storage orchestration;
- PR #4432 — Evidence Intelligence and development assurance;
- PR #4456 — Tenant Operating System Studio convergence parent.

The portfolio identity is `feature_key + canonical_role`. Numeric Spec numbers are historical/display labels and cannot establish unique authority, because the open portfolio contains two distinct `011` Specs and three distinct `014` Specs.

## Product outcome

```text
Tenant or delegated agency operator
→ create/select business operating profile
→ create or install a Solution Package
→ configure Brand/client scope and connections
→ preview resolved package and impact
→ validate in sandbox with sample data
→ approve and activate an immutable package installation revision
→ operate through generated tenant-safe surfaces
→ upgrade, rollback, transfer, suspend, archive, or retire with evidence
```

## Initial bounded reference packages and services

```text
platform.reference.retail_commerce_operations
platform.reference.evidence_intelligence_operations
platform.reference.hostinger_storage_operations
platform.reference.local_connector_recovery
```

These are optional bounded packages or platform services. None becomes a universal requirement for unrelated Tenant systems.

## Safety boundary

This is a specification-only package. It does not:

- add runtime routes;
- apply migrations;
- activate registries;
- grant tenant capabilities;
- create provider connections;
- copy credentials or permissions;
- merge, close, rebase, or rewrite any candidate PR;
- deploy or promote Production.

Implementation begins only through bounded child PRs after Work Map classification, current-main reuse review, canonical identity resolution, architecture review, and implementation-readiness gates.
