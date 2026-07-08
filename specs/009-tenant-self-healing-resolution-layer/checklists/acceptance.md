# Acceptance Checklist

## Father PR

- [ ] Documentation only.
- [ ] No runtime behavior change.
- [ ] No provider call or external send.
- [ ] No credential read or secret value exposure.
- [ ] No OpenAPI route activation.
- [ ] No migration execution.
- [ ] No automatic operational alert closure.
- [ ] Child PR sequence is clear and reviewable.

## Tenant safety

- [ ] Tenant scope is enforced before any Problem Card is returned.
- [ ] Cross-tenant evidence is not exposed.
- [ ] Secret-like fields are redacted defensively.
- [ ] Tenant users cannot invent action keys, endpoint keys, provider URLs, or auth headers.
- [ ] State-changing actions require capability, approval, audit, idempotency, and readback.

## Product acceptance

- [ ] Problem Cards explain issue, impact, affected resource, and next action.
- [ ] Root grouping reduces alert noise.
- [ ] Tenants can create or reuse Resolution Cases.
- [ ] Diagnostic steps are available before apply steps.
- [ ] Tenant owners can approve, reject, or defer skill approvals.
- [ ] Providers can be enabled, deferred, or explicitly disabled by policy.
- [ ] Malformed task rows can be corrected or escalated through guided flow.
- [ ] Escalations contain bounded evidence and no secrets.

## Runtime acceptance for future child PRs

- [ ] Every list endpoint uses cursor pagination.
- [ ] Every public response uses stable structured error envelopes.
- [ ] Every lifecycle transition is tested.
- [ ] Readback is required before `resolved` or `recovered` classification.
- [ ] Failure states are actionable and preserve evidence.

## Operational closeout

- [ ] `v_activation_agent_skill_grants` backlog is reduced only after approval readback.
- [ ] `source_data_quality` alerts are closed only after malformed row count reaches zero.
- [ ] WordPress/WPML alerts are closed only after diagnostic or execution readback proves the issue no longer reproduces.
- [ ] Google Ads blockers are closed or downgraded only after tenant setup or disabled-by-policy readback.
