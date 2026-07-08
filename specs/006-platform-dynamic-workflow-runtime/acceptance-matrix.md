# Acceptance Matrix

| ID | Scenario | Expected result |
|---|---|---|
| AC-001 | Platform admin publishes an agent as tenant-available | Authorized tenants discover version and publication policy |
| AC-002 | Tenant installs canonical workflow | Installation references platform version without copying canonical payload |
| AC-003 | Tenant applies allowed timeout override | Snapshot contains bounded override and lineage |
| AC-004 | Tenant attempts to disable mandatory approval | Denied with stable policy error |
| AC-005 | Tenant adds pre/post extension | Compiled plan accepts declared extension points only |
| AC-006 | Tenant creates governed fork | Tenant-owned asset preserves immutable origin lineage |
| AC-007 | Platform releases compatible version | Auto/approval/pinned policy behaves deterministically |
| AC-008 | Platform updates a source used by a fork | Fork remains unchanged; compatibility report generated |
| AC-009 | User requests uncertified adapter | Adapter filtered; authority not widened |
| AC-010 | Two workers claim the same run | One succeeds; one receives conflict |
| AC-011 | Client retries run creation | Same idempotent run/result returned |
| AC-012 | Callback is replayed | No duplicate state transition |
| AC-013 | Callback signature or nonce is invalid | Denied and audited |
| AC-014 | Provider reports success without readback | Run remains verifying/blocked |
| AC-015 | Tenant references another tenant's asset | Object-level authorization denies access |
| AC-016 | Platform-owned run has no tenant ID | Valid platform authority path succeeds without fake tenant |
| AC-017 | Tenant-owned run has no tenant/workspace | Execution blocked |
| AC-018 | Active workflow version edit attempted | New draft version required |
| AC-019 | Step fails with retryable category | Bounded retry uses original snapshot |
| AC-020 | Compensation executes | Original evidence retained and compensation audited |
