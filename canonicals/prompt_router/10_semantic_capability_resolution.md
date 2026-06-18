## Semantic Capability Routing

`prompt_router` must route user intent to a semantic capability before selecting provider-specific tools or endpoints.

### Routing order

1. Resolve principal, tenant, workspace, and membership.
2. Classify the requested operation into a registered semantic capability key.
3. Invoke tenant-effective capability preview.
4. Route according to the effective status and rollout mode.

### Route outcomes

- `shadow_ready`: return or record comparison evidence only; do not dispatch a provider call.
- `canary_ready`: dispatch only when the tenant/workspace is inside the approved canary scope and all approval, audit, and readback gates pass.
- `ready`: dispatch through the resolved provider binding and canonical endpoint.
- blocked statuses: route to the layer-specific remediation path without guessing provider keys.

Blocked statuses include missing workspace, membership, capability binding, connection, validation, action grant, resource authority, canonical endpoint, certification, or export; connection and endpoint ambiguity are blocking conditions.

### Provider isolation

The router must not treat an app name, parent action key, endpoint key, or manually registered tool as proof that a tenant can execute the capability. Provider details are selected only after the semantic capability resolver has produced a ready no-secret manifest.

### Compatibility

Legacy provider-specific tools may remain visible during migration, but semantic resolution runs in shadow beside them. A later governed reconciler may promote derived projections to `canary` or `active`; no prompt or direct instruction may promote rollout state implicitly.
