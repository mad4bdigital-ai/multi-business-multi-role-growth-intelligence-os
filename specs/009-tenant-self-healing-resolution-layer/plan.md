# Implementation Plan

## Delivery model

Use one father specification PR followed by bounded child PRs. This father PR is docs-only and introduces the product, runtime, API, governance, and rollout plan for tenant self-healing. Child PRs must be independently reviewable and must not combine diagnostics, approvals, provider setup, and apply execution in one change.

## Architecture

### API layer

Add tenant-safe endpoints or descriptor-backed tools:

- `tenant_operational_attention_list`
- `tenant_resolution_case_create`
- `tenant_resolution_case_get`
- `tenant_resolution_case_list`
- `tenant_resolution_diagnose`
- `tenant_resolution_plan_preview`
- `tenant_resolution_decide`
- `tenant_resolution_approval_request`
- `tenant_resolution_apply`
- `tenant_resolution_readback`
- `tenant_resolution_escalate`

Routes must handle auth, scope extraction, request validation, response mapping, and structured errors only. No deep policy or provider logic belongs in controllers.

### Application layer

Add orchestration services:

- `TenantAttentionProjectionService`
- `ResolutionCaseService`
- `ResolutionPlaybookService`
- `ResolutionDiagnosticService`
- `ResolutionDecisionService`
- `ResolutionApplyGateService`
- `ResolutionReadbackService`
- `ResolutionEscalationService`

Application services coordinate capability resolution, playbook selection, case lifecycle, approval holds, audit, and readback.

### Domain layer

Add domain concepts:

- `ProblemCard`
- `RootFamily`
- `ResolutionCase`
- `ResolutionPlaybook`
- `ResolutionStep`
- `ResolutionDecision`
- `ResolutionReadbackResult`
- `EscalationEnvelope`

Domain logic owns lifecycle transitions, dedupe keys, allowed transitions, and fail-closed decisions.

### Infrastructure layer

Add repositories/adapters:

- SQL repositories for playbooks, cases, case events, and readback snapshots.
- Adapter to read Operational Attention using SQL-primary evidence.
- Adapter to call existing capability resolution and approval-hold surfaces.
- Adapter to call existing diagnostic providers only when declared by playbook.

Infrastructure must redact secret-like fields defensively.

## Proposed storage

### `tenant_resolution_playbooks`

Purpose: static or registry-managed playbook definitions.

Fields:

- `playbook_key`
- `root_family`
- `display_name`
- `description`
- `tenant_visible`
- `required_capability_key`
- `risk_level`
- `diagnostic_tool_key`
- `decision_tool_key`
- `apply_tool_key`
- `readback_tool_key`
- `approval_required`
- `readback_required`
- `status`
- `policy_json`
- `created_at`
- `updated_at`

### `tenant_resolution_cases`

Purpose: durable root problem workflow.

Fields:

- `case_id`
- `tenant_id`
- `workspace_id`
- `resource_ref`
- `root_family`
- `playbook_key`
- `status`
- `severity`
- `source_alert_keys_json`
- `source_refs_json`
- `impact_summary`
- `current_step_key`
- `owner_user_id`
- `last_diagnostic_json`
- `last_preflight_json`
- `approval_hold_id`
- `capability_envelope_id`
- `readback_status`
- `readback_ref`
- `escalation_ref`
- `created_at`
- `updated_at`
- `closed_at`
- `secrets_included`

### `tenant_resolution_case_events`

Purpose: append-only audit trail.

Fields:

- `event_id`
- `case_id`
- `event_type`
- `actor_type`
- `actor_id`
- `from_status`
- `to_status`
- `evidence_ref`
- `event_json`
- `created_at`
- `secrets_included`

### `tenant_resolution_readbacks`

Purpose: readback snapshots tied to cases.

Fields:

- `readback_id`
- `case_id`
- `playbook_key`
- `expected_state_json`
- `observed_state_json`
- `decision`
- `blocking_reasons_json`
- `source_alerts_remaining_json`
- `created_at`
- `secrets_included`

## Initial playbooks

### P1 `wordpress_site_doctor_v1`

Diagnostic-only first release.

Steps:

1. Resolve tenant workspace, brand, and site.
2. Check resource binding and connection metadata.
3. Check WordPress REST availability without exposing credentials.
4. Check WPML context readiness when WPML signals exist.
5. Validate media endpoint preflight payload shape.
6. Return required actions: reconnect, approve WordPress write, plugin/site admin action, or platform escalation.

Apply is not enabled in V1.

### P2 `tenant_skill_approval_decision_v1`

Decision workflow for approval-required skills.

Steps:

1. Group skill alerts by tenant, workspace, agent, skill, and scope.
2. Present risk, scope, expiration, and capability effect.
3. Allow approve, reject, or defer.
4. Write approval/decision audit.
5. Readback Operational Attention and skill grant state.

### P3 `task_source_repair_v1`

Guided repair for malformed pending task rows.

Steps:

1. Identify malformed row source and missing stable fields.
2. Offer correction, defer, or escalate.
3. Validate task identity and lifecycle.
4. Write bounded repair audit when mutation is authorized.
5. Readback malformed row count.

### P4 `google_ads_setup_preflight_v1`

Tenant decision and setup flow.

Steps:

1. Ask whether Ads Governance should be enabled.
2. If enabled, check connection readiness and budget preflight authority.
3. If disabled by design, record policy decision and downgrade blockers.
4. If incomplete, create scoped setup tasks.
5. No provider call or spend change in V1.

### P5 `connector_health_repair_v1`

Read-only status plus guided installation.

Steps:

1. List connector status and heartbeat.
2. Detect pending install, missing local manager, or stale tunnel.
3. Offer installer/download link or read-only health check when authorized.
4. State-changing device operations remain blocked until separate capability and readback certification.

## Child PR order

1. `gpt/tenant-resolution-registry-schema`
   - Add additive tables and indexes for playbooks, cases, events, and readbacks.
2. `gpt/tenant-attention-projection-api`
   - Add tenant-scoped problem cards and root grouping.
3. `gpt/tenant-resolution-case-api`
   - Add case create/list/get and event audit.
4. `gpt/tenant-approval-center`
   - Add skill approval decision playbook and readback.
5. `gpt/task-source-repair-playbook`
   - Add malformed task source diagnostic and guided repair.
6. `gpt/wordpress-site-doctor-playbook`
   - Add diagnostic-only WordPress/WPML site doctor.
7. `gpt/google-ads-setup-playbook`
   - Add enable/defer/disabled-by-policy decision flow.
8. `gpt/connector-health-repair-playbook`
   - Add connector read-only repair center.
9. `gpt/tenant-resolution-apply-gates`
   - Add shared apply gate integration with capability envelopes and approval holds.
10. `gpt/tenant-resolution-readback-closeout`
   - Add readback-driven alert lifecycle closeout rules.

## API contract outline

### `GET /tenant/operational-attention/problem-cards`

Query:

- `workspace_id`
- `root_family`
- `severity`
- `cursor`
- `limit`

Response:

```json
{
  "items": [],
  "page": { "nextCursor": null, "hasMore": false },
  "secrets_included": false
}
```

### `POST /tenant/resolution/cases`

Body:

```json
{
  "problem_key": "wordpress_site_health:example",
  "playbook_key": "wordpress_site_doctor_v1"
}
```

### `POST /tenant/resolution/cases/{caseId}/diagnose`

Runs diagnostic-only playbook step. Must return `provider_write_performed=false` and `secrets_included=false`.

### `POST /tenant/resolution/cases/{caseId}/decisions`

Records tenant decision such as approve, reject, defer, disabled-by-policy, or escalate.

### `POST /tenant/resolution/cases/{caseId}/apply`

Initially disabled for most playbooks. Must require capability envelope, approval hold, typed confirmation, audit, idempotency, and readback.

### `POST /tenant/resolution/cases/{caseId}/readback`

Verifies whether the root problem is resolved, still active, deferred, or escalated.

## Error model

Use stable structured errors:

- `TENANT_RESOLUTION_SCOPE_DENIED`
- `TENANT_RESOLUTION_PLAYBOOK_NOT_FOUND`
- `TENANT_RESOLUTION_CASE_CONFLICT`
- `TENANT_RESOLUTION_INVALID_TRANSITION`
- `TENANT_RESOLUTION_CAPABILITY_BLOCKED`
- `TENANT_RESOLUTION_APPROVAL_REQUIRED`
- `TENANT_RESOLUTION_READBACK_FAILED`
- `TENANT_RESOLUTION_PROVIDER_WRITE_BLOCKED`

## Testing plan

- Unit tests for root grouping and case dedupe.
- Unit tests for lifecycle transitions.
- Authorization tests for cross-tenant and cross-workspace access.
- No-secret tests for all response payloads.
- Integration tests for Problem Card projection from mocked Operational Attention rows.
- Integration tests for skill approval decisions and readback.
- Integration tests for disabled-by-policy provider decision.
- Contract tests for error envelopes and pagination.
- Regression tests that unresolved alerts cannot be marked recovered without readback.

## Rollout plan

### Phase 0: Documentation only

This father PR.

### Phase 1: Read-only visibility

Ship problem cards, root grouping, and diagnostic-only case lifecycle. No apply.

### Phase 2: Decisions and approvals

Ship Tenant Approval Center, provider setup decisions, and task source repair decisions.

### Phase 3: Gated low-risk repair

Enable low-risk internal registry repair only where capability, approval, idempotency, and readback are ready.

### Phase 4: Provider-adjacent diagnostics

Enable WordPress/WPML and connector diagnostics. Provider writes remain blocked.

### Phase 5: Certified apply paths

Enable apply only per playbook after separate certification, release readiness, and readback contract evidence.

## Closeout definition

This spec is complete when:

- The father PR merges.
- Every child PR has a scoped branch name, acceptance criteria, and test plan.
- No runtime capability is enabled by the father PR.
- Operational Attention closeout rules require same-cycle readback.
