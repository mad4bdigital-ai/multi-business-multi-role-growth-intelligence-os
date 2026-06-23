# Self-Discovering Resource API Coverage Review Checklist

## Coverage

- [x] Logical resource descriptors exist for Sessions, Executions, Assets, Approvals, and Resource API Governance.
- [x] Admin scope decisions are declared in the resource manifest and operation registry.
- [x] Tenant scope decisions are declared and resolved from signed JWT membership.
- [x] List and get operations are implemented and documented.
- [x] Search and bounded cursor pagination are implemented.
- [x] Permission resolution is implemented for Admin and Tenant surfaces.
- [x] Changes and revisions are implemented or carry an explicit governed operation state.
- [x] Mutation readback is implemented for approved lifecycle adapters.

## Safety

- [x] Tenant identity is resolved server-side.
- [x] Output fields are allowlisted.
- [x] Client-selected raw SQL tables, columns, projections, and ordering are blocked.
- [x] Secret values, credential payloads, raw authorization material, and unrestricted transcripts are excluded.
- [x] Archive/revoke/disable semantics replace hard deletion; purge remains policy-blocked.
- [x] Version/ETag behavior is explicitly declared per resource, including governed `not_yet_versioned` states.
- [x] Stable error mapping covers 400/401/403/404/409 conditions.

## Delivery

- [x] OpenAPI 3.1 Admin and Tenant contracts are updated and parity-tested.
- [x] Admin and Tenant tool registries are populated by migration 1023.
- [x] Resource API tests are registered in the explicit test manifest.
- [x] Canonicals and the Knowledge Guide were updated and generated.
- [x] GitHub CI passed 4/4 required checks.
- [x] Release readiness passed 70/70 checks.
- [x] Governed PR #1894 merged at `525b5763d0f4396e1358e43ce6a0dd8b6c3b87c7`.
- [x] Migration 1023 applied 12/12 statements with ledger run `683406e3-0758-4ea1-9a7d-134d05fab2ba`.
- [x] Production parity verified at `629b2edbb78a36e30bbdc06c646e049cd74da824` by run `e37a9da4-19f4-4982-9677-8bddabe698af`.
- [x] Post-merge live audit completed and persisted as run `748dbe4e-feb5-4633-9033-2510f80837ec`.
- [x] Historical audit findings are tracked in `backlog.md` with an owner and priority.

## Completion policy

- [x] `completion.json` exists and matches this checklist.
- [x] `multi_pr` is used because migration, production verification, and post-merge audit were required.
- [x] Implementation PR and final closeout PR evidence are declared.
- [x] No unresolved checkbox remains.
