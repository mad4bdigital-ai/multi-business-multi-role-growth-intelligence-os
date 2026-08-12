# Tenant Spec Kit implementation matrix — 2026-08-12

## Purpose and completion rule

This matrix expands PR #6959 to cover Tenant-facing work from the Spec Kits, including low-priority items. It is an execution and truthfulness artifact, not a substitute for runtime evidence. Spec 015 explicitly states that no runtime task is complete in its specification PR, and its completion rule requires exact change evidence plus the task-specific test, migration, deployment, readback, external-integration, and operational evidence. Accordingly, this matrix does **not** mark product or runtime tasks as implemented merely because source files, documentation, or CI are green.

## Local work delivered in PR #6959

The PR now hardens the canonical User-JWT boundary for the covered Tenant-facing route families. Local route verifiers and development secrets were removed from resource, docs, evolution, lifecycle, activation guidance, agent surfaces, container team, registry data, tenant infrastructure, support-ticket, and repository-conflict dry-run routes. The shared regression, User-JWT governance registry, E2E contract, inventory, evaluation, and frontend determinism artifacts are being kept in the same bounded change set. Existing membership, role, idempotency, dry-run, provider, credential, and mutation semantics were not broadened.

This is **cross-cutting Tenant auth hardening**. It is not a claim that Spec 015 package, component, installation, entity, AI, publication, delegation, pilot, migration, or provider tasks are complete.

## Spec 015 task classification

| Task range | Tenant capability area | Local action possible in the current PR | Evidence status and blocker |
|---|---|---|---|
| T002–T003 | Current-main inventory and field-level reuse matrix | Static repository inventory and a bounded reuse audit can be produced locally. | The current audit is partial. A complete field-level matrix needs authoritative schema/authority census and review; no implementation completion is claimed. |
| T006 | Duplicate Spec identities and canonical semantic paths | Duplicate-path and artifact-reference audit can run locally. | Canonical identity approval is a governance decision; no approval is fabricated. |
| T008 | Architecture, product, security, privacy, ownership, portability, and external-integration decisions | Decisions can be recorded after explicit owner approval. | Blocked by product/security/privacy/ownership decisions. |
| T010–T018 | Package/component types, authorities, publication policy, bindings, validators, catalogs, readback descriptors, and tests | Auth-related route contracts and no-secret governance are locally executable. | The actual package/component registry and Tenant/Admin catalog authorities are not implemented as a Spec 015 runtime substrate; persistence and authority mapping require architecture and schema decisions. |
| T020–T027 | Installation identity, exact scope, sparse overrides, credential-free bindings, deterministic compiler, impact preview, and hash tests | Deterministic pure validators could be added after canonical input schemas and authority sources are approved. | No canonical package/install input schema, persisted revision authority, or approved requirement-binding model exists in the current branch. Implementing an invented compiler would create false authority. |
| T030–T036 | Custom entities, relationships, compatibility, lifecycle, transitions, SLA, and compensation | Static contract tests are possible once stable runtime primitives are selected. | Requires approved persistence strategy, migration plan, lifecycle authority, and effect/readback semantics. |
| T040–T045 | Forms, client links, file policies, folders, retention, quarantine, and recovery | No-effect schema validators can be prepared after file and identity authorities are frozen. | Requires file authority, retention/legal policy, client identity, and cross-client isolation decisions. |
| T050–T056 | Draft-only AI authoring, provider bindings, UI/report definitions, safety and prompt-injection tests | Local tests can prove structured output and no-authority invention when the service contract exists. | No approved package authoring schema, provider abstraction, sensitivity/budget policy, or generated-surface authority is available for a truthful implementation. |
| T060–T066 | Publication states, installation lifecycle, acceptance evidence, CAS/readback, upgrade, rollback, revocation, and continuity tests | Pure transition tables and no-effect validators are locally safe after state and evidence registries are approved. | CAS, migration planning, activation, rollback, and revocation require persisted authority and same-cycle readback; no runtime closure is claimed. |
| T070–T076 | Clients-as-Brands, delegated agency operation, revocation, portfolio summaries, export/handover, ownership matrix, and portability tests | Ownership/export schemas and cross-scope static tests can be drafted locally. | Requires approved client/Tenant ownership model, delegation authority, connection revocation semantics, export legal policy, and handover readback. |
| T080–T085 | Candidate PR reconstruction and related subsystem convergence | Static candidate, exact-head, duplicate-identity, stale-artifact, and canonical-path audits are safe and can be attached to the PR. | Reconstructing product/runtime packages from historical PRs requires scope approval and exact current-main compatibility; no copied implementation is treated as authoritative. |
| T090–T095 | Tenant and agency pilots, Evidence/Retail sandbox runs, outage, recovery, disable, and revocation | Test plans and read-only preflight contracts can be prepared locally. | Requires sandbox/staging data, provider cohorts, operational authority, and canary evidence. |
| T096–T097 | Production/runtime/generated-surface/health/rollback evidence and final closeout | Documentation can be updated after evidence exists. | Requires Production migration/readback, external surface parity, health/rollback evidence, and owner review. |

## Cross-Spec Tenant tasks

The open-task inventory also contains Tenant work in Specs 001, 004, 005, 006, 007, 008, 009, 010, 011, 012, 014, 016, 017, and 018. These are not silently collapsed into Spec 015. Their common classification is:

| Class | Examples | Treatment in this PR |
|---|---|---|
| Local source/contract hardening | Canonical JWT parsing, no-secret checks, route callability, OpenAPI parity, static registry checks, deterministic artifact checks, and dry-run/no-provider contracts. | Implemented only where the existing authority and tests are explicit; the expanded Tenant auth batch is covered by `tenant-route-auth-hardening.json`. |
| Audit or decision work | Schema census, authority ownership, reuse matrices, canonical identity selection, policy/retention/ownership decisions, and platform/provider certification plans. | Documented as audit/readiness evidence where possible; not marked as runtime closure. |
| Migration/readback work | Additive migrations, Production schema hashes, migration ledgers, compare-and-set, readback, runtime promotion, provider certification, and external-surface parity. | Remains blocked and fail-closed. No mutation or fabricated readback is performed. |
| External or operational work | Cloudflare/local connector, Hostinger/WordPress, GitHub runner allocation, canaries, OAuth, provider dispatch, staging/Production pilots, and post-merge closeout. | Remains explicitly deferred or runtime-blocked according to the existing PR readiness record. |

## Remaining route-local JWT exceptions

`dynamicContainerAuthorityRoutes.js` remains a mixed user/admin authority resolver: its user path and backend-admin fallback share the same entrypoint. `platformEvolutionRoutes.js` creates an internal Tenant-smoke token for a platform self-call rather than acting as a normal Tenant user verifier. These files were not changed in this bounded auth batch because replacing their mixed/internal behavior without a contract-preserving design would be a semantic change. This is recorded as residual scope, not hidden as complete.

## Closeout statement

The PR can truthfully close the expanded **local Tenant auth-hardening and governance slice** once regenerated artifacts and exact-head CI pass. It cannot truthfully close all Tenant Spec Kit tasks until the decision, schema, migration, provider, staging/Production, readback, delegation, ownership, and operational evidence listed above exists. No task in Spec 015 is marked implemented by this document.

## Repository evidence

- `specs/015-tenant-operating-system-studio/tasks.md`
- `docs/issue-execution/tenant-spec-kit-open-scope-audit-20260812.md`
- `.changes/e2e/tenant-route-auth-hardening.json`
- `http-generic-api/test-tenant-route-canonical-user-jwt-auth.mjs`
- `http-generic-api/scripts/user-jwt-auth-governance.mjs`
- `docs/issue-execution/tenant-route-followup-readiness-20260812.md`
