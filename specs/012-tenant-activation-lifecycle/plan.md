# Implementation Plan: Tenant GPT Activation Lifecycle

**Spec**: `specs/012-tenant-activation-lifecycle/spec.md`  
**Branch**: `gpt/spec-012-tenant-activation-lifecycle-speckit-20260722`  
**Status**: Draft — implementation not authorized

## Constitution check

| Principle/gate | Evidence | Status |
|---|---|---|
| Registry and SQL authority | Spec FR-019/022/023; research authority inventory | Pass |
| Complete operation paths | `operation-paths.md` OP-001..OP-018 | Pass for planning |
| Security and tenant isolation | `concerns.md`; security checklist | Pass with open cutoff decision |
| Contract-first surfaces | `contracts/` draft OpenAPI and JSON Schema | Pass for planning |
| Durable/replay-safe execution | OP-003/010/013/014 and data model | Pass with ledger ownership open |
| Evidence/readback | FR-026..035 and operation/evidence entities | Pass |
| Brownfield compatibility | Existing client/URLs preserved; bounded legacy policy | Pass with cutoff open |
| Testing and fault injection | Workstream WS5 and tasks T050..T061 | Pass |
| Governed delivery | Multi-PR plan, fresh CI/merge, auto-deploy/readback | Pass |

## Verified baseline

- The specification branch is based on a brownfield repository with existing OAuth, Activation gateway, Tenant session context, connector registry, provider-bootstrap validation, governed tools, SQL authority, and GitHub-to-Hostinger deployment.
- Current public contracts and generated files remain runtime authority; contracts in this specification are proposals only.
- Existing resource-bound Tenant GPT token and gateway enforcement work must be preserved and extended, not rewritten wholesale.
- Existing OAuth client credentials and canonical callback behavior must remain compatible.
- The primary unresolved design gap is durable cross-stage activation operation ownership and correlation.

## Technical approach

### Architectural boundary

Use four explicit layers:

1. **Interface** — OAuth routes, Activation gateway, Tenant Activation routes, metadata, and structured error mapping.
2. **Application** — activation lifecycle coordinator, stage executor, session/bootstrap orchestration, retry/reconciliation, delivery/acknowledgement.
3. **Domain/policy** — state machine, status classification, reconnect policy, idempotency/retry policy, compatibility cutoff policy.
4. **Infrastructure** — SQL repositories, connector/provider adapters, deployment parity adapter, logging/metrics/tracing.

Route handlers remain thin. They authenticate/authorize, validate input, call application services, and map responses. They do not directly coordinate multiple repositories or providers.

### Smallest safe change

- Preserve current OAuth client ID, public hosts, callback, and existing Tenant Activation endpoints.
- Add a lifecycle coordinator and durable correlation around existing stages rather than replacing them.
- Reuse existing ledgers/tables where semantics fit; introduce additive tables only when required.
- Centralize stage classification and reconnect guidance.
- Add proposed operation/status endpoints only after compatibility and consumer review.
- Keep provider writes and sensitive execution outside this feature.

## Workstreams

### WS1 — Baseline, contracts, and authority inventory

Deliverables:

- Inventory every current Tenant Activation/Resolution path and operation ID.
- Map OAuth, gateway, session, workspace, connection, provider, tool, operation, evidence, delivery, and deployment authorities.
- Finalize proposed OpenAPI and JSON Schema.
- Resolve open questions Q-001..Q-005.

### WS2 — Domain lifecycle and durable operation model

Deliverables:

- Activation operation state machine.
- Stage attempt and evidence model.
- Reconnect-guidance policy.
- Retry/idempotency and unknown-outcome reconciliation policy.
- Delivery/acknowledgement separation.
- Deployment observation classification.

### WS3 — OAuth, gateway, and principal correlation

Deliverables:

- Correlation from code exchange to first protected call where technically possible without exposing secrets.
- Trusted host/client/resource profile evidence.
- Strict principal context and membership refresh.
- OAuth-to-gateway gap classification.
- Legacy audience cutoff controls and telemetry.

### WS4 — Session, bootstrap, connections, tools, and dispatch readiness

Deliverables:

- Session-context stage integration.
- Managed/dedicated/mixed mode readiness.
- Backend bootstrap and provider-bootstrap stage integration.
- Per-app connection and tool readiness.
- Registry-derived dispatch preparation.

### WS5 — Observability, tests, deployment, and operations

Deliverables:

- Structured stage logs, metrics, traces, and alerts.
- Unit, integration, contract, security, replay, timeout, and rollback tests.
- CI gates and generated-contract parity.
- Feature-gated rollout and compatibility monitoring.
- Production/main parity, health, protected-user-path smoke, and runbooks.

### WS6 — Delivery and closeout

Deliverables:

- Specification PR closeout.
- Implementation PR sequence.
- Migration evidence if required.
- Production verification and post-merge audit.
- Completion record and historical archival decision.

## Proposed implementation PR sequence

1. **PR-A — Domain and data foundation**: lifecycle state, operation/stage/evidence repositories, migration if needed, unit tests.
2. **PR-B — OAuth/gateway correlation**: principal/resource evidence, gap classification, compatibility telemetry, security tests.
3. **PR-C — Activation coordinator**: session/bootstrap/connection/tool stages and structured status mapping.
4. **PR-D — Retry, reconciliation, delivery, acknowledgement**: durable retry and user response lifecycle.
5. **PR-E — Contracts and observability**: canonical OpenAPI, generated artifacts, metrics, alerts, runbooks, CI.
6. **PR-F — Rollout and closeout**: flags/cutoff, production smoke, completion evidence, cleanup.

PRs may be combined only if the resulting diff remains reviewable and all boundaries are preserved.

## Dependency order

```text
Authority inventory
→ final contracts and state model
→ additive data foundation
→ lifecycle domain policies
→ OAuth/gateway correlation
→ session/bootstrap/tool orchestration
→ retry/reconciliation/delivery
→ observability and CI
→ rollout
→ production verification
→ closeout
```

## Data and migration plan

### Phase 1 — Inventory

Determine whether existing operation, attempt, evidence, delivery, and acknowledgement tables meet the required semantics. Document reuse and conflicts.

### Phase 2 — Additive schema

If required, add only additive tables/columns/indexes. Candidate additions are defined in `data-model.md`. No destructive rename/drop is permitted in the first release.

### Phase 3 — Governed migration

- Run migration preflight and capability authorization.
- Validate SQL syntax and expected current schema.
- Apply through the governed migration runner.
- Read back tables, columns, indexes, constraints, registry rows, and migration ledger.
- Keep compatibility with existing records.

### Phase 4 — Backfill/projection

If historical correlation is required, create a bounded idempotent projection/backfill with checkpoints. Do not synthesize false success or attach unrelated evidence.

### Rollback

- Prefer disabling new lifecycle writes while preserving additive schema.
- Revert application reads to existing behavior if necessary.
- Do not drop evidence tables during emergency rollback.
- Reconcile operations crossing the rollback boundary.

## API and contract plan

- Draft contracts live under this spec and are non-runtime.
- Implementation edits canonical sources under `canonicals/` and runs `node build-canonicals.mjs`.
- OpenAPI remains 3.1.
- Existing endpoints remain compatible; new fields are optional during migration.
- New operation/status endpoints require consumer review and may launch behind a feature flag.
- Error codes are stable and stage-specific.
- Summary responses remain bounded; details use pagination/chunk references.

## Security plan

### Required controls

- Registered client and callback validation.
- Trusted host and exact resource allowlist.
- Single-audience token enforcement.
- JWT issuer, purpose, expiry, tenant, user, and scope checks.
- Active membership refresh at protected entry.
- No caller tenant/user/workspace override.
- Hashed one-time authorization codes.
- No raw tokens/codes/secrets in logs, fixtures, evidence, or GPT responses.
- Capability/approval/resource authority for recovery and mutation.

### Required threat tests

- Callback manipulation.
- Code replay and concurrent exchange.
- Wrong client/resource/host.
- Multi-audience and legacy-after-cutoff tokens.
- Cross-tenant subject substitution.
- Revoked membership after OAuth.
- Tool privilege expansion.
- SSRF-like resource identifiers.
- Log injection and oversized values.
- Unknown outcome and duplicate mutation prevention.

## Test plan

### Unit

- State transitions and terminal states.
- Stage classification and reconnect policy.
- Retry/idempotency/reconciliation decisions.
- Host/resource normalization.
- Compatibility cutoff.
- Error mapping and no-secret redaction.

### Integration

- OAuth authorize → code → token.
- Token → gateway → membership → session context.
- Session → bootstrap → connections → tools.
- Provider validation classification.
- Operation evidence → delivery → acknowledgement.
- Deployment observation classification.

### Contract

- OpenAPI parse/validation.
- Canonical/generated parity.
- JSON Schema validation for operation/evidence responses.
- Stable errors and security schemes.

### Fault injection

- 401/403/429/5xx/timeouts at every dependency.
- Transport failure before and after possible mutation.
- Database conflict/deadlock and code-consumption race.
- Stale cache/config/deployment metadata.
- Partial migration and restart.
- Delivery failure after successful activation.

### CI and production

- Syntax and architecture drift checks.
- Unit/integration/security/contract tests.
- Migration preflight where applicable.
- Fresh branch/base gate.
- Production/main SHA parity.
- Health and Tenant user JWT smoke through Activation gateway.
- Rollback/disable-path smoke.

## Observability plan

### Logs

Structured events per operation/stage with request and operation IDs, stage status, latency, retryability, source, deployment version, and no secrets.

### Metrics

- authorization success/failure by stable code;
- token exchange and replay denial;
- OAuth-to-gateway gap count;
- session/bootstrap/tool stage latency and outcome;
- reconnect guidance reason;
- legacy token acceptance;
- unknown outcome and reconciliation duration;
- delivery/acknowledgement lag;
- deployment stale classifications.

### Alerts

- sudden OAuth-to-gateway gaps;
- cross-tenant/wrong-resource attempts;
- high reconnect guidance after successful OAuth;
- repeated unknown outcomes;
- provider-validation rate limits/failures;
- production/main divergence;
- stalled or unacknowledged operations.

## Rollout plan

### R0 — Specification and baseline

No runtime change. Approve contracts, state, data ownership, SLOs, and open questions.

### R1 — Shadow evidence

Write or compute stage evidence without changing user-visible classification. Compare against existing behavior.

### R2 — Internal status adoption

Use lifecycle coordinator for operator diagnostics and internal activation summaries.

### R3 — Tenant canary

Enable stage-specific status and retry policy for selected tenants. Monitor auth, latency, error, and support signals.

### R4 — General availability

Enable for all tenants when thresholds pass. Continue bounded legacy compatibility.

### R5 — Compatibility cleanup

End legacy audience/response compatibility at the approved cutoff; remove dead code and finalize docs.

## Rollback triggers

- Increased valid-user `401/403` rate.
- Cross-tenant or wrong-resource acceptance.
- Duplicate unsafe operations.
- Session/bootstrap latency beyond approved threshold.
- Contract incompatibility with ChatGPT Action client.
- Production/main divergence or migration inconsistency.
- Secret leakage or audit incompleteness.

## Rollback actions

1. Disable new lifecycle enforcement or coordinator via feature flag.
2. Preserve operation/evidence records.
3. Restore prior stable release through governed deployment.
4. Verify auth, gateway, session, and activation smoke.
5. Reconcile in-flight/unknown operations.
6. Publish accurate degraded status and incident evidence.

## Evidence and completion

Completion requires:

- specification PR merged;
- implementation tasks traced to commits and tests;
- all required CI checks successful on fresh base;
- migration and registry readback if applicable;
- production/main parity;
- service health;
- protected Tenant user-path smoke;
- reconnect, dependency, stale-deployment, and unknown-outcome scenarios verified;
- rollback readiness;
- no unresolved critical/high concerns;
- completion JSON validated and no-secret.

## Risks and mitigations

| Risk | Probability | Impact | Prevention | Detection | Recovery |
|---|---|---|---|---|---|
| Lifecycle model duplicates existing ledgers | Medium | Medium | Inventory before schema | Architecture review | Reuse/projection |
| Correlation unavailable across ChatGPT OAuth boundary | Medium | Medium | Bounded hash/state linkage and time correlation | Gap metric | Classify uncorrelated transition honestly |
| New gateway checks reject valid legacy users | Medium | High | Shadow/canary and cutoff | 401/403 telemetry | Feature disable/compat window |
| Stage orchestration increases latency | Medium | Medium | Summary-first and budgets | Stage latency metrics | Parallelize safe reads/defer detail |
| Generic errors persist in client mapping | Medium | High | Central error taxonomy | Response contract tests | Correct mapping/runbook |
| Deployment races cause false diagnosis | High | Medium | Deployment observations | Parity metric | Wait/redeploy/reclassify |
| Unknown outcome creates duplicates | Low | Critical | Durable identity/reconcile-first | Duplicate fingerprint alerts | Reconcile/compensate |
| Secrets enter evidence | Low | Critical | Redaction/no-raw rules | Secret scanning | Revoke/purge/incident response |
