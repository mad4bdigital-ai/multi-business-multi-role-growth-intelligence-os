# Acceptance Matrix

| ID | Scenario | Expected result |
|---|---|---|
| A-01 | Tenant user has one authorized workspace | Context resolves automatically |
| A-02 | Tenant user has multiple eligible workspaces | `interpretation_required` |
| A-03 | Admin sees multiple tenants with similar labels | No silent selection; tenant-safe candidates returned |
| A-04 | Admin requests tenant mutation without effective subject | `EFFECTIVE_SUBJECT_REQUIRED` |
| A-05 | Service principal lacks service binding | `SERVICE_BINDING_REQUIRED` |
| A-06 | Resource belongs to another tenant | `CROSS_TENANT_CONTEXT_REJECTED` |
| A-07 | Resource operation does not require brand | Brand is not requested |
| A-08 | Publishing requires Brand Core but it is unresolved | Operation blocked |
| A-09 | Two exact-capability connections remain | `CONNECTION_AMBIGUOUS` |
| A-10 | Preferred connection fails during high-risk planning | No silent fallback |
| A-11 | Tenant changes after plan creation | Plan and approval invalidated |
| A-12 | Workspace changes after approval | Approval and envelope invalidated |
| A-13 | Authority expires before dispatch | `RESOURCE_AUTHORITY_EXPIRED` |
| A-14 | Same idempotency key and same plan repeats | Existing execution returned |
| A-15 | Same idempotency key with different plan | `IDEMPOTENCY_CONFLICT` |
| A-16 | Transport fails after mutation | `OUTCOME_UNKNOWN`, then reconciliation |
| A-17 | Readback proves mutation succeeded | `executed_readback_recovered` |
| A-18 | Readback proves mutation absent | `not_executed_verified` |
| A-19 | Outcome cannot be established | `outcome_unresolved`; no blind retry |
| A-20 | Default branch moves before branch bootstrap | No partial write; safe retry path |
| A-21 | Default branch moves after work branch exists without overlap | Same-branch continuation succeeds |
| A-22 | Work branch head moves | `BRANCH_HEAD_MOVED` |
| A-23 | Default branch changes an overlapping Spec file | Overlap conflict blocks commit |
| A-24 | Production resolver contains literal customer identifier | CI fails |
| A-25 | Resolver uses first result without uniqueness proof | CI or review gate fails |
| A-26 | Customer error projection contains raw provider error | Contract/security test fails |
| A-27 | Admin visibility includes other tenants | Those resources stay outside execution set |
| A-28 | Context pin revision is stale | Pin rejected and fresh resolution required |
| A-29 | Existing workspace has operational `workspaceType=project` and ownership `company` | Operational type remains `project`; ownership resolves independently as `company` |
| A-30 | Legacy workspace has no ownership classification | `WORKSPACE_OWNERSHIP_TYPE_MISSING`; no consequential connection resolution |
| A-31 | Personal connection owner equals effective user | Personal connection may enter the eligible set when policy permits |
| A-32 | Company member references another member's personal connection | `CROSS_USER_CONNECTION_REJECTED` before credential materialization |
| A-33 | Brand connection matches exact tenant, workspace, brand, resource, and capability | Brand connection is eligible and outranks broader candidates |
| A-34 | Brand connection belongs to another workspace or brand | `BRAND_WORKSPACE_MISMATCH` or `CROSS_BRAND_CONNECTION_REJECTED` |
| A-35 | Explicit authorized connection pin and inherited candidates coexist | Explicit authorized pin wins deterministically |
| A-36 | Two equal-ranked eligible brand or workspace connections remain | `CONNECTION_AMBIGUOUS`; no first-row selection |
| A-37 | More-specific brand connection is revoked during a consequential write | Write is blocked with no workspace or personal fallback |
| A-38 | Company-workspace operation lacks policy allowing personal inheritance | `CONNECTION_INHERITANCE_FORBIDDEN` |
| A-39 | Connection reference crosses tenant boundary | Request fails before credential lookup or decryption |
| A-40 | Connection decision, API projection, plan, log, readiness record, or evidence is inspected | No credential, refresh token, authorization code, raw OAuth state, or claim token appears |
| A-41 | Google identity login succeeds without provider consent | Identity is ready; provider connection is not ready; `PROVIDER_CONSENT_REQUIRED` |
| A-42 | OAuth authorization state is reused after consumption | `OAUTH_STATE_REPLAYED` |
| A-43 | OAuth authorization state is expired or has invalid signature | `OAUTH_STATE_EXPIRED` or `OAUTH_STATE_INVALID` |
| A-44 | OAuth redirect, provider account, tenant, workspace, brand, or owner scope mismatches signed state | Request fails closed with the corresponding structured mismatch error |
| A-45 | Service principal with explicit service authority selects a company-workspace connection | Resolution can succeed without inventing `effectiveUserRef` |
| A-46 | Connection resolution is `interpretation_required` or `connection_required` | No singular `connectionRevision`; candidate revision vector is complete or empty as defined |
| A-47 | Company membership, brand binding, provider scopes, or connection revision changes after decision | Pins, plans, approvals, and cached decisions are invalidated |
| A-48 | Consumer inspects manifest before connection OpenAPI implementation lands | Planned connection surfaces are marked contract-pending and are not advertised as exposed |
| A-49 | Candidate discovery or authority validation runs before one exact connection is approved | No credential is loaded; pre-credential readiness remains non-secret |
| A-50 | One exact connection, owner scope, capability, authority, plan, approval, and pre-credential readiness pass | Credential may be materialized through the guarded boundary solely for provider readiness and dispatch |
| A-51 | Reconnect state targets connection A but OAuth returns another provider account or connection A revision moved | `PROVIDER_ACCOUNT_MISMATCH` or `OAUTH_STATE_CONTEXT_MISMATCH`; existing credential is not replaced |
| A-52 | A resolved connection decision omits selected owner scope type or reference | Decision validation fails; downstream authority/capability execution is blocked |
| A-53 | Shadow or read rollout starts before ownership migration ledger and same-cycle readback are verified | Rollout gate blocks startup |
| A-54 | Rollback is requested after hierarchical routing is enabled | Exact-owner isolation remains active; if unavailable, affected provider operations fail closed instead of using the prior unsafe selector |
| A-55 | Two callbacks concurrently submit distinct authorization codes with the same valid issued state | Atomic compare-and-set grants exactly one claim; the loser receives `OAUTH_STATE_CLAIM_CONFLICT` and performs no code exchange or credential mutation |
| A-56 | A flow requires approval and credential-dependent provider readiness | Plan is compiled and approval obtained/revalidated before guarded credential materialization and provider readiness |
