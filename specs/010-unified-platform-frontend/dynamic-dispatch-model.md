# Dynamic Frontend Dispatch Model

## State machine

`discovered → classified → blocked|ready → dispatched → implemented → verified → released`

At any state, authority drift moves the task to `drifted`; regeneration decides whether it returns to `blocked` or `ready`.

## Pipeline

1. **Discover** mounted route builders, literal HTTP operations, route middleware arguments, inherited `router.use` guards, OpenAPI operations, resources, evidence candidates, browser assets, and registered tests.
2. **Normalize** Express parameters and OpenAPI parameters into one method/path signature.
3. **Classify** scope, runtime auth profile, OpenAPI auth profile, operation class, product group, current UI state, and evidence/readback availability.
4. **Resolve policy** from explicit repository rules. Missing decisions fail closed as `requires_review`.
5. **Score risk** from admin/local authority, mutations, unresolved scope, contract gaps, test gaps, and policy gaps.
6. **Build DAG** from baseline, authentication, workspace, BFF, device trust, mutation preflight, and readback dependencies.
7. **Dispatch** only tasks whose blockers are empty and whose source digest still matches.
8. **Verify** with exact registered tests plus coverage/security gates.
9. **Read back** implementation, evidence, accessibility, and production parity before completion.

## Dispatch packet

Every task contains:

- stable `task_key` derived from the mounted route family;
- baseline ref and source digests;
- source files and normalized operations;
- scope, auth mode, mutation and risk classes;
- wave and dependencies;
- blockers and owner decision;
- acceptance gates and executable verification commands;
- evidence/readback requirements;
- fallback and legacy compatibility obligation.

## Authentication parity

Authentication is compared per operation as normalized alternatives, preserving OpenAPI OR/AND semantics. Route middleware and applicable `router.use` guards are evidence; path names alone are not authentication evidence. The artifact records runtime and OpenAPI profiles plus one of `equivalent`, `mismatch`, `undefined_scheme`, `missing_openapi`, `unknown`, or `exempt`.

Handler-level signed links, OAuth state, MCP query tokens, aliases that cannot be resolved statically, and duplicate mounted signatures remain blocked until an exact operation override supplies owner, rationale, and source evidence. Configuration-dependent middleware such as `requireBackendApiKey` records its environment dependency and is never treated as public merely because production configuration is absent.

## Operation and mutation governance

Non-GET is a `mutation_candidate`, not proof of mutation. Every candidate requires an exact `operation_rules` classification: `read_action`, `preflight`, `state_change`, `external_effect`, `disabled`, or `unresolved`. State-changing and externally consequential operations independently require preflight, business approval, same-cycle readback, rollback/compensation, parameter bindings, and registered evidence. A status or preview route elsewhere in the same family cannot satisfy another operation's controls.

Missing, duplicate, invalid, or unused operation rules are policy issues. Inline post-commit readback must cite executable evidence. Transaction rollback covers request failure only and does not silently count as compensation after a successful commit.

## OpenAPI coverage levels

- `canonical`: reviewed operation with its maintained request/response contract.
- `operation-index-only`: generated method/path, path parameters, explicit auth evidence, and an intentionally schema-free default response. This closes discovery debt but remains a detail-contract blocker.
- `explicit_exemption`: repository allowlist entry with reviewable evidence; it is counted separately and is not called documentation.
- `missing`: neither canonical documentation, safe generated indexing, nor an approved exemption exists.

The generated index never invents request bodies, response bodies, or success status codes. Routes with unresolved authentication or conflicting duplicate profiles stay missing.

## Wave selection

| Wave | Selection rule | Hard prerequisite |
|---|---|---|
| F0 authority | unresolved scope/policy/contract/ownership | source baseline |
| F1 tenant shell | public or tenant-safe family | JWT, membership, workspace context |
| F2 Admin BFF | shared admin browser-session boundary | HttpOnly session, CSRF, origin, audit |
| F3 admin workspaces | admin family | F2 and explicit adapter |
| F4 Local Manager | device/local route family | tenant ownership, device trust, local consent |
| F5 developer/evidence | technical or evidence family | explicit grant and redaction |
| F6 cutover | legacy replacement and release | parity, accessibility, telemetry, production evidence |

## Automatic blockers

- route is mounted but absent from OpenAPI without explicit approved exemption;
- scope or auth mode is unresolved;
- browser policy decision is absent;
- no registered test maps to the family;
- a non-GET operation has no exact classification;
- a state-changing operation has no per-operation preflight, approval, readback, rollback/compensation, parameter binding, or evidence contract;
- runtime and OpenAPI authentication profiles do not match or reference an undefined scheme;
- a generated operation index still lacks a reviewed detail contract;
- Admin access would require `BACKEND_API_KEY` in browser code;
- resource surface bypasses logical Resource API descriptors;
- device action lacks ownership, freshness, trust, or local consent;
- source digest differs from the task baseline.

## Dispatch policy

The generator creates work; it does not call providers, write databases, deploy, approve mutations, or expose secrets. Human or governed automation may claim a `ready` packet. Parallel execution is allowed only for tasks without a dependency edge and with disjoint source ownership.

## Continuous planning

The dispatch plan is regenerated on changes to routes, OpenAPI, resources, migrations, surface policies, frontend assets, runtime maps, or the test manifest. The diff is reviewed as a product coverage change: new route families create new work automatically; removed families require deprecation evidence; changed auth/mutation classes re-open verification.
