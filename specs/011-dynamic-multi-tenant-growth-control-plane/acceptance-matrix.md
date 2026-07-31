# Acceptance Matrix

| Area | Acceptance criterion | Evidence |
|---|---|---|
| Tenancy | Cross-tenant and cross-brand access denies before resource/credential lookup | integration/security tests |
| Context | Principal, tenant, workspace, brand, activity and objective resolve canonically or block | resolver tests and reason codes |
| Registry | No duplicate active identity or ambiguous equal-ranked binding | DB constraints and resolver tests |
| Config schema | Unknown/invalid fields reject; examples validate | JSON Schema CI |
| Inheritance | Effective values and source lineage match declared precedence/operators | golden tests |
| Security merge | Lower scope cannot weaken platform mandatory controls | policy tests |
| Versioning | Active versions immutable; publish creates new version and CAS pointer | repository tests |
| Snapshot | Plan stores revision vector, source versions, lineage and SHA-256 | plan readback |
| Activity Pack | Package completeness and compatibility validated before activation | package validation report |
| Multi-activity | Ambiguous activity request blocks; bindings remain independent | scenario tests |
| Capability | Semantic capability contract includes effects, approval and readback | registry/readiness evidence |
| Workflow | DAG detects cycles, incompatibility, missing dependencies and fan-out | compiler tests |
| Provider effects | Provider write is an explicit node and cannot be implied | graph/effect tests |
| Policy | Bounded operators/effects; ambiguous outcome blocks | policy compiler tests |
| Approval | Approval binds plan/actions/resources/environment/hash/expiry | replay/mismatch tests |
| Resource authority | Final boundary revalidates active binding/grant | revocation tests |
| Provider selection | Certified deterministic adapter or block on tie | resolver tests |
| Credentials | Only references in control plane; no secret in outputs/events/logs | secret scan |
| Idempotency | Duplicate dispatch produces at most one effect | concurrency tests |
| Unknown effect | Reconcile only; no blind retry | timeout tests |
| Readback | Required mutation cannot complete without same-cycle evidence | end-to-end tests |
| UI | Manifest-generated forms match schema; backend remains authoritative | contract/UI tests |
| Events | Typed, versioned, scoped, idempotent and no-secret | schema/consumer tests |
| Cache | Scope/version keys and immediate security invalidation | invalidation tests |
| Analytics | Native KPI definition and lineage preserved | projection tests |
| APIs | OpenAPI 3.1, structured errors, pagination, auth scopes and examples | OpenAPI validation |
| Lifecycle | Draft/validate/activate/deprecate/archive/rollback states enforced | state-machine tests |
| Migration | Additive, dry-run/apply/readback and legacy compatibility | migration ledger evidence |
| Rollout | Shadow -> allowlist -> staging -> canary -> GA with rollback | rollout records |
| Observability | Required metrics, traces, alerts and reason codes emitted | dashboard/audit |
| Historical replay | Old plan reproduces using pinned snapshots after new versions | replay test |
| Architecture | API -> application -> domain; adapters behind ports | architecture drift CI |
| Documentation | Canonicals, OpenAPI, knowledge guide and completion evidence updated | closeout review |

## Specification acceptance

The Spec PR is accepted when all 26 planned files exist, JSON and OpenAPI parse/validate, all FRs map to design/tests/tasks, risks and threats have controls, and the branch remains specification-only.

## Implementation acceptance

Implementation is not accepted by merging code alone. It requires governed migration evidence, dev/staging proof, production canary, readback, rollback evidence, production parity, and post-merge audit.
