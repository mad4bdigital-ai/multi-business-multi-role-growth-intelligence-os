# WordPress Site Control Plane Provider Profile

`mad4bdigital-ai/WordPress` PR #6 is supported as a first-class **provider-side integration candidate** for the MAD4B governed operating kernel. WordPress, the official MCP Adapter, a WordPress Ability, a native plugin MCP surface, or a custom WordPress MCP server never become a second platform authorization or execution authority.

## Exact observed candidate

The current observed WordPress candidate is PR #6 at `937aa507b8b2d0ff94050395e3cbb704673d85ed`, plugin version `0.3.0`. Its exact-head repository workflow `MAD4B Site Control Plane` passed. This proves repository contract/lint/package evidence only; the PR remains Draft and target-site runtime certification is still pending.

PR #6 now carries `mad4b.site-control-plane.certified-providers.v1` evidence for the exact packaged providers: MCP Adapter `0.5.0`, Elementor `4.1.4`, JetEngine `3.8.11.2`, JetSmartFilters `3.8.3.1`, and Bit Flows `1.24.0`. This provider registry is compatibility/drift evidence, not platform authorization.

The packaged official MCP Adapter is `0.5.0`, which supports protocol negotiation for `2025-11-25`, `2025-06-18`, and `2024-11-05`. The latest observed upstream release is `v0.6.1`. Release `v0.6.1` repairs a packaging defect in the `v0.6.0` ZIP; therefore the current tested `0.5.0` package is not rejected merely for being older, but the `v0.6.0` release ZIP must not be promoted and upgrade to `v0.6.1` should be reviewed before Production provider certification.

Upstream MCP `2026-07-28` support remains unproven/open. This does not block the platform architecture: the external MAD4B MCP ingress and downstream WordPress provider transport are independent protocol hops.

## Two supported modes

### Standalone site-admin mode

Direct use of `mad4b-read`, `mad4b-content`, `mad4b-admin`, and explicitly enabled `mad4b-breakglass` WordPress MCP servers is acceptable for site-local diagnostics, development, manual administrator maintenance, and local recovery. WordPress authentication and capabilities are authoritative only for that site-local session. This is not the multi-tenant MAD4B platform path.

### Governed platform-provider mode

Content Intelligence and the wider MAD4B platform use:

`external principal -> MAD4B authenticated transport -> focused System Tool Catalog projection -> Spec 012 exact context -> capability/policy/provider resolution -> Spec 011 operation/envelope/approval/idempotency -> WordPress provider binding -> Site Control Plane Ability -> provider readback -> canonical evidence ledger`

`current_user_can()` remains provider-side defense in depth. It does not replace Tenant/Workspace/Brand/resource/capability/policy resolution.

## Capability, Operation, Ability and MCP are different layers

- **Capability** is the platform semantic authorization domain, for example `cms.content.update`.
- **Operation** is the bounded canonical invocation with effect, idempotency and readback semantics.
- **WordPress Ability** is the provider-side typed endpoint.
- **WordPress MCP tool** is a transport projection of that Ability.
- **Native Elementor/JetEngine MCP or Abilities** are provider-internal dependencies that the Site Control Plane may prefer or wrap; they are not parallel MAD4B external tool authorities.

Therefore discovering `mad4b/content-update-post`, an Elementor Ability, or a JetEngine MCP tool never grants platform permission or chooses the Tenant/resource.

## Required governed binding still missing

Before normal Production projection, the provider hop must verify references for canonical `operation_id`, Capability, Tenant/Workspace/Brand/resource, environment, effect, idempotency key, execution envelope/capsule, provider connection, expected resource revision/hash, approval when required, readback contract, and correlation ID.

Authority-bearing broker assertions belong in authenticated transport metadata or server-side references, not model-visible Ability arguments. WordPress must fail closed when a binding is missing, stale, expired, consumed, or selects a different target/connection from the canonical Operation.

PR #6 stale-state guards—`modified_gmt`, SHA-256, language/thumbnail state and Bit Flows flow fingerprints—are strong provider concurrency checks, but they do not replace the platform operation identity and idempotency key.

## Provider versions and drift

The exact packaged provider registry is useful evidence for eligibility and runtime drift detection. The MAD4B provider resolver should consume this evidence alongside target-site runtime readback, certification status, health and policy. It must not infer authorization from package presence or version match.

JetEngine `3.8.11.2` is important here: the packaged build exposes `jet_engine()` and native MCP-tools evidence but does not define the legacy `JET_ENGINE_VERSION` constant. The provider scanner now uses real runtime/package contracts and Plugin Header version rather than falsely requiring that historical constant.

## Readback and evidence

A successful MCP/HTTP response never confirms a state-changing business effect on its own. Normalize outcomes to `confirmed`, `pending`, `rejected`, `blocked`, `failed_known`, `unknown`, `diverged`, or `compensated`. Unknown outcomes are reconciled before retry.

The WordPress hash-chained option log and provider-version registry may contribute correlation/evidence, but they do not replace the canonical MAD4B execution receipt/readback ledger.

## Filesystem boundary

Filesystem operations need two different risk classes. Upload/content files can use a certified provider operation when exact path/root/hash policy is satisfied. Mutation of WordPress Core, plugin or theme source code is a stronger **code mutation** effect and should normally use repository patch/deploy authority or Host Breakglass according to resource ownership and recovery context. WordPress never receives arbitrary shell/PHP execution authority.

## Breakglass boundary

The disabled-by-default WordPress raw SQL Ability is explicitly excluded from normal System Tool Catalog projection. Ordinary Agents, Packages and Content Intelligence cannot discover or invoke it. Platform raw SQL/shell exception authority remains **Host Breakglass**. Host files outside PHP permissions, services and hosting APIs remain a MAD4B Host Connector concern.

## Content Intelligence readiness

- **CI-0** compatible: research, knowledge, blueprint and internal draft require no WordPress mutation.
- **CI-1** partial: existing-post update, media metadata/featured image, Rank Math, Elementor, JetEngine/JetSmartFilters and Bit Flows foundations exist. Missing: dedicated governed `content-create-draft`, canonical provider binding/idempotency and readback forwarding.
- **CI-2** blocked: dedicated schedule/publish Operations plus exact plan approval and readback are missing.
- **CI-3** blocked: bounded autonomous publish still needs canary, rollback and unknown-outcome certification.
- **CI-4** remains an improvement-candidate loop; no self-modifying Production.

The Media adapter still lacks upload, so media ingestion remains an explicit provider gap.

## Upstream strategy

Do not fork `WordPress/mcp-adapter` to add Elementor, JetEngine, database, filesystem or Content Intelligence logic. Those remain Site Control Plane adapters/Abilities. A bounded fork/custom transport is justified only when a proven broker-authentication, fail-closed binding, observability, or protocol requirement cannot be met through upstream extension points.

## Certification gate

PR #6 is **repository-CI-supported but not runtime-certified**. Production provider promotion still requires target-site version readback, dedicated bounded WordPress identity, custom-server isolation, governed operation/envelope binding, platform idempotency, same-cycle readback, canonical evidence forwarding, provider-specific live acceptance, source-code mutation policy, structured-DB negative tests, Breakglass non-projection, protocol compatibility, and rollback/reconciliation evidence.
