# Implementation PR-3: Activation Contract Finalization

## Status

Repository-only contract finalization for Spec 012 tasks T010-T013. This PR does not change canonical OpenAPI, generated schemas, runtime routes, database state, registry authority, provider behavior, credentials, deployment, or production state.

## Contract layers

### `runtime_current`

This layer records only routes and operation IDs proven by the PR-1 inventory and the currently served Tenant Activation OpenAPI artifact. It is descriptive evidence of the runtime that exists now.

A route in this layer is not made callable by this PR. Runtime callability remains controlled by canonical OpenAPI generation, route bindings, gateway policy, registries, authorization, and deployed code.

### `target_lifecycle`

This layer freezes the intended lifecycle contract represented by:

- `contracts/tenant-activation-lifecycle.openapi.yaml`;
- `contracts/activation-operation.schema.json`;
- `implementation/pr-2a-lifecycle-contracts.json`;
- `operation-paths.md` OP-001 through OP-018.

Target lifecycle paths remain specification-only until T080 canonical adoption, generated parity, consumer review, governed rollout, and runtime implementation are complete.

## No invented public paths

PR-3 may not silently create a new runtime route. Every public path must be classified as one of:

- `runtime_current`: observed in PR-1 inventory/current served OpenAPI;
- `target_lifecycle`: declared in the specification-only lifecycle OpenAPI;
- `non_route_contract`: gateway, deployment, recovery, or rollback behavior governed by operation-path requirements rather than a Tenant public endpoint.

Any proposed future path must stay visibly specification-only and must not appear in current runtime operation inventory.

## T010 — OAuth and gateway

The final contract records the existing OAuth handoffs exactly:

- `GET /auth/oauth/authorize` — `tenantGptOAuthAuthorize`;
- `POST /auth/oauth/code` — `tenantGptOAuthCode`;
- `POST /auth/oauth/token` — `tenantGptOAuthToken`.

The first protected request is a gateway contract over declared `/tenant/activation/*` and `/tenant/resolution/*` operations, not a new standalone route. Tenant, user, workspace, resource, purpose, audience, membership, and scope are server-derived and may not be overridden by request input.

## T011 — Session, bootstrap, and tools

The current runtime contract preserves the existing Tenant Activation session, awareness, operational-attention, dynamic-tab, and session-turn operation IDs from PR-1.

The target lifecycle contract defines `readTenantActivationSessionContext` and `startTenantActivationOperation` as specification-only lifecycle operations. Bootstrap, provider validation, tool readiness, and dispatch preparation are represented as bounded stage/evidence contracts; this PR does not expose provider credentials or make provider tools callable.

## T012 — Status, retry, delivery, acknowledgement, and reconciliation

The target lifecycle contract freezes:

- operation start/status operations;
- governed retry with `reconcile_unknown_outcome` strategy;
- acknowledgement as a separate idempotent record;
- delivery and reconciliation as independent ledgers that do not rewrite execution outcome;
- same-operation evidence and reconcile-before-replay requirements.

No separate delivery or reconciliation public endpoint is invented by PR-3. Their state is exposed through bounded operation status and governed retry/reconciliation behavior unless a later approved contract introduces a route.

## T013 — Deployment and operational evidence

Tenant/public deployment evidence is bounded and opaque. It may expose `current`, `deploying`, `stale`, `diverged`, or `unknown`, an opaque runtime version, timestamps, completeness, and next action. It must not expose Git SHA, repository, host path, credentials, or infrastructure details.

Current tenant runtime diagnostics remain represented by the existing awareness and operational-attention operations. Full main/deployed SHA and release evidence remain Admin/service-only. Operator recovery and rollback are `non_route_contract` paths under OP-016 through OP-018, not new Tenant public endpoints.

## Compatibility and errors

The stable state, error, reconnect, and compatibility authority remains `implementation/pr-2a-lifecycle-contracts.json`.

- Reconnect guidance is restricted to verified gateway authentication failures.
- Deployment mismatch never produces reconnect guidance.
- Additive response fields remain optional during migration.
- Existing required fields and current operation IDs may not be silently removed or renamed.

## Validation

The companion machine-readable file `pr-3-contract-finalization.json` and offline test must prove:

- PR-1 OAuth/public operation parity;
- target lifecycle OpenAPI path and operation-ID parity;
- OP-001 through OP-018 coverage;
- separation of current, target, and non-route contracts;
- no duplicate method/path or operation ID within a layer;
- no target lifecycle route is claimed as runtime-current without inventory evidence;
- lifecycle states/errors/deployment exposure remain aligned with merged contracts;
- `secrets_included=false`.

## Deferred work

- T080 canonical OpenAPI updates and generated artifact regeneration.
- Runtime route/service implementation.
- Migration apply and persistence wiring.
- Dynamic policy/registry activation.
- Provider execution, deployment, and rollout.
