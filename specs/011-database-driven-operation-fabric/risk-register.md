# Risk Register

| Risk | Severity | Mitigation | Stop condition |
|---|---|---|---|
| SQL becomes an executable-code store | Critical | Store identifiers and declarative metadata only; code handler allowlist. | Executable source or arbitrary command enters registry. |
| Tool projection exposes unauthorized Tenant operation | Critical | Strict schema, manifest, scope, binding, readiness, listing/dispatch parity. | Any cross-scope visibility or dispatch. |
| Managed worker writes wrong ref | Critical | Expected SHA, protected-branch block, no force, lease, remote readback. | Ref/ancestry mismatch. |
| Capability renewal outlives operation | High | Operation-bound TTL, active-state check, consumption and audit. | Renewal without active bound run. |
| Projection compiler causes partial visibility | High | Transactional apply, revision staging, cache update gate, rollback pointer. | Mixed projection revisions visible. |
| Binding resolver hides exclusions | High | Explain output and immutable candidate evidence. | Selected binding lacks explainable eligibility. |
| Generated bot races orchestrator | High | Lease-aware suppression or orchestrator-owned generation stage. | Head changes between validation and controlled update. |
| CI logs leak secrets | Critical | Redaction, bounded summaries, governed artifacts. | Secret-like value in persisted or returned output. |
| Legacy and new authority diverge | High | Shadow and dual-read parity with explicit mismatch ledger. | Active cutover with unresolved mismatch. |
| Local connector remains hidden dependency | Medium | Managed cloud binding is primary for cloud repository work. | Local outage blocks eligible managed operation. |
| Health data is stale | High | Freshness deadlines and fail-closed resolver. | Stale record selected as healthy. |
| Retry duplicates effects | Critical | Idempotency and readback-before-retry. | Retry occurs with unknown effect state. |
| Migration cannot be rolled back | High | Disable-first lifecycle and corrective forward migration plan. | No safe disable or recovery path. |
| Operation surface becomes too generic | High | Typed operation contracts and bounded handler keys. | Arbitrary SQL/HTTP/shell exposed through generic operation. |

## Governance response

Critical stop conditions block promotion and require a new reviewed plan. High risks require explicit evidence and owner before pilot. Medium risks require tracked remediation before broad cutover.
