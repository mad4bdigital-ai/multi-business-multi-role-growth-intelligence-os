# Feature Specification: [FEATURE NAME]

**Branch**: `[###-feature-name]`  
**Status**: Draft

## User scenarios

### Scenario 1 — [Primary outcome]

Given [starting context], when [action], then [observable result].

## Functional requirements

- **FR-001**: The system MUST [requirement].
- **FR-002**: The system MUST identify the logical `resource_key`.
- **FR-003**: The system MUST define Admin and Tenant scope separately.
- **FR-004**: The system MUST cover list, get, search, permissions, changes, revisions, and readback.
- **FR-005**: Every mutation MUST define validation, lifecycle, audit, approval, and same-cycle readback.
- **FR-006**: Sensitive fields MUST use an explicit allowlist.
- **FR-007**: OpenAPI 3.1 and structured error contracts MUST be included.

## Resource coverage matrix

| Resource | Sources/read models | Admin operations | Tenant operations | Search | Permissions | Changes | Revisions | Readback |
|---|---|---|---|---|---|---|---|---|

## Success criteria

- **SC-001**: Resource coverage audit reports no new blocking findings.
- **SC-002**: Tenant isolation tests pass.
- **SC-003**: OpenAPI route coverage and test-manifest gates pass.
