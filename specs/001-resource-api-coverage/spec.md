# Feature Specification: Self-Discovering Resource API Coverage

**Branch**: `gpt/resource-api-coverage-gate-20260622`  
**Status**: Approved for implementation

## Problem

The platform contains hundreds of SQL tables and many read-model views, but resource-facing operations are uneven. Write and execution routes can exist without equivalent list, get, search, permissions, changes, revisions, or readback routes. Session archives exposed this gap directly.

## Goal

Create a fail-closed governance layer that discovers similar gaps, prevents uncovered feature surfaces from merging, and introduces a consistent resource API for Admin and Tenant principals.

## User scenarios

### Admin discovers coverage debt

Given an authenticated platform administrator, when the coverage audit runs, then it reports uncovered tables, views, tools, scope gaps, lifecycle gaps, and unexported read models without exposing secrets.

### Tenant reads authorized resources

Given a signed-in tenant member with active membership, when the member lists or gets a resource, then tenant/workspace/user scope is resolved server-side and only safe fields are returned.

### CI blocks an uncovered feature

Given a change that adds a table, view, route, or tool export, when the change lacks a resource descriptor, OpenAPI contract, or required operation coverage, then CI fails with a structured finding.

## Functional requirements

- **FR-001**: No feature without resource API coverage.
- **FR-002**: The coverage manifest MUST define each logical resource, source tables, read models, identity field, scope class, and operation states.
- **FR-003**: The first active resources MUST be Sessions, Executions, Assets, Approvals, and Resource API Governance.
- **FR-004**: Admin and Tenant routes MUST support list/get/search, permissions, changes, revisions, and readback.
- **FR-005**: Assets MAY support create/update/archive/restore through allowlisted adapters.
- **FR-006**: Hard purge MUST remain blocked until a separate retention/capability policy is approved.
- **FR-007**: Session transcript routes MUST return previews only; full content requires a future governed Drive adapter.
- **FR-008**: New relations and exported tools MUST be detected from changed migration and route files.
- **FR-009**: Existing debt MAY remain visible without blocking, but new uncovered debt MUST block merge.
- **FR-010**: Every mutation MUST perform same-cycle readback.
- **FR-011**: All responses MUST state `secrets_included: false`.

## Resource coverage matrix

| Resource | Sources | Admin | Tenant | Search | Permissions | Changes | Revisions | Readback |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| Sessions | customer_sessions, turns, summaries, events, refs | Yes | Yes | Yes | Yes | Yes | Summary history | Yes |
| Executions | execution_log, evidence views | Yes | Yes | Yes | Yes | Yes | N/A | Yes |
| Assets | workspace_assets, vaults | Yes | Yes | Yes | Yes | Yes | Planned versioning | Yes |
| Approvals | approval_holds, parent view | Yes | Yes | Yes | Yes | Yes | Planned versioning | Yes |
| Governance | resource registries and findings | Yes | No | Yes | Yes | Yes | N/A | Yes |

## Success criteria

- Coverage script exits non-zero for a newly added uncovered table, route, or tool.
- Declared resource routes are present in OpenAPI.
- Tenant resource access cannot override signed tenant/user identity.
- Session turns and transcripts never return raw `content`.
- The migration is additive and creates no provider calls or external sends.
- Post-merge live audit persists bounded findings and identifies remaining legacy debt.
