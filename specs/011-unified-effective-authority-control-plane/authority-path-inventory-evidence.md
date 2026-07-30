# Authority Path Inventory Evidence

## Purpose

This record captures the governed live inventory evidence available for task T001, "Inventory all Admin, Tenant, and internal authority paths."

The evidence is intentionally bounded. It records the currently exposed registries, descriptor sources, runtime counts, dispatch bindings, and callability results. It does not claim that every HTTP route, middleware branch, internal function, local-device path, legacy compatibility path, or unregistered runtime path has been inventoried.

T001 remains open until the closure criteria in this document are satisfied.

## Observation

- Observation date: 2026-07-29
- Principal: platform admin service
- Access scope: `platform_admin_all`
- Runtime authority: SQL-backed registries and governed tool dispatch
- Repository PR: `#2888`
- Evidence mode: read-only diagnostics and documentation-only repository write
- Provider mutations: none
- Runtime enforcement changes: none
- Secrets returned: none

## Platform access counts

The governed platform-access surface returned:

| Registry family | Observed count | Readiness |
|---|---:|---|
| Brands | 9 total, 9 distinct targets | active |
| Runtime actions | 39 total, 36 runtime-callable | active |
| Plugin inventory | 5 rows, 5 active | active |
| Logic definitions | 1,396 total, 1,384 active | active |
| Engine references | 236 distinct references | active |

These counts establish broad platform scope. They do not classify every action, logic, engine, or plugin by Admin/Tenant/internal authority semantics.

## Admin System Tool registry

The governed Admin System Tool list reported:

- total tools: 144
- first bounded page returned: 50
- next cursor reported: 50
- descriptor and direct runtime tools included
- secret inclusion: false

The exposed direct list wrapper used in this session does not accept a cursor argument, so the complete 144-tool list was not retrieved through that surface. This is a coverage limitation, not evidence that the remaining 94 tools are absent or inactive.

### Path patterns observed on the first bounded page

#### Admin-only read and diagnostic paths

Examples include:

- runtime endpoint preview and governed resource planning
- Google Drive endpoint catalog and folder inspection
- governed resource catalog and resolver
- connector registry diagnostics
- activation Drive, bootstrap, and GitHub validation
- credential-client and Google Auth Platform configuration reads
- readiness and smoke diagnostics

#### Admin-only mutation and control paths

Examples include:

- `runtime_endpoint_call`
- authority binding create and revoke
- governed resource apply modes
- repository advisory comment apply and readback
- activation bootstrap configuration upsert
- credential client configuration upsert
- OAuth client configuration upsert

These paths declare combinations of Admin restriction, mutation approval, capability envelope, dry-run, typed confirmation, readback, bounded output, or no-secret behavior. The exact combination is path-specific and must be inventoried per path.

#### Tenant-scoped read-only or preview paths

Examples include:

- repository PR reconciliation sweep
- repository intelligence report
- repository action planner dry-run
- effective capability preview
- capability shadow compare
- growth-audit evidence preparation
- Brand Workspace context resolution
- Platform Resource context catalog, resolve, related, and diagnostic handoff

Several schemas explicitly state that tenant and user overrides are ignored for Tenant principals and that authenticated principal scope is authoritative.

#### Tenant-scoped mutation-capable paths

The descriptor registry includes Tenant mutation planning, apply, and readback paths for Repository Governance V6. Their presence does not mean unrestricted mutation authority: provider binding, resource authority, planning, approval, and readback contracts remain separate gates.

#### Shared paths

Some read-only resolvers are shared by Admin and Tenant. Admin may receive diagnostic overrides; Tenant callers are restricted to authenticated principal scope. Shared availability is therefore not shared authority.

## Admin platform endpoint catalog

A broad governed catalog search reported:

- overall catalog response count: 564
- matches for the broad system-tools inventory query: 460
- first page returned: 100
- catalog continuation was fully read for that page
- secret inclusion: false

The first 100 matching entries included:

- virtual admin tools
- direct HTTP endpoints
- local gateway and device paths
- activation and session archive paths
- schema import and rollback paths
- browser runtime paths
- remote runtime and deployment paths
- migration authorization and execution paths
- Platform Plugin catalog, policy, contribution, certification, promotion, install, grant, template, and dispatch paths
- repository mutation and reconciliation paths
- internal capability-envelope lifecycle paths

This proves that the Admin platform endpoint catalog is materially larger than the Admin System Tool descriptor list. It also shows that the two registries overlap but are not interchangeable.

The remaining catalog pages were not exhaustively classified in this evidence cycle.

## Descriptor-backed system-layer inventory

The governed descriptor readiness check returned:

- descriptor sources: 10
- descriptor tools: 40
- missing handlers: 0
- secrets included: false

### Descriptor sources and tool counts

| Source | Tools | Authority surface |
|---|---:|---|
| Repository Tenant Intelligence V2 | 8 | Admin bindings and Tenant read-only intelligence |
| Repository Tenant Advisory Comment V5 | 4 | Admin preview/apply/readback and readiness |
| Repository Governance V6 | 6 | Tenant reports, mutation plan/apply/readback, Admin binding and smoke |
| Tenant Effective Capability Resolver V1 | 3 | Tenant preview/shadow compare and Admin readiness |
| Tenant Capability Enforcement Kernel V1 | 2 | Tenant enforcement preview and Admin readiness |
| Growth Audit Evidence V1 | 2 | Tenant evidence preparation and Admin readiness |
| Brand Workspace Context V1 | 2 | Shared context resolution and Admin readiness |
| Platform Resource Context V1 | 5 | Shared resource discovery and resolution plus Admin readiness |
| GitHub Main-Moved Webhook Provisioning V1 | 3 | Admin status/provision/readiness |
| Capability Enablement Broker V1 | 5 | Tenant resolution/proposal/projection and Admin decision/readiness |

All 40 descriptor tools had registered runtime handlers.

## Descriptor callability audit

The governed no-secret callability audit returned:

- descriptor sources: 10
- descriptor tools: 40
- missing handlers: 0
- sources passing readiness: 7
- authorization-gated sources: 2
- failed sources: 1
- apply allowed: false
- mutations executed: false
- secrets included: false

### Passing sources

- Repository Governance V6
- Tenant Effective Capability Resolver V1
- Tenant Capability Enforcement Kernel V1
- Growth Audit Evidence V1
- Brand Workspace Context V1
- Platform Resource Context V1
- Capability Enablement Broker V1

The passing checks included combinations of schema presence, descriptor presence, provider-binding validation, principal-scope behavior, shadow-only behavior, no-provider-call, no-mutation, no-external-send, and no-secret guarantees.

### Authorization-gated sources

- Repository Tenant Intelligence V2
- Repository Tenant Advisory Comment V5

Both sources retained provider-binding and no-mutation/no-secret guarantees, but their readiness could not be classified as active without the required repository authority binding.

### Failed source

`github_repository_main_moved_webhook_provisioning_v1` failed readiness because:

- no primary ready capability binding was present;
- governed callback inheritance was not proven;
- governed push-event inheritance was not proven;
- webhook secret reference resolution was not proven.

GitHub App ID, installation, and private-key configuration checks passed. No provider call or mutation occurred, and no credential reference was exposed.

This source must remain blocked until same-cycle binding and secret-reference validation succeeds.

## GitHub dispatch-binding integrity

The governed Platform Tool Binding Integrity Audit for `github_api_mcp` returned:

- bindings: 37
- healthy bindings: 37
- gaps: 0
- status: pass

The audited bindings covered:

- Admin Control PR merge, update, and update-branch operations
- GitHub branch cleanup and deletion tools
- PR CI gate and PR finalization
- GitHub REST endpoint dispatch for refs, labels, workflow runs, comments, and PR updates
- superseded-branch cleanup
- single-file repository patch apply
- atomic repository patch batch apply

Every audited binding was callable and linked to its endpoint identity. Mutation bindings included path-specific capability, readback, partial-success, and atomicity metadata where applicable.

This audit covers the registered GitHub dispatch-binding family only. It is not evidence that all non-GitHub providers or internal authority paths are gap-free.

## Authority path classes observed

The live evidence supports these path classes:

1. **Admin-only diagnostic paths** — broad platform scope, no provider mutation by default.
2. **Admin-only governed mutation paths** — explicit mutation gates, path-specific approvals, envelopes, readback, rollback, or typed confirmation.
3. **Tenant read-only resolution paths** — authenticated Tenant principal scope is authoritative; caller-supplied Tenant overrides are advisory or ignored.
4. **Tenant shadow and preview paths** — no provider apply and no runtime enforcement change.
5. **Tenant mutation-capable paths** — separate planning, resource binding, approval, execution, and readback contracts.
6. **Shared Admin/Tenant context paths** — same tool surface with different principal-derived scope semantics.
7. **Internal registry mutation paths** — capability-envelope lifecycle, policy bootstrap, certification, schema import, session archive, and governed migration ledgers.
8. **Provider-bound paths** — runtime dispatch through registered action and endpoint authority.
9. **Local-device paths** — local gateway, browser runtime, and connector adapters with separate device and policy gates.
10. **Compatibility and deprecated paths** — aliases or transitional routes that must not become authority sources.

## Common authority controls observed

The registries repeatedly expose these controls, but not every path has been individually verified for every control:

- `requires_admin`
- authenticated-principal Tenant scope
- resource authority binding
- provider binding
- credential scope selection
- dry-run or preview mode
- typed confirmation
- capability resolution envelope
- approval hold
- idempotency or plan identity
- same-cycle readback
- rollback or partial-success policy
- atomicity classification
- bounded output
- no-secret response
- no-provider-call and no-external-write guarantees for diagnostic paths

A complete inventory must classify each path against each applicable control rather than relying on tags or description text alone.

## Gaps preventing T001 closure

T001 cannot be closed from the current evidence because:

1. The complete 144-tool Admin System Tool registry was not paginated through the exposed direct wrapper.
2. The complete Admin platform endpoint catalog was not exhaustively enumerated and classified; the observed catalog response reported 564 total entries and 460 broad-query matches.
3. Direct HTTP routes not represented in either catalog were not inventoried.
4. Middleware authorization branches and internal helper functions were not mapped.
5. Local gateway, device connector, browser runtime, remote runtime, and provider-specific paths were not exhaustively reconciled.
6. Legacy aliases, deprecated compatibility paths, and duplicate route/tool identities were not fully mapped to canonical replacements.
7. Every path has not yet been classified by actor, subject, Tenant, Workspace, resource, capability, operation, endpoint, provider, credential scope, risk, approval, readback, rollback, revocation, and version source.
8. The two authorization-gated descriptor sources require binding evidence before callability can be classified.
9. The GitHub main-moved webhook provisioning source remains blocked.
10. Non-GitHub dispatch bindings have not received the same zero-gap integrity audit recorded here for `github_api_mcp`.
11. There is no single machine-readable inventory artifact linking all catalog entries, handlers, endpoints, bindings, policies, and deprecated paths.

## Closure criteria

T001 may be marked complete only when a governed inventory provides one row per authority path with at least:

- canonical path or tool key;
- route and HTTP method where applicable;
- surface family and source registry;
- handler identity and callability;
- Admin, Tenant, shared, or internal classification;
- authenticated actor and effective-subject source;
- Tenant and Workspace scope source;
- resource and capability authority source;
- provider and credential scope;
- read-only, preview, shadow, planning, or mutation mode;
- risk class;
- approval, typed confirmation, envelope, and idempotency requirements;
- readback, rollback, partial-success, and atomicity policies;
- secret and credential-payload exposure classification;
- revision, freshness, revocation, and invalidation behavior;
- canonical replacement for legacy or deprecated paths;
- status, readiness, and unresolved gaps;
- observation timestamp and source identity.

The inventory must reconcile System Tools, Admin platform endpoint tools, direct HTTP routes, registered runtime actions and endpoints, local/device connectors, and internal descriptor sources. Any unresolved path must remain explicitly blocked or classified as non-authoritative.

## Safety statement

This inventory cycle performed no provider mutation, no external write, no credential payload read, no migration execution, no scheduler activation, no evidence-persistence activation, no runtime enforcement, no deployment, no merge, no production verification, and no audit execution. T001 remains open and its completion evidence remains partial.
