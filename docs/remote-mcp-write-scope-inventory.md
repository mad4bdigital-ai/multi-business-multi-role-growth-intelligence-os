<!-- GENERATED FILE. Run npm run write-scopes:inventory. -->
# Remote MCP Write-Scope Smart Inventory

This artifact is generated from the Git index, the Remote MCP scope catalog, application route declarations, migration SQL, and database registry references. It is a **read-only governance inventory**; it does not apply migrations or execute provider mutations.

| Metric | Value |
|---|---:|
| Tracked files scanned | 6739 |
| Routes discovered | 1070 |
| Write routes discovered | 649 |
| Classified write-surface candidates | 38 |
| Migrations with governance evidence | 441 |
| DB catalog fingerprint match | true |
| Registry evidence entries | 100 |
| Write scopes | 6 |
| Bound write scopes | 0 |
| Inventory ready | false |
| Write activation allowed | false |

## Findings

- **high** `WRITE_SCOPE_UNBOUND` — `approvals.request`
- **high** `WRITE_SCOPE_UNBOUND` — `assets.create`
- **high** `WRITE_SCOPE_UNBOUND` — `assets.update`
- **high** `WRITE_SCOPE_UNBOUND` — `github.write`
- **high** `WRITE_SCOPE_UNBOUND` — `cloudflare.write`
- **high** `WRITE_SCOPE_UNBOUND` — `hostinger.deploy`
- **medium** `WRITE_SCOPE_NO_ROUTE_CANDIDATE` — `assets.update`

## Safety boundary

The inventory explicitly keeps provider mutation, migration application, and Production activation disabled. A write scope is not eligible merely because it exists in the catalog; it requires an explicit resource-operation binding, tool binding, approval policy, capability envelope, lease, staging environment, and same-cycle readback.
