# Feature Specification: Tenant GPT Pipeline Continuity

## Goal

Make Tenant GPT readiness truthful, tenant-effective, and fail-closed while preserving existing dashboard and activation response contracts.

## Functional requirements

- **FR-001:** Every mapped dashboard action is evaluated through `tenantEffectiveCapabilityResolver` using signed tenant, user, and workspace context.
- **FR-002:** An action without `required_capability_key` is not ready and returns `capability_mapping_missing`.
- **FR-003:** `actions.runtime_callable = true` is only a registry prerequisite and cannot independently produce `ready: true`.
- **FR-004:** Resolver errors, ambiguous connections, missing grants, unvalidated connections, endpoint ambiguity, missing certification, or missing export authority fail closed.
- **FR-005:** A connected system is active only when the system is active and has at least one active, non-expired installation.
- **FR-006:** Failed or unavailable count queries produce `null` and `available: false`, never numeric zero.
- **FR-007:** Dashboard cards distinguish `unknown`, `not_connected`, `pending`, `attention`, and `active`.
- **FR-008:** Activation completeness derives `blocked_surfaces`; awareness authorization visibility is not hardcoded to 100.
- **FR-009:** All readiness evaluation is read-only and performs no provider call or external write.
- **FR-010:** Existing response keys remain available; new readiness metadata is additive.

## Non-functional requirements

Tenant/user scope comes only from signed principal context. Responses never include secrets. Resolution is bounded by unique capability keys. Errors become stable no-secret readiness states. Existing service boundaries are preserved.

## Out of scope

Registering missing capabilities, repairing credentials/installations, enabling provider writes, changing OAuth, editing active PR-owned files, or deploying production.
