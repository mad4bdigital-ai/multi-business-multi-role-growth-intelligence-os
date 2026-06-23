# Research and Decisions

## Canonical readiness authority

`tenantEffectiveCapabilityResolver.js` already evaluates workspace membership, semantic capability binding, validated connection, action grant, resource authority, canonical endpoint, runtime certification, and active export.

**Decision:** reuse this resolver from the dashboard service. Do not duplicate readiness policy.

## Connector evidence

`connected_systems.status` is registry lifecycle metadata. It does not prove an operational installation.

**Decision:** an active connector requires an active connected-system row plus at least one active, non-expired installation. An active row without installation evidence is pending.

## Missing-value semantics

`Number(null)` produces zero, which can silently convert unavailable data into a healthy empty state.

**Decision:** customer-visible unavailable counts remain `null` with `available: false`; known zero remains `0` with `available: true`.

## Awareness scoring

Visibility of a manifest is not equivalent to execution authority.

**Decision:** completeness includes blocked operational categories, and authorization visibility decreases when blocked surfaces exist.

## Performance

Dashboard actions can repeat the same capability key.

**Decision:** resolve unique capability keys once per dashboard build and reuse results.

## Branch overlap

PRs 1879 and 1881 were reviewed before implementation. Their execution-preflight, tool-route, OpenAPI, route-registration, server, generated-contract, and shared test-manifest files are excluded from this branch.
