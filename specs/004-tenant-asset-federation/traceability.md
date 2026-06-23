# Traceability

| User requirement | Specification location | Planned evidence |
|---|---|---|
| Any tenant may adopt platform-base assets | `spec.md` FR-001–FR-003 | catalog/adoption tests |
| Tenant edits its own version | Ownership modes and FR-004 | copy-on-write/version tests |
| Platform original remains protected | Safety floor and permissions matrix | immutability tests |
| Workspace scope | Scope dimensions | resolver tests |
| Brand scope | Scope dimensions | resolver tests |
| Business activity type scope | Scope dimensions | resolver tests |
| Role scope | Scope dimensions | resolver tests |
| User chooses union or intersection | Composition modes | deterministic composition tests |
| Tenant supplies plugin/app/action credentials | Credential model and FR-009–FR-010 | vault reference/non-disclosure tests |
| Agents, skills, policies, workflows, apps, actions, plugins, etc. | Asset classes | catalog type coverage |
| Sensitive assets remain governed | Safety floor and permissions matrix | approval/policy tests |
| Upgrade tenant copies from platform base | Version and upgrade model | rebase/conflict/rollback tests |
| No cross-tenant leakage | Non-functional requirements | repository/service isolation tests |
| Existing runtime remains safe during migration | FR-014 and phased rollout | shadow parity reports |
