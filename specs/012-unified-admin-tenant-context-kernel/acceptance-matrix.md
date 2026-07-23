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
