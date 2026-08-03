# Brand-Scoped Commerce Acceptance Matrix

| ID | Capability | Required evidence | Failure that must be detected |
|---|---|---|---|
| BCA-001 | Mandatory Brand context | Every commerce command and event contains non-null `brand_ref` | Missing Brand accepted |
| BCA-002 | Two Brands in one Workspace | Independent products, stock, orders, catalogs, measurement, and Drive roots | Data merged by Workspace only |
| BCA-003 | Brand membership | User authorized for Brand A can operate A | Workspace membership alone grants Brand B access |
| BCA-004 | Cross-Brand denial | Brand A product/Stock Unit rejected under Brand B context | Cross-Brand resource accepted |
| BCA-005 | Public hostname resolution | Hostname resolves exactly one active Brand | Caller-supplied Brand overrides hostname authority |
| BCA-006 | POS terminal resolution | Terminal and shift resolve one Brand | Terminal sells another Brand without delegation |
| BCA-007 | Live Commerce resolution | Session resolves Brand, channel, and reservation authority | Session reserves another Brand stock |
| BCA-008 | Domain authority uniqueness | One active writer per Brand/domain | Zero or multiple writers proceed |
| BCA-009 | Brand-owned connection | Brand-owned connection selected without caller provider ID | Route selects first available connection |
| BCA-010 | Workspace-delegated connection | Explicit delegation names Brand/domain/capability | Workspace ownership alone grants use |
| BCA-011 | Personal connection isolation | Personal connection unavailable to other Workspace members | Shared membership exposes personal Drive/provider |
| BCA-012 | No broader fallback | Missing Brand connection blocks before credentials | Fallback to Workspace/personal connection |
| BCA-013 | Stale Brand profile | Changed profile revision returns deterministic conflict | Mutation executes under old Brand settings |
| BCA-014 | Stale connection binding | Revoked or changed binding blocks dispatch | Credential loaded before revision check |
| BCA-015 | Brand suspension | Suspended Brand blocks normal commerce writes | Sales continue after suspension |
| BCA-016 | Brand channel binding | Storefront/catalog channel belongs to Brand | Channel from another Brand accepted |
| BCA-017 | Brand location binding | Inventory/POS location belongs to or is delegated to Brand | Cross-Brand location silently accepted |
| BCA-018 | Brand-specific pricing | Price snapshot derives from Brand price policy | Workspace default price leaks across Brands |
| BCA-019 | Unique-item reservation | Brand included in lock, idempotency, and aggregate identity | Same Stock Unit identity collides across Brands |
| BCA-020 | Order identity | Order and transaction IDs preserve Brand identity | Reporting merges same external ID across Brands |
| BCA-021 | Payment routing | Brand payment binding chosen by policy | Caller gateway/account ID selects destination |
| BCA-022 | Shipping routing | Brand shipping binding and policy selected | Another Brand carrier account used |
| BCA-023 | Catalog routing | Google/Meta/TikTok destination resolved from Brand binding | Product published to another Brand catalog |
| BCA-024 | WhatsApp routing | Brand sender/template/consent binding selected | Message sent using another Brand identity |
| BCA-025 | GA4/GTM routing | Brand event reaches Brand measurement profile | Event routed to Workspace-wide default silently |
| BCA-026 | Event deduplication | Deduplication key includes Brand | Brand A event suppresses Brand B event |
| BCA-027 | Attribution | Campaign and contribution facts retain Brand | Spend or revenue mixed across Brands |
| BCA-028 | Customer relationship | Customer-brand relationship isolated | Brand B sees Brand A private timeline |
| BCA-029 | Supplier relationship | Supplier lot and commercial terms retain Brand | Shared supplier causes cost/lot leakage |
| BCA-030 | Product media | Product media binding includes Brand | Asset reused cross-Brand without permission |
| BCA-031 | Brand File Profile | Active Brand resolves one file profile and root | Commerce file write uses generic Workspace root |
| BCA-032 | Drive connection | Brand-owned or explicitly delegated Drive connection used | Personal Drive silently used for Brand assets |
| BCA-033 | Drive root containment | Create/upload/move/copy stay under authorized Brand roots | Operation escapes to another Brand root |
| BCA-034 | Drive batch workflow | Child folders, uploads, archive, manifest, readback complete | Partial failure hidden or duplicate resume |
| BCA-035 | Drive search isolation | Search filters Brand before retrieval | Another Brand private file appears |
| BCA-036 | Cross-Brand file transfer | Separate capability and evidence required | Move/copy crosses Brand roots implicitly |
| BCA-037 | Shared physical location | Two Brands can share building while stock/terminal/settlement remain isolated | Location sharing becomes commerce sharing |
| BCA-038 | Shared provider account | Explicit sub-account/mapping evidence preserves Brand | Shared provider account loses Brand attribution |
| BCA-039 | Webhook Brand resolution | Inbox event maps to connection then exact Brand binding | Provider payload Brand ID grants authority |
| BCA-040 | Unknown outcome | Readback preserves original Brand context | Retry resolves under current/default Brand |
| BCA-041 | Outbox delivery | Outbox aggregate and consumer idempotency include Brand | Cross-Brand delivery collision |
| BCA-042 | Cache and search keys | Cache/projection keys include Brand | Same SKU collides across Brands |
| BCA-043 | Agent tool execution | Agent sees pinned Brand and uses same application service | Agent chooses provider/folder directly |
| BCA-044 | Approval | Approval evidence includes Brand and cannot be replayed elsewhere | Brand A approval authorizes Brand B action |
| BCA-045 | Admin switcher | Brand selection is visible and permission-filtered | Hidden/default Brand changes during work |
| BCA-046 | Migration classification | Workspace-only legacy settings remain unbound until mapped | Automatic default-Brand inference |
| BCA-047 | Collision repair | Duplicate SKU/order/catalog/file mappings across Brands enter repair queue | Ambiguity silently collapsed |
| BCA-048 | Revocation | Membership/delegation/binding revocation blocks subsequent execution | Cached authority remains active |
| BCA-049 | Audit | Bounded evidence records Brand, revisions, operation, and outcome | Logs contain secrets or omit Brand |
| BCA-050 | Reconciliation | Periodic jobs detect cross-Brand mapping and projection drift | Drift remains invisible |

## Completion rule

Brand-scoped commerce is not production-ready unless all applicable tests pass in a pilot containing at least two active Brands in one Workspace, separate provider/file bindings, at least one shared physical location case, and explicit negative cross-Brand tests.
