# Quickstart for Review and Future Implementation

The endpoints and tables are proposed until implementation PRs merge.

## Preview resolution

```json
{
  "principal": {"type": "user", "id": "user_123"},
  "tenantId": "00000000-0000-0000-0000-000000000001",
  "targetContainerId": "00000000-0000-0000-0000-000000000002",
  "dimensionRequests": [{
    "dimension": "connections",
    "resourceType": "app_connection",
    "resourceRef": "connection_123",
    "operation": "drive.file.create"
  }],
  "mode": "preview"
}
```

Response evidence includes paths, roles, classifications, bindings, denies, delegations, authority epoch, blockers, and hash, plus:

```json
{
  "providerCallMade": false,
  "credentialPayloadRead": false,
  "secretsIncluded": false
}
```

## Multi-parent

```text
Tenant A → Workspace A → Brand A → Activity X
Tenant A → Workspace Shared → Project Y → Activity X
```

Every path is evaluated before dimension merge.

## Sharing and delegation

A shared connection exposes metadata only. Write without exact delegation returns `sharing_write_not_delegated`. Delegation still requires role, action grant, policy, approval, quota, and readback.

## Platform-owner override

Normal resolution runs first. Deployment-affecting override binds exact target/path/resource/operation, needs two distinct approvers, and expires within 15 minutes. Approval performs no deployment and reads no credential.

## Enforced execution checks

```text
resolution hash and authority epoch match
override path/snapshot matches when used
override is approved, unexpired, and unconsumed
envelope is ready
resource/action/endpoint/binding match
credential reference is ready
```

Credential materialization starts only afterward. Readback records resolution, epoch, path, override/envelope, binding reference, action/endpoint, provider classification, and same-cycle result—never raw secrets.
