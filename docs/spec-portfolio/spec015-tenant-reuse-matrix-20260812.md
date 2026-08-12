# Spec 015 Tenant reuse and authority matrix

## Scope and truthfulness boundary

This matrix executes the **read-only, local-safe** portion of Spec 015 T002–T003 and supports T006/T080–T085. It maps Tenant-related logical entities to current-main evidence and records whether each area is a specification contract, an existing runtime surface, a missing authority, or an external/runtime blocker.

> This is an audit artifact. It does not create a package registry, installation compiler, persistence authority, provider binding, migration, delegation grant, or Production readback.

The snapshot is anchored to `origin/main` at `33f1861f9cb93351e348d191894077f087c35ddd`. Secrets are excluded, no mutation was executed, and candidate PRs remain read-only evidence sources.

## Field-level reuse matrix

| Logical entity | Spec tasks | Current evidence status | Authority boundary | Safe next step |
|---|---|---|---|---|
| Package definition and manifest | T010, T012, T016 | Specification/contract only | No canonical runtime package catalog exists in this Spec Kit. | Approve package registry and publication schema. |
| Component definition, version, and binding | T013–T015, T018 | Specification/validator boundary | No canonical component/version registry or persisted dependency graph is selected. | Approve component authority and provenance schema. |
| Installation identity, scope, revision, and preview | T020, T023, T025–T027 | Contract and preview boundary only | No persisted installation revision authority or approved compiler input schema. | Approve install schema, revision authority, and pure compiler contract. |
| Credential-free requirement bindings | T021–T022, T027 | Policy/audit only | Connection, resource, and credential authorities remain external to Spec 015. | Define explicit authority references and wrong-scope vectors. |
| Tool catalog and operation projection | T002–T003, T082, T085 | Existing current-main surface plus candidate audit | Current discovery/projection code is not automatically Spec 015 package authority. | Complete exact-path and duplicate-identity decision record. |
| Custom entities, relationships, and lifecycles | T030–T036 | Not implemented | Persistence, migration, optimistic locking, and effect/readback strategy are not approved. | Approve runtime primitives before adding pure transition tests. |
| Forms, files, and external surfaces | T040–T045, T054 | Partial existing surfaces plus Spec contracts | File identity, retention, sharing, and external-surface policy are not unified. | Freeze policies, then add no-effect isolation tests. |
| Draft-only AI, UI, and reports | T050–T056 | Specification/governance boundary | Provider, sensitivity, budget, redaction, and generated-surface authorities are missing. | Approve authoring/provider and output-safety contracts. |
| Publication, installation, rollback, and revocation | T060–T066 | Transition requirements only | CAS, evidence registry, promotion, rollback, and revocation readback are missing. | Approve compare-and-set/readback contract. |
| Agency delegation, export, and handover | T070–T076 | Ownership contract boundary only | Client/Tenant ownership and delegation/revocation readback are not approved. | Approve ownership, portability, and handover policies. |
| Candidate PR convergence evidence | T080–T085 | Read-only evidence refreshable | Candidate branches are not runtime authorities and stale/conflicting branches are not copied. | Review refreshed evidence and approve separate reconstruction plans. |

## Evidence paths

The machine-readable companion is `spec015-tenant-reuse-matrix-20260812.json`. Its evidence paths point to the Spec 015 contracts and validator, current-main resource/frontend surfaces, the canonical User-JWT boundary, and the refreshed candidate PR snapshot. The refresh tool is `specs/015-tenant-operating-system-studio/tools/refresh-candidate-pr-readonly-evidence.mjs`; it uses GitHub read-only metadata and explicitly records `safe_read_only=true`, `merge_executed=false`, and `secrets_included=false`.

## Completion status

This deliverable closes the local **inventory/reuse/audit evidence slice** only. It does not mark Spec 015 runtime implementation as started or complete, does not resolve duplicate numeric identities, and does not execute candidate PR reconstruction. Those remain governance or runtime tasks governed by the completion rule in `specs/015-tenant-operating-system-studio/tasks.md`.
