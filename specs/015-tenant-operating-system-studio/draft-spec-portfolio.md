# Open Draft Spec Portfolio and Convergence Map

## Purpose

This document is the human-readable companion to `draft-spec-portfolio.json`. It records the open Draft Specs observed on 1 August 2026, their live relationship to `main`, their architectural roles, overlaps, implementation trains, and recommended convergence posture.

The registry is portfolio awareness, not merge authority. It does not close, merge, rebase, deploy, migrate, activate providers, grant capabilities, or replace existing runtime authorities.

## Identity rule

A numeric Spec number is not a unique authority identifier.

The canonical portfolio identity is:

```text
feature_key + canonical_role
```

This is required because the open portfolio currently contains:

- two unrelated Draft Specs numbered `011`;
- three unrelated Draft Specs numbered `014`.

The numeric number remains a display and historical sequencing label. It cannot establish ownership, dependency, replacement, or merge order.

## Executive architecture map

```text
Architectural doctrine and reusable decisions
└── PR #1898 — Shared Asset Fabric / Contextual Platform Planes

Authority and execution kernels
├── PR #1935 — Adaptive Authorization and Execution Governance
├── current Spec 006 Dynamic Workflow Runtime
├── current Spec 011 Dynamic Multi-Tenant Growth Control Plane
└── current Spec 012 Context Kernel

Repository and operation delivery services
├── PR #2284 — Governed PR Delivery Orchestration
├── PR #2949 — Database-Driven Operation Fabric
└── generic assurance extracted from PR #4432

Infrastructure and recovery services
├── PR #2385 — Local Connector Reachability Recovery
└── PR #4386 — Governed Hostinger Storage Orchestration

Tenant product and authoring layer
├── PR #2950 — Tenant GPT Effective Capability Envelope
└── PR #4456 — Tenant Operating System Studio

Reference Solution Packages
├── PR #3922 → Retail Commerce Operations
├── PR #4432 → Evidence Intelligence Operations
├── PR #4386 → Hostinger Storage Operations
└── PR #2385 → Local Connector Recovery
```

## Live Draft Spec inventory

The comparison values below are snapshots against `main` SHA `464c11803d8cb84ba39863c5e55e05f30dbca8da`.

| PR | Feature | Role | Scope mode | Ahead | Behind | Mergeable | Portfolio posture |
|---:|---|---|---|---:|---:|---|---|
| #1898 | `004-tenant-asset-federation` | Architectural doctrine source | Specification only | 504 | 3248 | No | Extract reviewed decisions; do not merge umbrella branch |
| #1935 | `006-adaptive-authorization-execution-governance` | Authority kernel candidate | Specification only | 3 | 5297 | No | Reconcile into current auth/context authorities |
| #2284 | `008-governed-pr-delivery-orchestration` | Repository delivery subsystem | Specification only | 2 | 4256 | No | Consolidate with current automation and CI assurance |
| #2385 | `009-local-connector-reachability-recovery` | Infrastructure recovery subsystem | Specification only | 5 | 3877 | No | Reconstruct as bounded platform service/package |
| #2949 | `011-database-driven-operation-fabric` | Operation fabric subsystem | Specification only | 15 | 1873 | No | Reconcile ordered implementation train on current main |
| #2950 | `011-tenant-gpt-effective-capability-envelope` | Tenant application component | Mixed Spec + runtime | 13 | 1901 | No | Reconstruct as Studio assistant components |
| #3922 | `014-retail-commerce-operations-growth-os` | Reference package source | Specification only | 95 | 278 | Yes | Extract generic substrate; rebuild Retail Commerce Pack |
| #4386 | `014-governed-hostinger-storage-orchestration` | Integration rollup | Spec + implementation | 256 | 2 | Yes | Bounded platform service and operational package |
| #4432 | `014-gemini-evidence-intake-automation` | Reference package source | Specification only | 43 | 1 | Yes | Extract assurance; rebuild Evidence Intelligence Pack |
| #4456 | `015-tenant-operating-system-studio` | Portfolio convergence parent | Specification only | 32 | 0 | Yes | Maintain the connected portfolio and package model |

## Tier 1 — Architectural doctrine source

### PR #1898 — Shared Asset Fabric and Contextual Platform Planes

This is the broadest Draft Spec. It contains useful platform-level decisions covering:

- shared canonical assets rather than Tenant copies;
- contextual layer inheritance and policy composition;
- Tenant, Workspace, Brand, Business Activity, Role, user, and task context;
- data governance and privacy;
- Commercial/FinOps;
- model governance;
- deterministic durable workflow and effect commitment;
- artifact, knowledge, provenance, and verifiable claims;
- portability, disaster recovery, human operations, and adaptive growth.

It must not be treated as a mergeable monolithic parent. The branch is thousands of commits behind `main`, several domains now have dedicated current authorities, and its completion evidence points to an older head. The correct use is decision extraction and ADR reconciliation.

## Tier 2 — Authority and execution kernels

### PR #1935 — Adaptive Authorization and Execution Governance

Useful reusable concepts:

- typed subject-action-resource-context policy decisions;
- explicit scoped grants;
- expiring request-bound approvals;
- distributed enforcement points with a shared kernel;
- certified execution adapters;
- capability-specific readback;
- narrow reconciliation controllers.

This Spec is a dependency for Local Connector Recovery, Tenant GPT, Hostinger orchestration, and Studio package activation. It cannot be implemented as a parallel replacement for current capability, context, resource, approval, and execution authorities.

### PR #2949 — Database-Driven Operation Fabric

This defines the operation registry, step contracts, compiled binding manifests, dynamic adapter/runtime resolution, tool projection, durable operation state, Git worker behavior, CI diagnosis, and generated-artifact reconciliation.

Its proper role is a subsystem beneath the current workflow runtime and control plane:

```text
Solution Package / user intent
→ versioned operation contract
→ compiled binding manifest
→ existing context, capability, resource, credential, approval, dispatch, and readback authorities
```

It must not become a second workflow engine or authority kernel.

## Tier 3 — Repository delivery and assurance

### PR #2284 — Governed PR Delivery Orchestration

Core reusable content:

- drift-aware delivery;
- candidate merge and candidate-head CI;
- idempotent write receipts;
- readback-first handling of uncertain mutation outcomes;
- just-in-time capability envelopes;
- chunked evidence handling;
- migration, release, and post-merge closeout.

### Generic assurance content in PR #4432

PR #4432 independently defines:

- machine-readable development requirements and tasks;
- exact-candidate identity;
- Test Families and changed-scope routing;
- E2E phase governance;
- diagnostic shards and ordered progress;
- canonical evidence publication;
- read-only generated-artifact validation and a separately authorized sole writer;
- truthful completion gates.

These two designs substantially overlap. They should converge into one repository delivery and assurance subsystem rather than create two orchestration stacks.

## Tier 4 — Infrastructure and recovery services

### PR #2385 — Local Connector Reachability Recovery

This handles device, runtime, tunnel, auth-host, heartbeat, probe, recovery, and Admin break-glass concerns. Its portable primitives are:

- exact device/resource identity;
- separation of configuration, registration, heartbeat, probe, and local-service health;
- preview, fresh authorization, bounded action, and same-cycle readback;
- no silent Tenant escalation to Admin break-glass;
- token replay and wrong-device prevention.

The platform authority remains kernel-owned. Tenant-selectable diagnostics and recovery plans may be packaged under:

```text
platform.reference.local_connector_recovery
```

### PR #4386 — Governed Hostinger Storage Orchestration

This is not a specification-only Draft. It is an integration rollup containing contracts, policies, orchestration code, adapters, tests, and workflow guards.

The current useful boundary is:

```text
Hostinger resource and quota evidence
→ immutable bounded storage plan
→ authority, approval, and lease
→ certified worker and fixed invocation
→ checkpoint and crash-safe evidence
→ exact readback
→ unknown-outcome reconciliation
```

It belongs as a bounded platform service and operational package:

```text
platform.reference.hostinger_storage_operations
```

It overlaps Local Connector Recovery in resource identity, probes, fresh authorization, plans, readback, and reconciliation, but it remains a distinct provider/resource family.

## Tier 5 — Tenant product layer

### PR #2950 — Tenant GPT Effective Capability Envelope

This PR combines a Spec Kit with actual runtime modules and tests. It provides:

- Tenant-safe effective capability discovery;
- exact resource-to-connection binding;
- schema-driven questionnaires;
- evidence classification and operational memory;
- preview-only conversation orchestration;
- contradiction checks against live readiness;
- device-reinstall suppression when a healthy device already exists.

It is not a second Spec 011 kernel. Its reusable content belongs in the Studio as:

- an assistant surface;
- a capability and readiness explainer;
- a questionnaire component;
- a configuration and gap-resolution guide;
- a preview-only operation planner.

Execution remains delegated to canonical operation, context, resource, capability, approval, and readback authorities.

## Tier 6 — Reference Solution Packages

### Retail Commerce — source PR #3922

Generic substrate to extract:

- Business Operating Profile;
- versioned Business Activities;
- dimension-specific inheritance;
- applicability predicates;
- Activity Capability Packs;
- Effective Business Profile;
- Solution Blueprint scoring, lineage, and impact preview.

Bounded child package:

```text
platform.reference.retail_commerce_operations
```

Commerce, inventory, POS, payments, WooCommerce, ERPNext, catalog, orders, returns, suppliers, media, measurement, and Drive behavior remain optional package content.

### Evidence Intelligence — source PR #4432

Bounded child package:

```text
platform.reference.evidence_intelligence_operations
```

It contains evidence intake, client forms, files, naming, routing, deduplication, Gemini analysis, structured proposals, human review, clarification, Research/Audit linkage, audio/video, embeddings, cost controls, recovery, and manual fallback.

### Hostinger Storage — source PR #4386

Bounded service/package:

```text
platform.reference.hostinger_storage_operations
```

### Local Connector Recovery — source PR #2385

Bounded service/package:

```text
platform.reference.local_connector_recovery
```

## Duplicate numeric identities

### `011`

- PR #2949: operation registry and compiled execution fabric.
- PR #2950: Tenant GPT capability discovery and conversation orchestration.

Resolution:

- classify #2949 as an operation-fabric subsystem;
- classify #2950 as a tenant application component;
- preserve the current canonical Spec 011 Dynamic Multi-Tenant Growth Control Plane as the platform control-plane authority.

### `014`

- PR #3922: Business Profile substrate and Retail Commerce.
- PR #4386: Hostinger Storage orchestration.
- PR #4432: Evidence Intelligence and development assurance.

Resolution:

- stop using `014` as the identity key;
- use semantic feature keys;
- reconstruct each bounded domain under a distinct package or service role;
- preserve generic substrate in shared current-main authorities.

## Implementation train awareness

### Operation Fabric strict stack

PR #2949 has thirteen open stacked implementation PRs:

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

This is one ordered delivery train. Reviewing or merging a middle PR independently would lose stack semantics. The parent completion ledger must be corrected because it currently reports implementation as not started.

### Hostinger parallel workstreams

PR #4386 is an integration branch with parallel workstreams. At the observed snapshot:

- PR #4390 contracts was merged into Integration;
- PRs #4458 and #4459 synthetic-adapter provenance corrections were merged into Integration;
- PR #4455 Tenant Canary hardening remains open against Integration;
- provider dispatch, live SSH, migration, Production promotion, and Production mutation remain disabled.

## Truthfulness and stale-evidence findings

1. **PR #1898:** completion CI head and branch synchronization claims no longer match the live head and live divergence.
2. **PR #2949:** completion says implementation is not started and lists no implementation PRs, while thirteen stacked Draft PRs exist.
3. **PR #2950:** completion says implementation is not started, but the PR changes runtime modules and tests.
4. **PR #3922:** PR narrative records an older zero-behind state, while the live branch is behind current `main`.
5. **PR #4386:** completion was written before later child-workstream integrations and requires a fresh rollup readback.
6. **PR #4432:** completion still says exact-head CI is pending although canonical E2E evidence was published successfully.
7. **Older Specs #1935, #2284, and #2385:** current-main divergence is material enough that direct merge is unsafe even when the conceptual design remains useful.

## Convergence decisions

### Approved portfolio rules

- Feature key plus canonical role is the portfolio identity.
- Numeric Spec numbers do not grant uniqueness or authority.
- Diverged Draft Spec branches are not blindly merged.
- Specification-only, mixed implementation, and integration-rollup PRs are reported separately.
- Documentation completeness never implies runtime, migration, deployment, or Production completion.

### Proposed consolidation

- Consolidate repository delivery and CI assurance from #2284, #2949, and #4432.
- Reconstruct #2950 as Studio assistant components.
- Reconstruct #3922, #4386, #4432, and #2385 as bounded packages or services.
- Extract current-useful decisions from #1898 and #1935 into current canonical authorities.

### Still blocked

Final close, supersede, merge, or reconstruction actions require:

- field-level current-main reuse matrices;
- exact canonical path decisions;
- architecture and security review;
- dependency graph confirmation;
- current-head CI and conflict review where a branch will be reused;
- explicit child-package boundaries;
- truthful completion-ledger repair.

## Safety boundary

This portfolio review performs no:

- merge or close action;
- force push or history rewrite;
- migration or database write;
- provider, local device, Google Workspace, WordPress, Hostinger, or external mutation;
- permission or credential change;
- deployment or Production promotion.
