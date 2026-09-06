# WordPress Site Control Plane Provider Profile

This profile makes `mad4bdigital-ai/WordPress` PR #6 a first-class **provider-side integration candidate** for the MAD4B governed operating kernel without allowing WordPress, the MCP Adapter, a WordPress Ability, or a custom MCP server to become a second platform authorization or execution authority.

## Observed implementation

The observed WordPress candidate is PR #6 at `d838847997e8f7788e321b5e43e8f517077f1194`, plugin version `0.3.0`. It builds on the official WordPress Abilities API and `WordPress/mcp-adapter`, defines isolated `mad4b-read`, `mad4b-content`, `mad4b-admin`, and disabled-by-default `mad4b-breakglass` MCP servers, and implements optimistic stale-state guards for content, files, media, several plugin adapters, Bit Flows, and structured database repairs.

The latest observed official `WordPress/mcp-adapter` release is `v0.6.1`. That release fixes the packaged ZIP and retains the current HTTP transport architecture. Its HTTP transport baseline is MCP `2025-11-25`. Upstream support for MCP `2026-07-28` is still an open compatibility item, so this integration MUST NOT claim that the WordPress endpoint itself implements the 2026 protocol profile until that is proven.

This does not block the MAD4B platform: the external MAD4B MCP surface and the downstream WordPress provider transport are separate protocol hops. The MAD4B provider adapter may speak the WordPress-supported MCP version internally while the platform-facing transport evolves independently.

## Two supported modes

### 1. Standalone site-admin mode

Direct use of the WordPress custom MCP servers is acceptable for site-local diagnostics, development, manual administrator maintenance, and explicitly enabled local recovery. WordPress authentication and capabilities are authoritative only for that site-local session. This mode is not the multi-tenant MAD4B platform authorization path.

### 2. Governed platform-provider mode

Content Intelligence and the wider MAD4B platform must use the canonical path:

`external principal -> MAD4B authenticated transport -> focused System Tool Catalog projection -> Spec 012 exact context -> capability/policy/provider resolution -> Spec 011 operation/envelope/approval/idempotency -> WordPress provider binding -> Site Control Plane Ability -> provider readback -> canonical evidence ledger`

The WordPress connection identity is a bounded provider identity. `current_user_can()` remains mandatory defense in depth, but it does not replace the Tenant/Workspace/Brand/resource/capability/policy decision made by the platform.

## WordPress Ability is not a canonical Capability

The vocabulary is intentionally different:

- **Capability** is the platform semantic authorization domain, such as `cms.content.update`.
- **Operation** is the bounded canonical invocation with effect, idempotency and readback semantics.
- **WordPress Ability** is the provider-side typed endpoint that an adapter invokes.
- **WordPress MCP tool** is a transport projection of that Ability.

Therefore `mad4b/content-update-post` may implement a `cms.content.update` operation, but discovery of that Ability does not grant permission and does not define the platform resource scope.

## Required governed binding not yet proven by PR #6

Before the WordPress candidate can be projected as a normal MAD4B production provider, the provider hop must carry and verify references for the canonical operation, capability, exact resource scope, environment, effect class, idempotency key, execution envelope/capsule, provider connection, expected resource revision/hash, approval when required, readback contract, and correlation ID.

Authority-bearing broker assertions should travel as authenticated transport metadata or server-side references, not as model-visible Ability arguments. WordPress must fail closed when the binding is missing, stale, expired, consumed, or selects a different resource/connection than the canonical operation.

The existing `expected_modified_gmt`, SHA-256, thumbnail/language preconditions and Bit Flows flow fingerprint are valuable **provider concurrency guards**. They do not replace the platform-wide idempotency key and operation identity.

## Readback and evidence

A successful MCP/HTTP response is not enough for a state-changing operation. The WordPress adapter must return provider-specific readback and the MAD4B runtime must normalize it into `confirmed`, `pending`, `rejected`, `blocked`, `failed_known`, `unknown`, `diverged`, or `compensated`.

The WordPress hash-chained option log is useful provider-local evidence and correlation data, but it is bounded and mutable under WordPress database authority. It must be forwarded into or referenced by the canonical MAD4B evidence/readback ledger rather than becoming the audit source of truth.

## Breakglass boundary

The observed WordPress plugin includes a disabled-by-default raw SQL Ability. That surface is explicitly **not** a normal System Tool Catalog projection in the MAD4B platform.

- WordPress raw SQL may remain a local emergency mechanism only while explicitly enabled and independently audited.
- Normal Agent/Package/Content Intelligence execution cannot discover or invoke it.
- Platform raw SQL and shell exception authority remains **Host Breakglass**.
- WordPress must never expose arbitrary shell/PHP execution.
- Host files outside PHP permissions and hosting/service administration remain a separate MAD4B Host Connector concern.

This preserves the existing MAD4B rule that raw SQL/shell are exceptional survival-plane capabilities rather than ordinary agent tools.

## Content Intelligence readiness

The WordPress candidate already provides a strong provider foundation, but it is not yet the full publishing adapter required by Content Intelligence:

- **CI-0** is compatible: research, knowledge, blueprint and internal draft do not need WordPress mutation.
- **CI-1** is partial: read/update of an existing post, Media metadata/featured-image changes, Rank Math, Elementor, JetEngine/JetSmartFilters surfaces and Bit Flows foundations exist; a dedicated governed `content-create-draft` operation and canonical platform binding/readback remain missing.
- **CI-2** remains blocked until dedicated schedule and publish operations exist and are bound to exact plan approval, idempotency and readback.
- **CI-3** remains blocked until bounded production autonomous publishing is certified by canary, rollback and unknown-outcome tests.
- **CI-4** remains a platform feedback loop that proposes improvements but does not self-modify Production.

The observed Media adapter also lacks a governed upload Ability, so Content Intelligence media ingestion remains a specific provider gap rather than an assumed capability.

## Provider-specific mapping examples

| Provider Ability | Canonical Capability | Effect | Additional platform requirement |
| --- | --- | --- | --- |
| `mad4b/content-get-post` | `cms.content.read` | read | exact site/post resource binding |
| `mad4b/content-update-post` | `cms.content.update` | state change | platform idempotency + `modified_gmt` readback |
| `media/update-metadata` | `cms.media.metadata.update` | state change | idempotency + SHA readback |
| `elementor/update-widget-settings` | `cms.elementor.document.update` | state change | native-first certification + exact document hash |
| `bitflows/run-flow` | `automation.bitflows.execution.start` | external/state change | flow fingerprint + execution-ID readback |
| `mad4b/filesystem-patch` | `site.filesystem.patch` | high-risk state change | exact resource, approved root, backup and readback |
| `mad4b/database-update` | `site.database.structured_update` | high-risk state change | structured policy, max affected, transaction/readback |
| `mad4b/database-raw-query` | none in normal catalog | breakglass | excluded from ordinary platform projection |

## Upstream MCP strategy

Do not fork `WordPress/mcp-adapter` merely to add Elementor, JetEngine, database, files, or Content Intelligence logic. Those remain Site Control Plane adapters/Abilities. Keep upstream pinned and upgradeable.

A bounded fork or custom transport is justified only if the official extension points cannot satisfy a proven requirement such as platform broker authentication, fail-closed transport binding, required observability, or protocol compatibility. Protocol compatibility should be isolated at the transport edge rather than leaking into domain Abilities.

## Certification gate

PR #6 is therefore **supported as an integration target**, not yet certified as the platform production provider. Promotion requires target-site runtime evidence, dedicated bounded WordPress identity, server-isolation proof, canonical operation/envelope binding, platform idempotency, same-cycle readback, evidence forwarding, provider-specific adapter acceptance, Breakglass non-projection, and protocol compatibility testing.
