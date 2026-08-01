# Error Catalog

All errors are structured, secret-safe, and include `operation_id` when one exists. Tenant errors avoid revealing whether an unauthorized target or plan exists.

| Code | HTTP/status | Stage | Retryable | Meaning | Required action/readback |
|---|---:|---|---|---|---|
| STORAGE_CONTEXT_REQUIRED | 400 | context | no | Explicit Admin/Tenant context missing | Select context; Context Kernel readback |
| STORAGE_CONTEXT_MISMATCH | 403 | context | no | Principal/context tenant or workspace mismatch | Correct context/membership |
| STORAGE_PLATFORM_ADMIN_REQUIRED | 403 | authority | no | Admin operation lacks Platform Admin authority | Obtain appropriate authority |
| STORAGE_TENANT_ROLE_REQUIRED | 403 | authority | no | Tenant role does not allow operation | Workspace role readback |
| STORAGE_TARGET_NOT_FOUND_OR_VISIBLE | 404 | target | no | Target absent or not visible in selected context | Select visible target; no existence leakage |
| STORAGE_TARGET_NOT_OWNED | 403 | target | no | Tenant target is not exclusively owned/matching | Select owned resource or request support |
| STORAGE_SHARED_TARGET_TENANT_FORBIDDEN | 403 | target | no | Tenant attempted shared/account operation | Submit governed support request |
| STORAGE_TARGET_BINDING_STALE | 409 | target | no | Ownership/root binding changed | Re-resolve target and create new plan |
| STORAGE_LAYOUT_NOT_CERTIFIED | 409 | target | no | Active deployment/provider layout unknown | Complete inventory certification |
| STORAGE_QUOTA_EVIDENCE_REQUIRED | 409 | snapshot | yes after collection | Provider quota evidence absent | Collect hPanel/provider evidence |
| STORAGE_QUOTA_EVIDENCE_STALE | 409 | snapshot | yes after refresh | Provider evidence exceeds freshness policy | Refresh evidence |
| STORAGE_SCAN_TIMEOUT | 504/partial | scan | yes | Bounded scan timed out | Retry with same operation or smaller scope |
| STORAGE_SCAN_PARTIAL | 206 | scan | yes | Inventory incomplete | Inspect completeness; do not infer zero |
| STORAGE_HOST_KEY_MISMATCH | 503 | dispatch | no | SSH host key differs from pinned evidence | Security review and governed repin |
| STORAGE_WORKER_UNAVAILABLE | 503 | dispatch | yes | Certified worker/connector unavailable | Retry after worker recovery |
| STORAGE_DISPATCH_DISABLED | 503 | dispatch | no | Runtime/provider dispatch phase not enabled | Complete certification/flag approval |
| STORAGE_FREEFORM_COMMAND_FORBIDDEN | 400 | dispatch | no | Arbitrary shell/root/wildcard supplied | Use fixed operation contract |
| STORAGE_POLICY_CLASS_FORBIDDEN | 403 | plan | no | Candidate class not allowed for context/policy | Remove class or obtain later policy support |
| STORAGE_PLAN_EMPTY | 422 | plan | no | No eligible candidates | No cleanup required or investigate review-only classes |
| STORAGE_PLAN_LIMIT_REACHED | 206 | plan | no | Candidate/byte bound truncated plan | Inspect bounded plan; create later plan if needed |
| STORAGE_PLAN_NOT_FOUND_OR_VISIBLE | 404 | plan | no | Plan absent or audience mismatch | Use visible plan; no existence leakage |
| STORAGE_PLAN_TAMPERED | 409 | plan | no | Stored content hash mismatch | Block target and investigate |
| STORAGE_PLAN_STALE | 409 | plan | no | Target/context/revision/candidate binding stale | Create new plan |
| STORAGE_PLAN_EXPIRED | 409 | plan | no | Plan TTL elapsed | Create new plan |
| STORAGE_PLAN_ALREADY_CONSUMED | 409 | apply | no | Plan already used | Read existing run/result |
| STORAGE_AUTHORITY_CONTEXT_HASH_MISMATCH | 409 | authority | no | Selected authority context differs from plan/request | Re-authorize and re-plan |
| STORAGE_CAPABILITY_ENVELOPE_REQUIRED | 403 | authority | no | Mutation lacks valid envelope | Obtain exact short-lived envelope |
| STORAGE_RESOURCE_AUTHORITY_REQUIRED | 403 | authority | no | Tenant mutation lacks resource apply authority | Obtain resource authority |
| STORAGE_DELEGATION_REQUIRED | 403 | authority | no | Admin tenant mutation lacks delegation/break-glass | Create support/delegation evidence |
| STORAGE_SUPPORT_CASE_REQUIRED | 403 | authority | no | Delegated/break-glass mutation lacks support case | Open/link case |
| STORAGE_ACTIVE_INCIDENT_REQUIRED | 403 | authority | no | Reserve/break-glass action lacks active incident | Open/link incident |
| STORAGE_RELEASE_AUTHORITY_REQUIRED | 403 | authority | no | Deployment-history cleanup lacks release authority | Obtain exact release approval |
| STORAGE_APPROVAL_HOLD_REQUIRED | 409 | approval | no | Apply requested before approval workflow | Request approval |
| STORAGE_APPROVALS_MISSING | 409 | approval | no | Required slots/workspaces incomplete | Complete approvals |
| STORAGE_APPROVAL_INVALIDATED | 409 | approval | no | Revision/context/impact/expiry changed | Re-inspect and reapprove |
| STORAGE_IMPACT_SET_UNRESOLVED | 409 | approval | no | Shared candidate owner unresolved | Resolve every impact or block candidate |
| STORAGE_TYPED_CONFIRMATION_REQUIRED | 400 | apply | no | Exact confirmation absent/mismatch | Provide current token after review |
| STORAGE_LEASE_REQUIRED | 409 | execution | yes after acquire | Mutation lacks execution lease | Acquire exact lease |
| STORAGE_LEASE_CONFLICT | 409 | execution | yes after release/reconcile | Cleanup/deployment already active | Wait or reconcile existing operation |
| STORAGE_LEASE_EXPIRED | 409 | execution | no | Lease expired before/while dispatch | Reauthorize and acquire new lease |
| STORAGE_ITEM_PROTECTED | item-skip | apply | no | Candidate entered protected surface | Skip and investigate planner classification |
| STORAGE_ITEM_PATH_ESCAPE | item-skip/block | apply | no | Canonical path left approved root | Block run/security review |
| STORAGE_ITEM_SYMLINK | item-skip | apply | no | Item is symlink/non-regular | Skip item |
| STORAGE_ITEM_CHANGED | item-skip | apply | no | Device/inode/size/ctime/mtime changed | Skip; create new plan if still desired |
| STORAGE_ITEM_MISSING | item-skip | apply | no | Candidate no longer exists | Account as skipped/missing |
| STORAGE_APPLY_PARTIAL | readback | no automatic retry | Some approved items skipped/failed | Inspect item outcomes; create new plan if needed |
| STORAGE_UNKNOWN_OUTCOME | 202/409 | execution | no automatic retry | Transport failed after possible mutation | Reconcile same operation |
| STORAGE_RECONCILIATION_REQUIRED | 409 | execution | yes, reconciliation only | Operation cannot progress without readback | Run OP-009 |
| STORAGE_RECONCILIATION_CONFLICT | 409 | reconciliation | no | Journal/filesystem/provider evidence conflict | Block and human review |
| STORAGE_READBACK_INCOMPLETE | 202/409 | readback | yes | Required provider/filesystem/runtime evidence missing | Continue readback, do not complete |
| STORAGE_RESERVE_ALREADY_EXISTS | 409 | reserve | no | Reserve provisioned | Read status |
| STORAGE_RESERVE_NOT_FOUND | 404 | reserve | no | Reserve absent | Provision when healthy if policy requires |
| STORAGE_RESERVE_FINGERPRINT_MISMATCH | 409 | reserve | no | Reserve changed | Investigate; do not release |
| STORAGE_RESERVE_RELEASE_BLOCKED | 409 | reserve | no | Incident/authority/preconditions missing | Complete incident evidence |
| STORAGE_PROMOTION_BLOCKED | 409 | release | no | Pressure/headroom violates release policy | Resolve storage pressure, refresh preflight |
| STORAGE_PREDICTED_FOOTPRINT_UNKNOWN | 409 | release | yes after calculation | Install/build estimate absent | Compute or require conservative block |
| STORAGE_OUTPUT_REDACTION_FAILED | 500/block | evidence | no | Output may contain secret-like data | Quarantine result, stop/revoke/investigate |
| STORAGE_EVIDENCE_SCHEMA_INVALID | 500/block | evidence | no | Provider/worker evidence violates schema | Block completion and fix adapter |
| STORAGE_POLICY_REVISION_UNSUPPORTED | 409 | compatibility | no | Runtime cannot execute plan policy version | Upgrade runtime or re-plan |

## Retry rules

- Read-only scan/readback may retry with the same operation ID and bounded backoff.
- Plan creation may return an existing deterministic active plan.
- Approval decisions are idempotent for the same approver/plan/decision.
- Mutation does not retry after dispatch uncertainty.
- `unknown_outcome` permits reconciliation only until outcome is classified.
- A new mutation attempt normally requires a new plan and approval.

## Sanitization

Error details may include IDs, reason codes, stages, revision labels, counts, and safe evidence references. They must not include credentials, command lines with secrets, raw environment values, file contents, private paths in Tenant context, or raw provider payloads.
