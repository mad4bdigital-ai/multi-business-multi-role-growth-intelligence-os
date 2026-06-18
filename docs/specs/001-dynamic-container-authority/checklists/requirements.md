# Requirements Quality Checklist

## Scope and decisions

- [x] Dynamic container types and classifications.
- [x] Multiple containment parents with cycle prevention.
- [x] Sharing separate from containment and read-only by default.
- [x] Explicit operation-bounded write delegation.
- [x] Role templates and direct assignments.
- [x] Activity and Workflow as container types.
- [x] No implicit `platform_owner` bypass.
- [x] Two approvers for destructive/credential/deployment overrides.
- [x] 15-minute critical and 60-minute standard TTLs.

## Security

- [x] Authorization before credential materialization.
- [x] Passive preview contract.
- [x] Deny/restrict precedence.
- [x] Cross-tenant containment rejected.
- [x] Ambiguity blocks.
- [x] Override hash, scope, expiry, and stale-snapshot rules.
- [x] Distinct second approver.
- [x] No secrets in bindings, ledgers, logs, or responses.

## Data and performance

- [x] Canonical authority separated from Platform Graph projection.
- [x] Additive schema posture and legacy adapters.
- [x] Bounded traversal/closure and indexes identified.
- [ ] Fix exact query/path limits before schema approval.
- [ ] Complete migration statement count and rollback SQL in implementation PR.

## API

- [x] OpenAPI 3.1 additive resource contracts.
- [x] Strict request schemas.
- [x] 400/403/404/409/422 classes.
- [x] Stable error taxonomy.
- [ ] Finalize route-specific auth scopes/exposure before implementation.

## Testing and rollout

- [x] Multi-parent, cycle, conflict, deny, sharing, delegation, override, stale snapshot, and audit cases.
- [x] Shadow-first, read-only canary, bounded mutation rollout, non-destructive rollback.
- [ ] Approve shadow mismatch thresholds.
- [ ] Approve performance benchmark limits.

## Design-freeze approval gate

- [ ] Domain review.
- [ ] Security review.
- [ ] Database/index review.
- [ ] API contract review.
- [ ] Rollout/rollback review.
- [ ] Confirm auth-lifecycle repair remains a separate PR.
