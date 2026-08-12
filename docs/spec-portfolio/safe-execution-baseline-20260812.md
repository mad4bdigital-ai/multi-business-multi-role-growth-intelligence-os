# Safe Execution Baseline — 2026-08-12

## Purpose

This document records the implementation inventory that can be completed without introducing a new product, architecture, ownership, or external-integration decision. It addresses Spec 015 tasks **T002** and **T003** as documentation and traceability work only; it does not claim runtime completion.

## Scope and evidence rule

The inventory is based on the current repository tree at the implementation branch created from commit `a6c31ec559e35dd2326ccbc027b3d38b29d263e2`. Existing specifications, manifests, contracts, operation-path documents, implementation notes, and runtime source files are treated as evidence of an existing surface—not as approval to replace or activate it.

> No new runtime behavior is introduced by this baseline. Any item marked `reuse` requires a later implementation task to define the exact adapter, authority, and acceptance evidence.

## Current implementation inventory

| Logical capability | Existing repository evidence | Reuse posture for Spec 015 | Current limitation |
|---|---|---|---|
| Tenant and identity scope | `specs/012-unified-admin-tenant-context-kernel/`, `http-generic-api/tenant*`, `http-generic-api/brand*` | Reuse existing tenant/brand context and scope resolvers | Spec 015 runtime binding is not approved by this document |
| Asset and file authority | `http-generic-api/authority*`, `http-generic-api/driveFileLoader.js`, `specs/014-governed-hostinger-storage-orchestration/` | Reuse authority and storage contracts through bounded adapters | No credential or storage migration is authorized |
| Operation and execution fabric | `http-generic-api/operation*`, `http-generic-api/*Execution*`, `specs/integration-governed-execution-runtime-composition/` | Reuse operation correlation, execution envelopes, and readback patterns | Effectful Spec 015 operations remain gated |
| MCP and external surface | `http-generic-api/chatgptMcpRuntime.js`, `specs/016-chatgpt-plugin-mcp-integration/`, `specs/017-remote-mcp-host-isolation-oauth-readiness/` | Reuse read-only and governed external-surface contracts | OAuth, public endpoint, and external-surface gates remain open |
| Tool catalog and capability discovery | `specs/013-system-tool-catalog-v2/`, `http-generic-api/capability*`, `http-generic-api/*Tool*` | Reuse catalog and capability projection as references | Duplicate identity and canonical-path decisions remain separate work |
| Activation and lifecycle | `specs/012-tenant-activation-lifecycle/`, `http-generic-api/*Activation*`, `http-generic-api/*Lifecycle*` | Reuse lifecycle guards, readback, and operational attention patterns | Spec 015 lifecycle implementation is not enabled |
| Evidence and provenance | `specs/014-gemini-evidence-intake-automation/`, `http-generic-api/authorityEvidence*`, `http-generic-api/*Provenance*` | Reuse evidence/provenance vocabulary and validation patterns | Evidence Intelligence package reconstruction remains a later task |
| CI and contract validation | `package.json`, `http-generic-api/check-*.mjs`, `specs/014-gemini-evidence-intake-automation/tools/validate-contracts.mjs`, Spec 015 tools | Reuse validation conventions and exact change evidence | Green documentation CI is not runtime completion |
| Business Profile and Activity Pack | Existing references in Spec 015 and candidate PR inventory | Candidate substrate only; do not copy blindly | T080 remains a reconstruction task |
| Retail Commerce | `specs/014-retail-commerce-operations-growth-os/` and related contracts | Candidate child package/reference surface | No new package identity is created here |

## Explicitly deferred decisions

The following are deliberately outside this safe baseline: custom-entity persistence strategy, duplicate numeric Spec identity resolution, canonical target paths for duplicate feature clusters, package publication authority, external OAuth/public endpoint activation, credential installation, and production migration or rollback policy. These correspond to later tasks and must not be inferred from the inventory.

## Safe next actions

The next implementation-safe actions are contract and evidence work: validate the current JSON/OpenAPI documents, add field-level reuse mappings where evidence is already explicit, and improve deterministic inventory checks. Runtime package, installation, lifecycle, AI, UI, agency, and pilot work must remain blocked until their declared gates are approved.

## Traceability

| Spec 015 task | Evidence produced by this document | Status after review |
|---|---|---|
| T002 | Current-main implementation inventory across tenant, asset, operation, MCP, tool-catalog, lifecycle, evidence, and CI surfaces | Documentation complete; runtime unchanged |
| T003 | Logical capability-level reuse posture and limitations | Documentation baseline complete; field-level expansion can follow |
| T008 | No evidence; explicitly deferred | Remains open |
| T010–T085 | No runtime evidence; explicitly deferred | Remain open |
| T090–T097 | No pilot or closeout evidence | Remain blocked |

## Validation command set

```bash
npm run typecheck
npm test -- --runInBand
node specs/015-tenant-operating-system-studio/tools/validate-spec.mjs
node specs/015-tenant-operating-system-studio/tools/validate-portfolio-live-delta.mjs
```

A successful command run validates repository consistency only. It does not change any readiness status or close any runtime task.
