# Tasks

## T1 Father spec kit

- [x] Define purpose, problem, goals, and non-goals.
- [x] Define Problem Card, Resolution Case, and Resolution Playbook models.
- [x] Define initial root families.
- [x] Define implementation phases and child PR order.
- [x] Define safety invariants and closeout criteria.

## T2 Registry schema child PR

- [ ] Add `tenant_resolution_playbooks` migration.
- [ ] Add `tenant_resolution_cases` migration.
- [ ] Add `tenant_resolution_case_events` migration.
- [ ] Add `tenant_resolution_readbacks` migration.
- [ ] Add indexes for tenant, workspace, root family, status, and updated time.
- [ ] Add additive rollback notes.
- [ ] Add migration tests confirming no destructive SQL.

## T3 Tenant Attention Projection API child PR

- [ ] Add tenant-safe Problem Card DTO.
- [ ] Implement Operational Attention adapter that filters by authorized tenant/workspace.
- [ ] Implement root grouping rules for initial families.
- [ ] Add cursor pagination.
- [ ] Add no-secret redaction guard.
- [ ] Add tests for cross-tenant denial.
- [ ] Add tests for evidence refs without raw payloads.

## T4 Resolution Case API child PR

- [ ] Add case create/list/get endpoints or descriptor tools.
- [ ] Add dedupe key for active cases.
- [ ] Add append-only case events.
- [ ] Add lifecycle transition guard.
- [ ] Add conflict handling for duplicate active cases.
- [ ] Add tests for invalid transitions.

## T5 Tenant Approval Center child PR

- [ ] Group skill approval alerts by agent, skill, scope, and workspace.
- [ ] Add approve/reject/defer decision API.
- [ ] Add approval hold integration where required.
- [ ] Add expiration and decision note support.
- [ ] Add readback against skill grant and Operational Attention state.
- [ ] Add tests for owner-only approval.
- [ ] Add tests for audit and no-secret behavior.

## T6 Task Source Repair child PR

- [ ] Add malformed task diagnostic.
- [ ] Add guided correction/defer/escalate decisions.
- [ ] Validate stable `task_id`, `task_key`, `title`, status, and source.
- [ ] Add readback for malformed row count.
- [ ] Add tests that malformed rows cannot be silently omitted.

## T7 WordPress Site Doctor child PR

- [ ] Add diagnostic-only WordPress/WPML playbook.
- [ ] Resolve brand/workspace/site without credential value exposure.
- [ ] Check WordPress connection metadata and REST readiness.
- [ ] Check WPML context readiness when WPML alerts exist.
- [ ] Validate media payload shape without upload.
- [ ] Return reconnect, approval, plugin/site action, or platform escalation next steps.
- [ ] Add tests proving no provider write occurs.

## T8 Google Ads Setup Playbook child PR

- [ ] Add Ads Governance enable/defer/disabled-by-policy decision flow.
- [ ] Check connection readiness without provider mutation.
- [ ] Check budget authority preflight without spend change.
- [ ] Record disabled-by-policy as explicit tenant decision.
- [ ] Add readback that blockers are downgraded or linked to setup tasks.
- [ ] Add tests for no spend/provider call.

## T9 Connector Health Repair child PR

- [ ] Add connector status projection.
- [ ] Add heartbeat and pending installation diagnostics.
- [ ] Add installer/download handoff where authorized.
- [ ] Keep shell/file/service mutation blocked in V1.
- [ ] Add escalation envelope for platform-only connector gaps.
- [ ] Add tests for no local command dispatch.

## T10 Apply Gate child PR

- [ ] Add shared apply gate for resolution cases.
- [ ] Require capability envelope for state-changing playbooks.
- [ ] Require approval hold when policy requires.
- [ ] Require typed confirmation for high-risk actions.
- [ ] Require idempotency keys before dispatch.
- [ ] Fail closed on missing dispatch certification or resource binding.
- [ ] Add tests for blocked, approval-required, expired-envelope, and ready paths.

## T11 Readback and closeout child PR

- [ ] Add readback snapshots.
- [ ] Compare expected and observed state.
- [ ] Prevent recovered classification without same-cycle evidence.
- [ ] Link readback to Operational Attention lifecycle updates.
- [ ] Add tests for unresolved, resolved, escalated, and deferred-by-policy outcomes.

## T12 Documentation and tenant UX child PR

- [ ] Add tenant-facing copy for Problem Cards.
- [ ] Add owner/operator guidance.
- [ ] Add escalation copy with safe evidence explanation.
- [ ] Add runbook for platform admins receiving escalations.
- [ ] Add examples for each initial root family.

## Validation checklist for every child PR

- [ ] No secrets in responses, logs, docs, fixtures, or tests.
- [ ] No provider writes unless explicitly certified in that child PR.
- [ ] No direct main/protected branch mutation.
- [ ] Structured errors use stable machine-readable codes.
- [ ] Cursor pagination added for list endpoints.
- [ ] Authorization tests cover cross-tenant denial.
- [ ] Readback is required before resolved/recovered state.
- [ ] Documentation updated for behavior or API changes.
