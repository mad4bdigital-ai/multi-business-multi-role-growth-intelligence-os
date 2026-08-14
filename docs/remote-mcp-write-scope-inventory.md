<!-- GENERATED FILE. Run npm run write-scopes:inventory. -->
# Remote MCP Write-Scope Smart Inventory

This artifact is generated from the Git index, the Remote MCP scope catalog, application route declarations, migration SQL, and database registry references. It is a **read-only governance inventory**; it does not apply migrations or execute provider mutations.

| Metric | Value |
|---|---:|
| Tracked files scanned | 6847 |
| Routes discovered | 1074 |
| Write routes discovered | 652 |
| Classified write-surface candidates | 38 |
| Classified write routes | 652 |
| Intentionally unmapped write routes (blocked) | 614 |
| Migrations with governance evidence | 445 |
| DB catalog fingerprint match | true |
| Registry evidence entries | 106 |
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
- **high** `INTENTIONALLY_UNMAPPED_WRITE_ROUTES_BLOCKED` — count: 614 — sensitive: 614
- **medium** `WRITE_SCOPE_NO_ROUTE_CANDIDATE` — `assets.update`

## Classification contract

Every write route is represented exactly once in 'write_route_classifications':

| Classification | Meaning | Execution status |
|---|---|---|
| 'shadow_candidate' | Heuristic/catalog-owned surface candidate requiring explicit resource-operation-scope binding | Blocked until binding, authority, approval, capability, lease, and readback exist |
| 'intentionally_unmapped' | Route is inventoried but not proven to belong to the Remote MCP write surface | Blocked; owner and machine-readable reason are required |

'unclassified_write_route_count' must remain zero. A zero unclassified count does **not** mean write readiness; the inventory is ready only when blocked intentional mappings, scope bindings, DB evidence, and all governance gates are resolved.

## Evidence graph

The generated artifact includes a static-only evidence graph connecting each route declaration to its handler file, domain, catalog scope candidate, and detected provider, database, authority, readback, and mutation signals. These edges are evidence for review and never authorize execution.

## Safety boundary

The inventory explicitly keeps provider mutation, migration application, and Production activation disabled.
 A write scope is not eligible merely because it exists in the catalog; it requires an explicit resource-operation binding, tool binding, approval policy, capability envelope, lease, staging environment, and same-cycle readback.
