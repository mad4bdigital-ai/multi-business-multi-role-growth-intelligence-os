# Quickstart for Review and Future Implementation

The endpoints and tables below are proposed until implementation PRs merge.

## Resolve without execution

```json
{
  "principal": {"type": "user", "id": "user_123"},
  "tenantId": "tenant_123",
  "targetContainerId": "activity_123",
  "dimensionRequests": [
    {
      "dimension": "connections",
      "resourceType": "app_connection",
      "resourceRef": "connection_123",
      "operation": "drive.file.create"
    }
  ],
  "mode": "preview"
}
```

The response must include decision, every contributing container path, effective classifications/roles/bindings, denies, delegations, blockers, and a hash, while reporting:

```json
{
  "providerCallMade": false,
  "credentialPayloadRead": false,
  "secretsIncluded": false
}
```

## Multi-parent evidence

```text
Tenant A → Workspace A → Brand A → Activity X
Tenant A → Workspace Shared → Project Y → Activity X
```

Every path is evaluated before dimension-specific merging.

## Read-only share

A shared connection exposes metadata only. A write without explicit delegation returns `sharing_write_not_delegated`.

## Explicit delegation

```json
{
  "fromContainerId": "workspace_shared",
  "toContainerId": "workflow_123",
  "dimension": "connections",
  "resourceType": "app_connection",
  "resourceRef": "connection_123",
  "operations": ["drive.file.create"],
  "validUntil": "2026-06-18T03:00:00Z"
}
```

Delegation does not bypass role, action grant, capability policy, approval, quota, or readback.

## Platform-owner override

Normal resolution runs first. A deployment-affecting request references the blocked resolution, exact target/path/resource/operation, and reason. It requires two distinct approvers and a maximum 15-minute TTL. Approval performs no deployment and reads no credential.

## Live execution checks

```text
resolution hash matches
override path/snapshot matches when used
override is sufficiently approved and unexpired
capability envelope is ready
resource binding matches
action/endpoint match
credential reference is ready
```

Credential materialization starts only afterward.

## Readback

Every execution records resolution ID/hash, path hash, override/envelope references, credential binding reference, action/endpoint, provider result classification, and same-cycle readback—never raw secrets.
