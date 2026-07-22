# Cross-Cutting Concerns: Tenant GPT Activation Lifecycle

## Purpose

This document captures risks and controls that apply across OAuth, gateway, tenant resolution, bootstrap, tools, evidence, delivery, deployment, and recovery. Each concern must trace to requirements, operation paths, implementation tasks, and tests.

## Concern matrix

| ID | Concern | Failure mode | Prevention | Detection/evidence | Recovery | Required tests |
|---|---|---|---|---|---|---|
| C-001 | Authentication | Missing, expired, malformed, or revoked token | Strict bearer/JWT validation | Gateway verification status | Reconnect only when verified | Missing/expired/invalid token |
| C-002 | Authorization | Authenticated user lacks tenant/app/action permission | Membership, scope, capability, resource authority checks | Authorization decision evidence | Access request/operator review | Role/scope denial |
| C-003 | Tenant isolation | Caller injects another tenant or workspace | Derive identity from JWT + registry; ignore overrides | Tenant mismatch alert | Reject and investigate | Cross-tenant body/path/header injection |
| C-004 | Resource binding | Auth/Core token accepted by Activation | Single audience + resource enforcement | Audience/resource evidence | Reauthorize correct resource | Wrong-resource and multi-audience tokens |
| C-005 | Host trust | Spoofed forwarded host changes resource profile | Trust ordered original-host evidence from controlled proxy; allowlist hosts | Host/profile mismatch evidence | Reject request | Host spoof and unregistered host |
| C-006 | Callback integrity | OAuth code delivered to unregistered callback | Exact normalized callback allowlist | Callback rejection logs | Correct GPT config | Alternate host/path/query callbacks |
| C-007 | Authorization-code replay | Code reused or raced | Hashed one-time record, atomic consumption, short TTL | Reuse attempt counter | Reject and rotate connection if abuse | Concurrent exchange/replay |
| C-008 | Token replay | Stolen token reused | Short TTL, resource binding, revocation/JTI strategy where required | Repeated JTI/anomaly evidence | Revoke/reconnect | Replay within and after expiry |
| C-009 | Idempotency | Repeated Activate creates duplicate unsafe state | Operation key and idempotent create/reuse policy | Duplicate operation fingerprint | Return existing operation | Concurrent/repeated Activate |
| C-010 | Unknown outcome | Timeout after mutation dispatch leads to blind retry | Durable receipt and reconcile-before-retry | `unknown_outcome` state | Readback/reconciliation | Timeout after send |
| C-011 | Session continuity | Wrong session reused across tenant/user | Scope session by verified tenant/user and policy | Session scope evidence | Close/recreate session | Cross-user reuse and stale sessions |
| C-012 | Membership changes | Revoked membership remains effective | Resolve active membership on protected operation | Membership version/status | Revoke session/tool visibility | Revocation between OAuth and Activate |
| C-013 | Workspace readiness | Missing or incomplete workspace misreported as auth issue | Separate bootstrap classification | Workspace registry evidence | Complete bootstrap | Missing/disabled workspace |
| C-014 | Connector readiness | App connection missing/degraded | Per-app connection status and mode | Connector registry/readback | Connect/recover named app | Mixed app readiness |
| C-015 | Provider dependency | Drive/GitHub/provider validation fails | Bounded validation, timeout, retries, rate-limit handling | Stage evidence and retry-after | Retry or degrade surface | 401/403/429/5xx/timeouts |
| C-016 | Tool exposure | Unauthorized or non-callable tool is listed | Registry callable + scope/resource filters | Tool visibility/readiness evidence | Remove/block tool | Unauthorized app/capability |
| C-017 | Credential safety | Secret leaks in logs/evidence/contracts | Redaction, no raw dumps by default, bounded summaries | Secret scanners and audit | Revoke exposed credential | Token/code/header fixtures |
| C-018 | Privacy | Excess user history exposed to GPT | Bounded history, tenant/user scoping, minimization | Response-size and field audit | Reduce/delete per policy | Cross-tenant history and overfetch |
| C-019 | Structured errors | Generic fallback hides actual stage | Stable error taxonomy and stage classification | Error-code metrics | Correct mapping/runbook | Every failure branch |
| C-020 | Availability | One degraded provider blocks all activation | Surface-level degradation and dependency isolation | Per-stage health | Continue partial readiness | Partial dependency outages |
| C-021 | Performance | Full evidence graph causes timeouts | Summary-first responses, pagination/chunks, time budgets | Stage latency and payload metrics | Defer detail | Large history/tool/evidence sets |
| C-022 | Backpressure/rate limits | Repeated retries amplify failure | Retry budgets, exponential backoff, `Retry-After` | Retry/rate metrics | Pause/reconcile | Burst and 429 scenarios |
| C-023 | Observability gaps | OAuth succeeds but no protected call is correlated | End-to-end operation/correlation IDs and stage evidence | Missing-next-stage alert | Diagnose client/runtime gap | OAuth-to-gateway gap |
| C-024 | Stale deployment | User hits old runtime after merge | Main/deployed SHA parity and build evidence | Deployment observation | Wait/redeploy/rollback | Request before/after deploy |
| C-025 | Contract drift | OpenAPI/client/runtime disagree | Canonical source + generator + CI parity | Contract checks | Fix before deploy | Schema/client mismatch |
| C-026 | Compatibility | Legacy tokens/connections break abruptly | Bounded compatibility window and telemetry | Legacy acceptance metric | Extend or end cutoff deliberately | Before/after cutoff |
| C-027 | Data migration | New ledger/schema partially applied | Additive migration, preflight, version/readback | Migration ledger | Rollback/forward-fix | Partial migration and restart |
| C-028 | Delivery semantics | Response delivered/acknowledged confused with execution | Separate delivery and acknowledgement states | Delivery receipts | Retry delivery, not execution | Delivery failure after success |
| C-029 | Operator authority | Admin repair bypasses policy or tenant scope | Capability envelope, approval, resource authority, readback | Audit log | Abort/revoke approval | Missing/stale/wrong approval |
| C-030 | Rollback | Rollback invalidates valid sessions or loses evidence | Feature flags, additive schema, reversible release | Rollback readiness evidence | Disable/rollback/reconcile | Rollback during active operations |
| C-031 | Abuse/log injection | Attacker injects untrusted values into logs or errors | Structured encoding and length bounds | Security log alerts | Block/sanitize | CRLF and oversized values |
| C-032 | SSRF/resource injection | Arbitrary resource URL causes outbound access or token issuance | Exact HTTPS origin allowlist; no fetch from input | Invalid-target metrics | Reject | Userinfo/path/query/fragment/private hosts |
| C-033 | Clock skew | Code/token incorrectly expired or accepted | Defined clock tolerance and authoritative time | Skew metrics | Correct clocks/retry | Boundary timestamps |
| C-034 | Multi-region/cache | Stale config or branch metadata produces inconsistent results | Versioned config/read-after-write and cache bypass on critical readback | Version mismatch evidence | Refresh/reconcile | Cached branch/deployment state |
| C-035 | Cost | Excess validation/tool discovery increases provider cost | Cache safe read-only evidence, limits, reuse windows | Cost/volume metrics | Throttle/optimize | Repeated activation load |
| C-036 | Supportability | User gets wrong remediation | Stage-specific next action and runbook links | Remediation outcome metrics | Operator handoff | Auth vs membership vs deploy errors |
| C-037 | Questionnaire complexity | Users cannot understand or complete configuration | Guided profiles, progressive disclosure, contextual help | Abandonment/error metrics | Save draft, recommend safe profile | Guided vs advanced usability |
| C-038 | Unsafe dynamic policy | Answers compile to excessive timeout/retry/permission behavior | Immutable domain safety bounds and schema validation | Blocked compilation and policy alerts | Reject proposal | Boundary and malicious-answer tests |
| C-039 | Version drift | Questionnaire/template/compiler changes alter meaning | Pin all versions and persist provenance/hash | Drift/parity checks | Recompile as new proposal, never silent mutation | Version migration and reproducibility |
| C-040 | Approval bypass | High-risk proposal activates without required authority | Risk-derived approval class, typed confirmation, proposal/resource binding | Approval audit and activation denial | Revoke/rollback | Missing/stale/wrong approval tests |
| C-041 | AI overreach | AI invents values or activates policy autonomously | Registry-only options, deterministic compiler, human approval gates | Recommendation/proposal audit | Reject/reset session | Hallucinated values and unauthorized activation |
| C-042 | Policy cache staleness | Runtime continues old critical policy | Versioned readback, cache invalidation/bypass for critical changes | Policy-version mismatch metrics | Refresh/rollback | Immediate narrowing tests |
| C-043 | Misleading impact preview | User trusts unsupported cost/performance estimate | Evidence provenance, uncertainty disclosure, blocked claims without data | Preview completeness checks | Require review/measurement | Missing-evidence preview tests |
| C-044 | Questionnaire data privacy | Answers reveal sensitive tenant strategy or configuration | Minimize fields, tenant scope, retention, no-secret validation | Data classification and access audit | Redact/delete under policy | Cross-tenant and secret-input tests |

## Threat scenarios

### Confused deputy

A valid Tenant GPT client asks the authorization server for a resource other than the registered Action server. The server must reject the mismatch before code issuance or token exchange.

### Cross-tenant subject substitution

A valid token for Tenant A includes a request body or path parameter for Tenant B. The application must use the verified principal context and reject or ignore the override.

### Stale success evidence

A later successful activation is incorrectly attached to an earlier failed attempt. Evidence must be operation-bound and timestamped; recovered success requires the same operation fingerprint or explicit reconciliation link.

### OAuth-success fallback

OAuth exchange succeeds, but a client-side or gateway failure prevents the first protected request. The absence of the next stage must be reported as a gateway/client transition gap, not as proof that the user is unauthenticated.

### Deployment race

The user attempts activation after merge but before production deployment. Diagnosis must compare attempt time with deployment observation and avoid attributing old-runtime behavior to current configuration.

## Privacy and retention

- Store only necessary identity and correlation identifiers.
- Hash authorization codes at rest; never store raw access tokens.
- Bound raw diagnostic capture and require elevated authority.
- Apply retention to OAuth codes, stage attempts, evidence items, delivery receipts, and operational attention.
- Preserve audit evidence long enough for security and incident review without retaining secrets or full conversational content unnecessarily.

## Performance budgets to define during planning

- Authorization page and code issuance latency.
- Token exchange latency.
- Gateway verification latency.
- Session-context summary latency and maximum response size.
- Provider-bootstrap validation time budget.
- Tool discovery count and pagination limits.
- End-to-end activation response target.

Budgets must be measured from production data before final SLO approval.

## Operational controls

- Metrics by stage, code, tenant-safe aggregation, retryability, and deployment version.
- Alerts for OAuth-to-gateway gaps, repeated unknown outcomes, cross-tenant denials, legacy-token use near cutoff, stale production parity, and unacknowledged operations.
- Runbooks for authorization, membership, workspace, connector, provider, contract, deployment, and rollback failures.
- Dashboards must show completeness/freshness and avoid implying all providers are healthy from partial evidence.

## Exit criterion

No concern may remain unowned at implementation start. Critical and high concerns require explicit task, test, rollout control, and rollback/recovery evidence.
