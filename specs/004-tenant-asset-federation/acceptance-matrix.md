# Acceptance Matrix

| Scenario | Expected result |
|---|---|
| Tenant member views a shared agent or workflow | Canonical asset is visible without creating a tenant copy |
| Tenant grants use of a shared skill | Grant/binding changes; no variant or duplicated skill row is created |
| User selects an authorized shared workflow | Workflow is referenced directly and recorded in the runtime manifest |
| User explicitly customizes output ordering | A user-owned optional variant is created with a bounded patch |
| User resets a personal variant | Shared base becomes effective again; grants and credentials are unchanged |
| Platform updates a shared base with no patch conflict | Variant upgrade preview succeeds with deterministic checksum |
| Platform update conflicts with a variant patch | Variant enters conflict/review state; no silent overwrite |
| User selects guarded union for workflow discovery | Positive candidates are unioned, then denies and readiness gates are applied |
| User selects strict intersection for actions | Action is executable only when every required authority layer allows it |
| Intersection profile omits a required role layer | Resolution blocks with `COMPOSITION_SCOPE_MISSING` |
| Union includes an action denied by brand policy | Deny remains effective; action is excluded or blocked |
| Two equal-ranked scalar policies disagree | Resolution blocks with `POLICY_CONFLICT` |
| Tenant quota is 100 and workspace quota is 50 | Effective quota is 50 through `minimum` |
| Brand risk is medium and activity risk is high | Effective risk is high through `maximum` |
| User prefers Agent A but only Agent B is authorized | Agent B remains effective; preference cannot grant Agent A |
| User hides an authorized workflow in personal view | Workflow remains authorized but is personally de-ranked/hidden |
| User preference tries to lower approval severity | Mutation is rejected with `PREFERENCE_VALUE_NOT_ALLOWED` |
| Variant patch targets mandatory audit policy | Patch is rejected with `VARIANT_PATCH_FORBIDDEN` |
| Role allows edit but not grant | User may edit an eligible personal/scoped variant but cannot change grants |
| Brand administrator creates a brand variant | Variant is visible only in authorized brand contexts |
| Workspace profile and brand profile use different eligible operators | Each policy family resolves independently using registered semantics |
| Brand, activity, and workflow have multiple containment paths | All paths are evaluated; non-mergeable conflict blocks |
| Dynamic Container graph is empty during initial rollout | Legacy enforcement remains authoritative; shadow coverage reports missing projections |
| Current legacy policy and contextual shadow decision match | Parity sample is recorded as match |
| Current legacy policy and contextual decision differ | Mismatch is recorded; no cutover occurs |
| Shared plugin is visible but tenant has no connection | Catalog shows `credential/connection required`; asset is not executable |
| Tenant adds its own credentials through governed intake | Asset stores only opaque connection binding; secret remains in vault authority |
| Registry connector is active but installation row is absent | Operational state remains pending, not active |
| Installation exists but certification expired | Execution blocks with `CERTIFICATION_REQUIRED` |
| Approval-sensitive active grant exists without open hold | UI reports approval-sensitive grant, not pending request |
| Sensitive action is invoked | Exact approval hold is created or required; no broad permanent approval is inferred |
| User changes explanation depth | Class A preference can be applied with rollback and no authority effect |
| System observes repeated preferred workflow selection | It may create a Class B proposal with evidence; no silent change |
| System proposes composition profile change | Impact simulation and user confirmation are required |
| System proposes provider write or new grant | Classified Class E and routed to existing governed approval; no self-approval |
| Adaptive simulation detects policy regression | Proposal is blocked and cannot enter canary |
| Canary improves target KPI without guardrail regression | Proposal may be promoted to stable scoped profile/variant after criteria pass |
| Canary causes quality or safety regression | Automatic rollback/expiry is triggered and recorded |
| Tenant-local improvement is considered for platform reuse | Privacy-safe promotion candidate is created; shared base is not changed automatically |
| Cross-tenant variant or connection reference is attempted | Request is rejected before credential or provider access |
| Authority epoch changes during mutation | Mutation blocks or retries safely; stale manifest cannot dispatch |
| Preview is requested | No secret read, provider call, installation mutation, or external write occurs |
| Effective manifest is inspected | Every selected asset, profile, operator, variant, preference, and blocker is explainable |
| User opts out of behavioral adaptation | Behavioral proposals stop; explicit preferences and necessary operational telemetry remain governed separately |
| User deletes/resets preference data | Personal profile is reset without changing tenant policies, grants, or shared assets |
| Resolution exceeds path/candidate/time limits | Fails closed with typed limit error; no partial allow |
| Cached decision predates revocation | Epoch/version invalidation prevents stale authority from granting execution |

| User receives a role through a nested group | Membership path is bounded, tenant-scoped, cycle-free, versioned, and included in the manifest |
| Group membership is revoked after preview | Authority epoch/version invalidates the preview before dispatch |
| Service principal has no active owner or assurance | Sensitive execution blocks with principal-readiness evidence |
| Partner tenant manages a client tenant | No client resource access exists unless the exact relationship policy and delegated grant allow it |
| Tenant enters offboarding | New consequential work blocks; export, connection shutdown, grant disposition, legal hold, and erasure follow the lifecycle plan |
| User requests preference export or erasure | Export/reset/erasure respects legal hold and preserves only required minimal audit evidence |
| Artifact is classified for a prohibited processing purpose | Model, provider, indexing, or cross-tenant use blocks before content transfer |
| Data residency allows one region only | Ineligible model/provider/connection regions are removed from candidates |
| Cost-bearing action is previewed | Estimate and reservation requirements are shown without debit or provider write |
| Two concurrent requests reserve the same remaining budget | At most one succeeds or both receive a consistent bounded reservation result; no overspend |
| Execution fails after a cost reservation | Settlement releases/refunds unused reservation idempotently |
| Model is cheaper but fails required quality/data policy | It is excluded; free-first cannot weaken the constraints |
| Selected model version lacks current evaluation evidence | Sensitive execution blocks with `MODEL_EVALUATION_REQUIRED` |
| Model fallback would cross residency boundary | Fallback blocks rather than silently switching provider |
| External operation is retried after timeout | Universal idempotency prevents duplicate effect and records delivery semantics |
| Multi-step provider operation partially succeeds | Saga state identifies completed steps and executes or requests approved compensation |
| User cancels a queued operation before dispatch | Cancellation is durable and no provider call occurs |
| Artifact is produced | Checksum, schema, manifest, provenance, sensitivity, license, freshness, verification, and retention are recorded |
| Source artifact is corrected or erased | Dependent artifacts/indexes are revalidated, retracted, corrected, or disposed according to policy |
| Future policy is scheduled | Current and future-state previews differ by explicit `as_of` time without early enforcement |
| Preview was created in staging | It cannot authorize production execution |
| Production connection is referenced from sandbox | Environment binding blocks before credential materialization |
| Package signature or dependency evidence is missing | Code-bearing package installation/publication blocks |
| Client lacks support for manifest schema version | Compatibility negotiation selects an approved version or returns a migration/deprecation error |
| Tenant export is requested | Portable no-secret manifest is complete, checksummed, authorized, and auditable |
| Restored backup contains profiles and variants | Tenant isolation, authority epochs, manifest reconstruction, and cache invalidation pass restore validation |
| Primary approver is unavailable | Approved fallback/escalation policy applies without weakening separation of duties |
| Two assets implement the same capability | Only compatible, authorized, ready, policy-compliant alternatives are ranked by quality/risk/cost/preference |
| Arabic tenant experience uses a model without Arabic quality evidence | Model is excluded or marked insufficiently evaluated |
| Recommendation is repeatedly shown because of prior exposure | Exposure ledger and exploration/calibration controls prevent self-reinforcing ranking |
| High-volume tenant dominates aggregate evidence | Cohort and weighting controls prevent automatic platform-default promotion |

## Success thresholds before enforcement

- zero cross-tenant leakage in tests and shadow evidence;
- zero secret values in profiles, variants, manifests, proposals, and logs;
- 100% required audit coverage;
- no critical parity mismatches;
- at least the configured minimum comparable shadow samples per cutover family;
- p95 and p99 resolution latency within rollout policy budgets;
- deterministic checksum equality for repeated identical inputs;
- all mutation routes demonstrate idempotency, version conflict handling, and same-cycle readback;
- user impact preview correctly predicts changed effective fields for certified test cases;
- rollback works for profiles, variants, experiments, and resolver cutover flags.
