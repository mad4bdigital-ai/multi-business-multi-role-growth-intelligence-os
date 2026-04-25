# Runtime and Registry Refactor Plan

Status: active implementation roadmap

Purpose: define the next safe refactor track for the runtime and registry layers after the major `server.js` decomposition. This plan is not a rewrite plan. It is a controlled boundary-hardening plan that preserves current behavior, contracts, and governance while reducing the remaining centers of gravity.

## Current State

The runtime has already improved materially:

- `http-generic-api/server.js` is now bootstrap and wiring oriented, currently about 2674 lines.
- `http-generic-api/routes/` exists and contains separated route families.
- `runtimeState.js`, `runtimeGuards.js`, `runtimeHelpers.js`, `mcpRuntime.js`, `registryReadPolicies.js`, and `domainAdapters/` are present.
- `executionFacade.js` is now the main execution coordination hub.
- `registryResolution.js` remains the main registry resolution and governance hub.

The next architectural risk is not `server.js`; it is complexity migrating into new hub files. The priority is therefore:

1. Split `executionFacade.js` into focused execution modules.
2. Split `registryResolution.js` into focused registry governance modules.
3. Audit route families to keep them thin.
4. Expand `domainAdapters/` only when a real domain coupling appears.
5. Stabilize cross-cutting runtime modules.
6. Align documentation after boundaries change.

## Governing Principles

- Preserve external behavior unless an explicit approval authorizes behavior change.
- Keep every PR focused on one responsibility.
- Separate refactor changes from behavior changes.
- Keep diffs small, safe, and reviewable.
- Preserve backward compatibility wherever possible.
- Update documentation only when boundaries, responsibilities, or contracts change.

## Execution Track

### PR-E1: Extract Execution Resolution

New module: `http-generic-api/executionResolution.js`

Move resolution concerns into this module:

- parent action resolution
- endpoint resolution
- execution eligibility validation
- readiness prechecks
- resolution logic that runs before request preparation

Acceptance criteria:

- `executionFacade.js` no longer contains long resolution internals.
- Runtime paths use `executionResolution.resolve(...)` or an equivalent single entrypoint.
- Behavior and guard outputs remain unchanged.

### PR-E2: Extract Execution Preparation

New module: `http-generic-api/executionPreparation.js`

Move preparation concerns into this module:

- auth mode preparation
- schema lookup
- variable contract handling
- request assembly
- request normalization

Acceptance criteria:

- `executionFacade.js` no longer mixes resolution and preparation internals.
- auth, schema, and variable-contract failures originate from the preparation layer.
- Existing response envelopes and failure mapping remain unchanged.

### PR-E3: Extract Execution Dispatch

New module: `http-generic-api/executionDispatch.js`

Move dispatch concerns into this module:

- direct HTTP dispatch
- delegated transport dispatch
- MCP dispatch handoff
- provider call orchestration
- direct execution response normalization

Acceptance criteria:

- `executionFacade.js` no longer contains transport-heavy logic.
- dispatch concerns have one clear owner.
- provider and transport failure behavior remains unchanged.

### PR-E4: Extract Async Lifecycle

New module: `http-generic-api/executionAsync.js`

Move async lifecycle concerns into this module:

- async submission
- job creation/update glue
- async failure mapping
- result retrieval glue

Acceptance criteria:

- `executionFacade.js` no longer manages async lifecycle internals.
- async job state transitions remain unchanged.
- `failAsyncSubmission` behavior remains stable.

### PR-E5: Reduce Execution Facade

Keep `executionFacade.js` as an orchestration-only facade with:

- `execute()`
- `executeAsync()`
- `getJob()`
- `getJobResult()`

Its role should become:

1. call resolution
2. call preparation
3. call dispatch or async submission
4. return the existing response shape

Acceptance criteria:

- `executionFacade.js` is a thin orchestrator.
- file size drops clearly.
- no external behavior changes.

### PR-E6: Route Audit After Facade Split

Target files:

- `http-generic-api/routes/executeRoutes.js`
- `http-generic-api/routes/jobRoutes.js`
- `http-generic-api/routes/mcpRoutes.js`
- `http-generic-api/routes/governanceRoutes.js`

Acceptance criteria:

- route handlers do request in, call facade/service, response out.
- no heavy resolution, preparation, or dispatch logic lives in route files.

## Registry Track

### PR-R1: Extract Policy Access Helpers

New module: `http-generic-api/registryPolicyAccess.js`

Move:

- `policyValue`
- `policyList`

Acceptance criteria:

- `registryResolution.js` no longer owns policy helper internals.
- `registryPolicyAccess.js` is the source of policy access behavior.
- interpretation remains unchanged.

### PR-R2: Extract Execution Eligibility Guards

New module: `http-generic-api/registryExecutionEligibility.js`

Move:

- `requireRuntimeCallableAction`
- `requireEndpointExecutionEligibility`
- `requireExecutionModeCompatibility`

Acceptance criteria:

- eligibility guards are isolated.
- guard codes, messages, and blocking/degraded behavior remain unchanged.

### PR-R3: Extract Transport Governance

New module: `http-generic-api/registryTransportGovernance.js`

Move:

- `isDelegatedTransportTarget`
- `requireTransportIfDelegated`
- `requireNoFallbackDirectExecution`
- `requireNativeFamilyBoundary`
- `getPlaceholderResolutionSources`
- `resolveRuntimeProviderDomainSource`

Acceptance criteria:

- transport/runtime governance no longer lives inside `registryResolution.js`.
- guard codes and messages remain stable.
- fallback and provider-domain resolution behavior remain unchanged.

### PR-R4: Reduce Registry Resolution Facade

Keep `registryResolution.js` responsible only for:

- general resolution orchestration
- facade exports
- compatibility re-exports where needed during migration

Acceptance criteria:

- policy access, eligibility, and transport governance implementations are gone from `registryResolution.js`.
- no circular imports are introduced.
- runtime consumers continue to import successfully.

## Route Family Audit

Target files:

- `http-generic-api/routes/executeRoutes.js`
- `http-generic-api/routes/jobRoutes.js`
- `http-generic-api/routes/healthRoutes.js`
- `http-generic-api/routes/governanceRoutes.js`
- `http-generic-api/routes/mcpRoutes.js`
- `http-generic-api/routes/index.js`

Audit questions:

- Do routes only parse request input, call a facade/service, and return a response?
- Is registry resolution, auth preparation, or dispatch selection leaking into route files?
- Do MCP routes remain wiring that delegates to `mcpRuntime.js` or a facade?

Acceptance criteria:

- route files remain thin.
- orchestration does not get reabsorbed into routes.

## Domain Adapter Expansion

Goal: prevent generic runtime modules from importing heavy domain internals directly.

Targets:

- review existing `domainAdapters/wordpressAdapter.js`
- identify any direct domain-heavy imports from `executionFacade.js`, routes, or `server.js`
- add adapters only when there is real repeated domain coupling

Acceptance criteria:

- generic runtime modules remain domain-light.
- heavy domain behavior passes through a small adapter/facade boundary.

## Cross-Cutting Runtime Audit

Target modules:

- `runtimeGuards.js`
- `runtimeHelpers.js`
- `runtimeState.js`
- `mcpRuntime.js`
- `registryReadPolicies.js`
- `googleSheets.js`

Audit questions:

- Does each file still have one clear responsibility?
- Has unrelated logic started accumulating there?
- Are direct tests needed for newly important behavior?

Acceptance criteria:

- these modules remain focused.
- they do not become new complexity buckets.

## Documentation Alignment

Update documentation when boundaries materially change:

- README or runtime docs
- folder map
- PR checklist
- engineering guidelines
- operational docs tied to execution or governance

Document:

- `server.js` as bootstrap/wiring
- `executionFacade.js` as orchestration-only facade
- `registryResolution.js` as orchestration-only facade
- route family boundaries
- `domainAdapters/`
- `mcpRuntime.js`
- `googleSheets.js`
- `registryReadPolicies.js`

Acceptance criteria:

- new architecture is understandable from docs.
- onboarding does not require reverse-engineering the refactor history.

## Execution Facade Acceptance Tests

The execution facade track is complete only when these paths remain stable:

1. Happy path: direct execution
   - valid request, action, endpoint, auth, schema, variables, and dispatch
   - same response envelope, status, and payload mapping

2. Happy path: async execution
   - job creation, submission, and result retrieval remain stable

3. MCP path
   - initialize, tools/list, and tools/call remain stable
   - current auth contract and Accept/token expectations remain stable

4. Resolution failures
   - non-callable action, ineligible endpoint, execution-mode mismatch
   - same guard codes and classifications

5. Preparation failures
   - auth resolution, schema binding, variable contract failures
   - same blocking/degraded behavior

6. Dispatch failures
   - provider failure, transport failure, provider-domain failure
   - same failure mapping and response normalization

7. Async failure mapping
   - async dispatch failures and job update failures preserve current transitions

8. Route integration
   - `executeRoutes`, `jobRoutes`, and `mcpRoutes` do not regress

## Execution Facade Stop Rule

The execution facade track is complete only when:

- `executionFacade.js` no longer contains heavy resolution, preparation, dispatch, or async lifecycle internals.
- `executionFacade.js` keeps only the public facade methods and thin orchestration.
- routes do not reabsorb the moved logic.
- acceptance tests pass without regression.

File size reduction alone is not sufficient.

## Registry Resolution Acceptance Tests

The registry resolution track is complete only when these paths remain stable:

1. Policy path
   - policy values and lists interpret exactly as before
   - no circular imports

2. Execution eligibility path
   - non-callable actions, ineligible endpoints, and mode mismatches keep current guard behavior

3. Transport governance path
   - delegated transport, fallback blocking, native family boundary, and provider-domain source resolution remain stable

4. Normal resolution path
   - standard request, brand, endpoint, and snapshot outputs remain stable

5. Google/Registry integration
   - `googleSheets.js`, `registryReadPolicies.js`, cached/forced refresh, and validation bypass semantics do not regress

6. Runtime consumers
   - imports from `registryResolution.js` remain compatible during migration

## Registry Resolution Stop Rule

The registry resolution track is complete only when:

- `registryResolution.js` no longer implements policy helpers, eligibility guards, or transport governance helpers internally.
- it remains responsible only for orchestration and facade exports.
- no circular imports exist.
- all acceptance paths pass without regression.

## Final Success Definition

The plan is successful when:

- `server.js` is bootstrap and wiring only.
- `routes/` are request in, facade/service call, response out.
- `executionFacade.js` is a thin facade coordinating resolution, preparation, dispatch, and async.
- `registryResolution.js` is a thin facade coordinating registry resolution.
- `domainAdapters/` isolate heavy domain behavior.
- cross-cutting runtime modules remain small and focused.
- Google/Registry concerns stay separated: policies, sheet access, and resolution do not collapse into one layer.
- documentation reflects the new boundaries.
