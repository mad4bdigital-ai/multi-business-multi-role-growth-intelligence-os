# Implementation Plan — Spec 018

## Objective
Deliver environment promotion and runtime integrity as a sequence of bounded, reviewable changes while preserving current production behavior until each replacement control has same-cycle evidence.

## Branch and Promotion Policy
- Work begins from an exact SHA of `main`.
- Specification and implementation PRs target `main`.
- `main` is the staging/integration authority.
- Production promotion occurs only after CI and staging verification.
- `Production` is the production source authority.
- Hostinger production deployment resolves from exact `Production` SHA.
- No direct Hostinger code mutation is part of this spec PR.

## Phase 0 — Contract and Baseline Evidence
1. Inventory branch/deployment contracts that currently hard-code `main` for production Hostinger release.
2. Inventory local Hostinger mutation paths and identify which are routine versus true break-glass.
3. Inventory activation canonical-file assumptions and classify current resources.
4. Capture baseline `/health`, `/version`, `/deployment-info`, branch, checkout cleanliness, and activation evidence.
5. Record compatibility risks and rollback surfaces.

Exit: complete bounded inventory with no production mutation.

## Phase 1 — Environment Authority
1. Add registry/config representation for staging and production branch roles.
2. Update production deployment resolution to use configured production authority (`Production`).
3. Require exact production SHA and same-cycle branch membership validation.
4. Remove caller ability to select arbitrary production branches.
5. Preserve structured error contracts and readback.

Exit: production deploy dry-run resolves only approved `Production` commits.

## Phase 2 — Runtime Integrity and Break Glass
1. Model runtime integrity separately from health.
2. Deny routine local application-code writes on Hostinger.
3. Introduce bounded break-glass authorization records and lifecycle state machine.
4. Require path, principal, incident, expiry, pre-change evidence, rollback plan, and audit binding.
5. Require reconciliation through `main` -> staging -> `Production` -> clean redeploy before closure.
6. Expose unreconciled changes as degraded runtime integrity.

Exit: local mutation is impossible outside governed break glass and closure cannot bypass reconciliation.

## Phase 3 — Canonical Resource Registry
1. Add SQL-authoritative canonical resource registry using an additive migration.
2. Seed existing activation-critical canonical files with current behavior preserved.
3. Add resource classes: `runtime_critical`, `routing_index`, `on_demand_searchable`.
4. Add loading and validation strategies.
5. Change activation to resolve critical resources through the registry.
6. Add on-demand retrieval for searchable resources without loading all content at activation.

Exit: activation no longer depends on hard-coded file enumeration and optional resources can change without activation-code edits.

## Phase 4 — Generated Deployment Attestation
1. Generate attestation from exact `Production` commit and active canonical registry revision.
2. Include hashes only for resources whose validation strategy requires deployment integrity evidence.
3. Run attestation in shadow mode first.
4. Compare build attestation with Hostinger runtime readback.
5. Promote mismatch reason codes into activation/runtime-integrity status.

Exit: exact source/build/runtime provenance can be proven without a manually maintained manifest.

## Phase 5 — Enforcement and Legacy Retirement
1. Require successful parity evidence across staging and production dry-run/readback paths.
2. Enforce `Production` branch authority for production deployments.
3. Enforce Hostinger immutability by default.
4. Remove legacy fixed-file activation assumptions after parity.
5. Update canonicals, OpenAPI, runbooks, dashboards, and AI agent knowledge guide as affected.
6. Run canonical regeneration where required.

Exit: legacy paths are removed only after replacement controls are active and verified.

## Implementation PR Boundaries

### PR A — Environment Authority
Scope: branch role registry/config, production deployment contract, exact-SHA validation, readback.

### PR B — Runtime Immutability / Break Glass
Scope: Hostinger local-write policy, break-glass lifecycle, reconciliation invariants, runtime-integrity state.

### PR C — Canonical Resource Registry
Scope: additive schema, seed data, resolver, activation-critical and on-demand strategies.

### PR D — Deployment Attestation / Activation Readback
Scope: generated attestation, hash/readback verification, precise degraded reason codes.

### PR E — Enforcement Cleanup
Scope: remove legacy assumptions only after parity evidence and release readiness.

## Testing Strategy
Each behavior-changing PR must cover:
- happy path;
- invalid input;
- unauthorized mutation attempts;
- stale SHA / branch mismatch;
- dirty runtime detection;
- break-glass expiry and incomplete reconciliation;
- rollback/readback failure;
- optional-resource degradation versus critical-resource failure;
- backward-compatible API response behavior.

Integration tests should cross boundaries only where needed: GitHub branch authority, deployment readback, SQL registry resolution, and activation classification.

## Safety and Rollback
- Prefer additive database changes first.
- Do not remove existing activation behavior until registry parity is proven.
- Run attestation shadow-only before making it an activation gate.
- Preserve rollback to the previous production deployment artifact/commit.
- Break-glass never grants implicit merge/deploy authority.
- No secrets in attestation, logs, or API responses.

## Documentation / Contract Impact
Expected follow-up updates may include:
- `AI_Agent_Knowledge_Guide.md`;
- `system_bootstrap.md`;
- deployment runbooks and branch policy;
- activation contracts;
- generated OpenAPI schemas where endpoint behavior changes;
- canonical generated artifacts after editing canonical sources.

## Definition of Done
The spec is implemented when:
- environment authority is explicit and enforced;
- production deploys resolve only approved `Production` SHA;
- Hostinger is immutable by default;
- break-glass changes must reconcile through normal Git promotion before closure;
- runtime integrity is separately observable;
- canonical resources are dynamic and activation-aware;
- deployment attestation is generated and verified;
- tests, CI, documentation, security review, and release readiness are complete.
