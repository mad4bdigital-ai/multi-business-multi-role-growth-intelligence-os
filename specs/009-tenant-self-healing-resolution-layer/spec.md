# Spec 009: Tenant Self-Healing Resolution Layer

## Purpose

Define a tenant-facing, governed resolution layer that converts Operational Attention alerts into explainable, scoped, self-service resolution cases. The goal is to let tenants diagnose, decide, approve, apply safe fixes, verify readback, and escalate only when platform authority or provider readiness is missing.

This father PR is documentation and planning only. It must not enable provider writes, external sends, credential reads, runtime dispatch, protected-branch mutation, ad spend, publishing, connector shell execution, or automatic alert closure.

## Problem statement

Operational Attention currently exposes high-value evidence but still behaves like an operator/admin alert list. Tenants can see symptoms only when surfaced manually, and platform admins are tempted to fix recurring tickets one by one. That does not scale.

Recent attention families show the pattern:

1. WordPress/WPML execution failures need tenant-visible site diagnostics, not silent admin repair.
2. Skill approval backlog needs tenant-owner decisions, not indefinite open alerts.
3. Pending task source malformed rows need guided source repair and validation.
4. Google Ads blockers need tenant setup or explicit disabled-by-policy decisions.
5. Connector and runtime readiness issues need safe tenant self-repair, not unrestricted execution.

## Goals

- Group alerts by root family before presenting them to tenants.
- Convert alert groups into durable tenant resolution cases.
- Provide tenant-safe diagnosis tools for each root family.
- Require capability resolution before any state-changing action is exposed.
- Require approval holds, typed confirmation, audit, idempotency, and same-cycle readback for all risky actions.
- Preserve no-secret and no-cross-tenant guarantees.
- Escalate to platform admins only with complete bounded evidence.
- Close or downgrade alerts only after readback proves the outcome.

## Non-goals

- No automatic provider writes.
- No ad spend or campaign mutation.
- No WordPress publish or media upload mutation from this PR.
- No connector shell/file/service mutation from this PR.
- No migration execution from this PR.
- No direct replacement of existing Operational Attention authority.
- No tenant bypass of capability, resource binding, or approval gates.

## Primary users

- Tenant owner: sees workspace health, approves skills, decides provider setup, and runs safe self-service repairs.
- Tenant operator: diagnoses issues and prepares resolution requests within granted workspace scope.
- Platform admin: receives escalations with evidence only when tenant authority is insufficient or platform gaps block resolution.
- Agent/runtime: consumes resolution cases and playbooks without inventing action keys or executing outside registry authority.

## Core model

### Problem Card

A tenant-safe projection of one or more Operational Attention alerts.

Required fields:

- `problem_key`
- `tenant_id`
- `workspace_id`
- `resource_ref`
- `root_family`
- `severity`
- `impact_summary`
- `evidence_refs`
- `recommended_playbook_key`
- `allowed_next_actions`
- `blocked_reasons`
- `secrets_included=false`

### Resolution Case

A durable workflow instance for one root problem.

Lifecycle:

```text
detected -> diagnosing -> needs_connection -> needs_approval -> ready_to_apply -> applying -> verifying -> resolved
                         -> deferred_by_policy
                         -> escalated
                         -> blocked_missing_authority
```

### Resolution Playbook

A governed recipe that maps a root family to diagnostic, decision, apply, and readback steps.

Playbooks must declare:

- `root_family`
- `tenant_visible`
- `required_capability_key`
- `risk_level`
- `diagnostic_tool_key`
- `decision_tool_key`
- `apply_tool_key`
- `readback_tool_key`
- `approval_required`
- `readback_required`
- `escalation_policy`

## Initial root families

1. `wordpress_site_health`
   - Covers WordPress media failures, WPML context validation, site connection readiness, and WordPress write approval gaps.
2. `tenant_skill_approval`
   - Covers active skill grants that require tenant or platform owner decision.
3. `task_source_quality`
   - Covers malformed pending task rows and missing stable task identity.
4. `provider_setup_ads`
   - Covers Google Ads connection, budget preflight, and disabled-by-design decisions.
5. `connector_runtime_readiness`
   - Covers pending connector installs, heartbeat failure, local connector self-repair, and runtime binding gaps.

## Functional requirements

### FR-001 Tenant-scoped Operational Attention projection

The system must provide a tenant-safe attention list that returns only authorized alerts and redacted evidence. It must not expose other tenants, raw provider payloads, credentials, stack traces, or internal-only execution details.

### FR-002 Root grouping

The system must group matching alerts into root families before tenant presentation. Grouping must preserve source alert keys and evidence refs for audit and readback.

### FR-003 Resolution case creation

A tenant or authorized agent must be able to create or reuse one resolution case for a root group. Duplicate alerts should converge on the same active case when root family, resource, tenant, and evidence fingerprint match.

### FR-004 Diagnostic-only first phase

Every playbook must support a diagnostic-only phase that performs no provider writes, no external sends, no credential payload reads, and no runtime execution.

### FR-005 Tenant Approval Center

The system must present skill approvals and risky actions as explicit decisions with scope, risk, expiration, and readback requirements.

### FR-006 Provider setup decisions

Provider setup playbooks must allow tenants to choose enable, defer, or disabled-by-policy. Disabled-by-policy must downgrade or close blockers only after readback records the decision.

### FR-007 Capability gate before apply

No apply step may be exposed unless the effective capability resolver returns authority for the tenant/workspace/resource and the required dispatch/readback certifications are present.

### FR-008 Approval and typed confirmation

State-changing actions must require approval holds and typed confirmation when policy requires it. Approval alone must not execute providers.

### FR-009 Same-cycle readback

A resolution case can move to resolved only after readback verifies the expected state and no matching alert remains active or the alert lifecycle was explicitly updated with evidence.

### FR-010 Escalation contract

Escalation to platform admin must include the case, root family, tenant scope, safe evidence refs, blocked gates, attempted diagnostics, and recommended platform action. It must not include secrets.

## Non-functional requirements

- Fail closed on ambiguous scope, missing resource binding, missing readback contract, expired capability envelope, or incomplete evidence.
- Keep API responses structured and predictable.
- Use cursor pagination for lists.
- Include `secrets_included=false` in all tenant-facing outputs.
- Keep runtime writes idempotent.
- Preserve `src/api`, `src/application`, `src/domain`, and `src/infrastructure` boundaries.
- Add tests for authorization, no-secret redaction, lifecycle transitions, dedupe, and readback.

## Acceptance criteria

- Tenants can view grouped Problem Cards for their authorized workspace only.
- A tenant can create a Resolution Case from a Problem Card.
- Diagnostic playbooks return bounded explanations and no secrets.
- Skill approvals can be approved, rejected, or deferred with audit and readback.
- Provider blockers can be explicitly disabled by policy by the tenant owner.
- Malformed task source rows can be repaired or escalated through a guided flow.
- State-changing apply steps remain blocked unless capability, approval, audit, and readback gates pass.
- Operational Attention does not mark recovered without same-cycle evidence.

## Open questions

- Which tenant roles can approve each skill family by default?
- Which root families should be tenant-visible on day one versus platform-only?
- Should disabled-by-policy decisions expire and re-prompt after a fixed interval?
- Which WordPress/WPML diagnostics are tenant-safe without plugin-specific credentials?
- Should malformed task repair allow deletion, or only correction/defer/escalate in V1?
