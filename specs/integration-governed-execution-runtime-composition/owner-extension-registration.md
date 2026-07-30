# Owner Spec Extension Registration

## Purpose

This document proves that the runtime-composition proposal is attached to the existing functional owners rather than represented only by standalone cross-spec prose.

The integration kit remains non-functional and non-runtime authority. Each requirement namespace is discoverable from a co-located owner artifact and an owner or extension manifest.

## Registration matrix

| Owner | Baseline state | Extension artifact | Extension manifest | Owner-manifest registration |
|---|---|---|---|---|
| Spec 011 Durable Governed Execution | existing multi-PR implementation remains `in_progress` | `runtime-composition-performance-addendum.md` | `runtime-composition-extension.manifest.json` | co-located extension manifest references the existing parent manifest without rewriting its long-running phase ledger |
| Spec 012 Unified Context Kernel | baseline specification and shadow/application phases remain draft/non-authoritative | `execution-capsule-runtime-addendum.md` | `execution-capsule-runtime-extension.manifest.json` | `manifest.json` lists both extension files and exposes a typed `extensions` entry |
| Spec 013 System Tool Catalog V2 | Catalog V2 baseline merged through PR #3260 at `0de0cdd6727040a2670821025c32615991cb3251` | `intent-execution-surface-addendum.md` | `intent-execution-surface-extension.manifest.json` | new owner `manifest.json` records the merged baseline and keeps the intent execution surface `draft` with `runtime_authority=false` |

## Requirement namespaces

| Namespace | Owner | Range | Meaning |
|---|---|---|---|
| `FR-RC-*` | Spec 011 | `FR-RC-001` through `FR-RC-035` | runtime composition, governed plan, scheduler, lanes, approval frontier, ledger/projections, results, performance |
| `FR-EC-*` | Spec 012 | `FR-EC-001` through `FR-EC-026` | Execution Capsule, revision reuse, mutation-frontier validation, invalidation, runtime ports, privacy |
| `FR-IE-*` | Spec 013 | `FR-IE-001` through `FR-IE-028` | intent/exact-operation public shell, descriptor execution metadata, result modes, compatibility, consequence and observability |

Requirement IDs MUST NOT be copied into a different owner namespace. Cross-spec artifacts may reference them but cannot redefine their semantics.

## Authority boundaries

The manifests enforce the following distinctions:

- `specification_authority=true` means the addendum is the reviewed source for its future contract.
- `runtime_authority=false` means merging this documentation cannot activate a route, provider call, worker, scheduler, database mutation, approval, or deployment.
- A Catalog descriptor or intent candidate never grants execution authority.
- An Execution Capsule never grants execution authority by itself.
- A governed plan cannot silently change the exact context selected by Spec 012.
- Provider mutation and readback remain owned by Spec 011 and require later implementation/certification phases.

## Baseline and extension separation

Spec 013 requires explicit separation because its baseline Catalog V2 is already implemented and merged while its intent execution surface is not. The owner manifest therefore exposes:

- `baseline_exposed`: list, direct lookup, capability-intent discovery, and observability;
- `extension_specification_only`: execute intent/operation, status, result, cancel, and resume.

No implementation may infer that the extension operations exist at runtime merely because they appear in the extension manifest.

## Validation requirements

CI or a deterministic specification test SHOULD verify:

1. every owner and extension manifest parses as JSON;
2. all relative artifact paths resolve;
3. every extension points to exactly one parent owner;
4. requirement prefixes are unique across extensions;
5. runtime-authority flags remain false in this PR;
6. Spec 013 baseline merge evidence matches the merged PR and current main ancestry;
7. the integration manifest lists all owner manifests, extension manifests, and primary addenda;
8. no implementation phase is marked complete by this specification-only PR.

## Closure rule

The package cannot be treated as specification-complete if an addendum becomes orphaned from its owner manifest or if the integration kit becomes the only place that knows the extension exists. Owner registration and cross-spec traceability must remain synchronized in every later documentation update.
