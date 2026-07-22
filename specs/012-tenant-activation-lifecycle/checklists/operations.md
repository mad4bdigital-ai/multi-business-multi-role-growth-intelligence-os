# Operations Checklist: Tenant GPT Activation Lifecycle

**Status**: Planning complete; runtime evidence pending implementation

## Runtime authority and dependencies

- [x] SQL/registry is the runtime authority.
- [x] Backend bootstrap replaces deprecated Sheets bootstrap.
- [x] Provider bootstrap surfaces and classifications are identified.
- [x] GitHub `main` → Hostinger is the normal production path.
- [ ] Exact current route/action/table inventory is attached. Pending T001-T003.
- [ ] Dependency ownership and support escalation contacts are assigned.

## Observability

- [x] Request, operation, session, stage, deployment, delivery, and acknowledgement correlation is specified.
- [x] Stage status, latency, retryability, source, and evidence freshness are specified.
- [x] OAuth-to-gateway gap metric is specified.
- [x] Reconnect-guidance reason metric is specified.
- [x] Unknown-outcome and reconciliation metrics are specified.
- [x] Deployment parity/stale classification is specified.
- [ ] Production SLO thresholds and alert windows are approved. Pending Q-004.

## Availability and retry

- [x] Partial dependency degradation is separated from authentication failure.
- [x] Safe reads and unsafe mutations have different retry rules.
- [x] 429 honors retry guidance.
- [x] Unknown mutation outcomes reconcile before replay.
- [x] Retry budgets/backoff and terminal classifications are planned.
- [ ] Dependency-specific timeouts and retry counts are approved.

## Data and migration

- [x] Migration strategy is additive and governed.
- [x] Preflight, migration ledger, table/index/constraint readback, and rollback are required.
- [x] Historical backfill cannot synthesize false success.
- [x] Evidence is preserved during emergency rollback.
- [ ] Existing/new table mapping and migration requirement are finalized. Pending Q-001/T014.
- [ ] Retention/archival jobs are approved.

## Deployment

- [x] Specification, implementation, and closeout use separate governed stages.
- [x] Required CI and branch freshness are required before merge.
- [x] Production/main SHA parity is required.
- [x] Health and protected Tenant user-path smoke are required.
- [x] Stale-runtime attempts are classified separately.
- [x] Feature-gated shadow/internal/canary/GA rollout is defined.
- [ ] Final deployment version exposure contract is approved. Pending Q-005.

## Rollback and recovery

- [x] Rollback triggers are defined.
- [x] Feature disablement or prior release rollback is preferred.
- [x] In-flight and unknown operations are reconciled across rollback.
- [x] Auth, gateway, session, activation, and delivery smoke are required after rollback.
- [x] Operator recovery requires approval/resource authority/readback.
- [ ] Prior stable revision selection and rollback automation are validated in production-like environment.

## Runbooks required

- [ ] OAuth client/callback/code/token failure.
- [ ] Wrong-resource/audience/gateway denial.
- [ ] Membership/workspace/session failure.
- [ ] Connector/provider-bootstrap degradation.
- [ ] Tool visibility/readiness/credential gap.
- [ ] Unknown outcome and reconciliation.
- [ ] Delivery/acknowledgement failure.
- [ ] Stale deployment/parity mismatch.
- [ ] Migration failure/partial application.
- [ ] Feature disablement and release rollback.

## Production closeout

- [ ] All required PRs merged on fresh base.
- [ ] CI successful for exact merged revisions.
- [ ] Migrations and registries verified where applicable.
- [ ] Production/main parity verified.
- [ ] Service health verified.
- [ ] First-time and returning-user activation smoke verified.
- [ ] Auth failure, dependency degradation, stale deployment, retry, unknown outcome, and rollback smoke verified.
- [ ] No unresolved critical/high operational attention remains.
- [ ] Completion evidence validated, bounded, and no-secret.
