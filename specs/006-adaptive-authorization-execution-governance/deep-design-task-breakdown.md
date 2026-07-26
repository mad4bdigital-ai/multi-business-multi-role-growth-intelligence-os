# Deep Implementation Task Breakdown

## Purpose

Translate the deep design into bounded engineering work. These tasks refine `tasks.md`; they do not mark runtime implementation complete.

## DD-00 — Authority census and ownership

- [ ] DD-001 Inventory all current skill, action, endpoint, tool, grant, approval, execution, and resource-authority tables/views.
- [ ] DD-002 Identify the current write authority and read authority for each logical concept.
- [ ] DD-003 Detect duplicated or conflicting authorities.
- [ ] DD-004 Record row counts, update rates, indexes, and tenant columns.
- [ ] DD-005 Map the three pilot capabilities to existing registry rows.
- [ ] DD-006 Approve reuse, projection, extension, or additive-table decision per logical resource.
- [ ] DD-007 Assign owners for authorization, relationships, approvals, adapters, evidence, reconciliation, and contracts.

## DD-10 — State semantics and projections

- [ ] DD-101 Introduce independent source-state types for availability, binding, relationship, grant, authorization, approval, execution, verification, and reconciliation.
- [ ] DD-102 Implement pure derived-readiness function.
- [ ] DD-103 Change active skill/grant reporting so approval-required grants remain active.
- [ ] DD-104 Add separate `approvalGatedActiveCount` and `immediatelyExecutableCount` projections.
- [ ] DD-105 Correct brand/admin/global scope filtering for projections.
- [ ] DD-106 Add projection source revision, observation time, and stale marker.
- [ ] DD-107 Add regression tests for known approval-state inversion.

## DD-20 — Canonical capability resolution

- [ ] DD-201 Define canonical capability ID and immutable version value object.
- [ ] DD-202 Define alias types for route, action, endpoint, tool, intent, skill, UI, and legacy key.
- [ ] DD-203 Implement deterministic scoped alias resolution.
- [ ] DD-204 Reject equal-ranked alias mappings.
- [ ] DD-205 Add read-only resolver diagnostics.
- [ ] DD-206 Map `activation.skills.read`.
- [ ] DD-207 Map `platform.output-artifact.write`.
- [ ] DD-208 Map `content.wordpress.publish`.
- [ ] DD-209 Add alias-change audit and revision increments.

## DD-30 — Relationship authority

- [ ] DD-301 Document supported subject, relation, and resource types.
- [ ] DD-302 Map tenant, workspace, brand, user, agent, service, connection, and CMS-site authority.
- [ ] DD-303 Implement tenant-scoped bounded traversal.
- [ ] DD-304 Add cycle detection and maximum-depth enforcement.
- [ ] DD-305 Define relation-specific inheritance rules.
- [ ] DD-306 Return deterministic relationship revision evidence.
- [ ] DD-307 Add administrator-only bounded explanation path.
- [ ] DD-308 Add cross-tenant, cycle, expired-edge, and depth-limit tests.

## DD-40 — Typed policy decision kernel

- [ ] DD-401 Define typed subject/action/resource/context schemas.
- [ ] DD-402 Define stable effect, obligation, and reason-code types.
- [ ] DD-403 Define hard-deny precedence.
- [ ] DD-404 Implement grant and relationship composition.
- [ ] DD-405 Implement bounded policy input field registry.
- [ ] DD-406 Prohibit dynamic code and unrestricted expressions.
- [ ] DD-407 Implement revision-vector creation.
- [ ] DD-408 Implement bounded external and richer internal explanations.
- [ ] DD-409 Persist append-only shadow decisions without raw payloads.
- [ ] DD-410 Add determinism and property-based tests.

## DD-50 — Approval governance

- [ ] DD-501 Define immutable approval policy versions.
- [ ] DD-502 Implement `not_required`, `per_request`, `per_session`, `per_resource`, `bounded_automatic`, `multi_party`, and `break_glass` modes as approved.
- [ ] DD-503 Define typed confirmation schemas.
- [ ] DD-504 Create append-only approval request and decision repositories.
- [ ] DD-505 Bind approvals to normalized request evidence and revision vector.
- [ ] DD-506 Implement expiry, revocation, rejection, staleness, and self-approval rules.
- [ ] DD-507 Add concurrent-decision protection.
- [ ] DD-508 Add approval-laundering and stale-evidence tests.

## DD-60 — Execution envelopes and enforcement

- [ ] DD-601 Define canonical JSON request normalization.
- [ ] DD-602 Define request-hash versioning.
- [ ] DD-603 Implement short-lived envelope issuance.
- [ ] DD-604 Implement atomic dispatch reservation and row versioning.
- [ ] DD-605 Implement single-use consumption.
- [ ] DD-606 Define idempotency scope by tenant, subject, capability, resource, and request hash.
- [ ] DD-607 Reject key reuse with different evidence.
- [ ] DD-608 Implement shared enforcement kernel.
- [ ] DD-609 Integrate enforcement at API, worker, queue consumer, connector, and adapter boundaries.
- [ ] DD-610 Add stale-revision and TOCTOU tests.
- [ ] DD-611 Add duplicate-worker concurrency tests.

## DD-70 — Adapter registry and certification

- [ ] DD-701 Define `describe`, `preflight`, `execute`, `readback`, and optional `compensate` contracts.
- [ ] DD-702 Define deterministic adapter eligibility and ranking.
- [ ] DD-703 Implement shadow, canary, active, fallback, and disabled modes.
- [ ] DD-704 Implement version-specific certification evidence.
- [ ] DD-705 Block stale, revoked, disabled, and uncertified adapters.
- [ ] DD-706 Normalize provider errors to stable internal categories.
- [ ] DD-707 Implement circuit readiness without silent fallback authorization.
- [ ] DD-708 Certify internal read adapter.
- [ ] DD-709 Certify output artifact internal-write adapter.
- [ ] DD-710 Keep WordPress adapter shadow-only until full certification.

## DD-80 — Execution evidence and readback

- [ ] DD-801 Define acknowledgement, observed, state-verified, effect-verified, compensated, incomplete, and mismatched evidence.
- [ ] DD-802 Implement append-only execution attempts and evidence.
- [ ] DD-803 Define readback contract for each pilot.
- [ ] DD-804 Implement provider-timeout uncertain-effect classification.
- [ ] DD-805 Implement readback-before-retry.
- [ ] DD-806 Implement bounded compensation authority.
- [ ] DD-807 Add redaction and bounded evidence tests.
- [ ] DD-808 Add mismatched-effect support workflow.

## DD-90 — Reconciliation

- [ ] DD-901 Implement transactional outbox for authority changes.
- [ ] DD-902 Implement relationship reconciler.
- [ ] DD-903 Implement grant lifecycle reconciler.
- [ ] DD-904 Implement policy revision reconciler.
- [ ] DD-905 Implement approval expiry reconciler.
- [ ] DD-906 Implement adapter certification reconciler.
- [ ] DD-907 Implement connection readiness reconciler.
- [ ] DD-908 Implement execution readback reconciler.
- [ ] DD-909 Implement projection reconciler.
- [ ] DD-910 Add controller leases, checkpoints, retries, jitter, poison-item isolation, and lag metrics.
- [ ] DD-911 Require fresh evidence before `recovered` classification.

## DD-100 — API contracts

- [ ] DD-1001 Review resource paths and nested resource ownership.
- [ ] DD-1002 Add strict ID, enum, timestamp, and hash formats.
- [ ] DD-1003 Add examples for all requests, decisions, conflicts, and readback states.
- [ ] DD-1004 Add 422, 429, and 503 responses where applicable.
- [ ] DD-1005 Define retry guidance and `Retry-After` behavior.
- [ ] DD-1006 Define cursor pagination and filtering.
- [ ] DD-1007 Add per-operation security and scope documentation.
- [ ] DD-1008 Synchronize root OpenAPI and generated clients only with implementation.
- [ ] DD-1009 Add compatibility tests for existing clients.

## DD-110 — Migration and backfill

- [ ] DD-1101 Create approved additive migrations.
- [ ] DD-1102 Record migration checksum, statement count, and ledger run ID.
- [ ] DD-1103 Implement bounded checkpointed backfill.
- [ ] DD-1104 Quarantine ambiguous rows.
- [ ] DD-1105 Verify source and target counts and hashes.
- [ ] DD-1106 Measure query plans and required indexes.
- [ ] DD-1107 Implement dual-read before cutover.
- [ ] DD-1108 Avoid uncontrolled dual-write.
- [ ] DD-1109 Document rollback and compatibility window.

## DD-120 — Shadow parity

- [ ] DD-1201 Define bounded parity evidence schema.
- [ ] DD-1202 Compare read pilot decisions.
- [ ] DD-1203 Compare internal-write pilot decisions without new enforcement.
- [ ] DD-1204 Compare WordPress publish preflight without provider write.
- [ ] DD-1205 Classify every mismatch.
- [ ] DD-1206 Resolve all adaptive-allow/legacy-deny mismatches before canary.
- [ ] DD-1207 Approve capability-specific thresholds.

## DD-130 — Observability and operations

- [ ] DD-1301 Implement bounded decision, approval, execution, verification, and reconciliation metrics.
- [ ] DD-1302 Add structured audit events.
- [ ] DD-1303 Add critical security alerts.
- [ ] DD-1304 Add runbooks for deny spikes, uncertain effects, certification revocation, and grant revocation.
- [ ] DD-1305 Define retention classes.
- [ ] DD-1306 Add dashboards with source revisions and stale markers.
- [ ] DD-1307 Baseline and approve SLO values.

## DD-140 — Security verification

- [ ] DD-1401 Complete threat-model review.
- [ ] DD-1402 Add direct object reference and tenant substitution tests.
- [ ] DD-1403 Add confused-deputy tests.
- [ ] DD-1404 Add approval laundering and replay tests.
- [ ] DD-1405 Add adapter substitution tests.
- [ ] DD-1406 Add policy injection and graph abuse tests.
- [ ] DD-1407 Add sensitive-value detection for responses, logs, events, and evidence.
- [ ] DD-1408 Assign residual-risk owners.

## DD-150 — Release and closeout

- [ ] DD-1501 Run all registered tests and OpenAPI validation.
- [ ] DD-1502 Verify CI on the exact head SHA.
- [ ] DD-1503 Run dev/staging verification.
- [ ] DD-1504 Run release readiness.
- [ ] DD-1505 Rehearse capability-level rollback.
- [ ] DD-1506 Approve bounded production canary.
- [ ] DD-1507 Verify deployed commit parity.
- [ ] DD-1508 Run post-merge audit.
- [ ] DD-1509 Record implementation PR numbers and merge SHAs.
- [ ] DD-1510 Resolve Spec Kit completion gate findings.

## Dependency ordering

```text
DD-00
-> DD-10 and DD-20
-> DD-30 and DD-40
-> DD-50 and DD-60
-> DD-70 and DD-80
-> DD-90
-> DD-110 and DD-120
-> DD-130 and DD-140
-> DD-150
```

API contract refinement and testing proceed continuously, but enforcement cannot outrun authority mapping, approval binding, idempotency, adapter certification, and readback.
