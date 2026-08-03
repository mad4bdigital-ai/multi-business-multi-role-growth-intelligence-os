# Dynamic Business Activity and Profile Inheritance — Acceptance Matrix

| ID | Scenario | Expected result |
|---|---|---|
| BA-AC-001 | Tenant has commercial billing metadata but no Business Operating Profile | Billing remains readable; Commerce Enablement returns `needs_clarification` and does not infer runtime authority |
| BA-AC-002 | `/connect` submits free-text industry | Candidate classification is created with source evidence; no capability is activated automatically |
| BA-AC-003 | Brand has no exact activity type | Read-only discovery is allowed; consequential Commerce writes are blocked |
| BA-AC-004 | Brand has one primary activity | Effective profile contains the primary activity and its pack lineage |
| BA-AC-005 | Brand has primary and secondary activities | Packs compose using explicit priority and dimension merge rules |
| BA-AC-006 | Two activities contribute identical requirements | Requirement is deduplicated while both lineage sources remain visible |
| BA-AC-007 | Two activities require incompatible authorities | Resolver returns `blocked` with a first-class conflict finding |
| BA-AC-008 | Equal-priority parents provide conflicting replacement defaults | Resolver blocks instead of using last-write-wins |
| BA-AC-009 | Tenant denies public file sharing; Brand requests it | `deny_wins`; Brand cannot broaden the policy |
| BA-AC-010 | Workspace recommends WordPress; Brand selects a certified external CMS | `nearest_replace` permits the Brand choice when policy allows |
| BA-AC-011 | Unique-item activity requires reservation; Brand removes it locally | Override is rejected as a forbidden or restrictive-only broadening |
| BA-AC-012 | Brand selects Arabic default; channel selects English | Channel override succeeds only when localization and market policy allow it |
| BA-AC-013 | Unknown profile dimension is submitted | Validation blocks unless active profile definition explicitly supports it |
| BA-AC-014 | Profile definition is deprecated | Existing active profile remains readable but cannot create a new revision without migration |
| BA-AC-015 | Activity type parent cycle is created | Registry write is rejected |
| BA-AC-016 | Activity graph exceeds configured maximum depth | Registry write or activation is rejected |
| BA-AC-017 | Multi-parent activity has deterministic explicit priorities | Resolution is stable across repeated evaluations |
| BA-AC-018 | Applicability predicate uses allowed operators | Predicate compiles and evaluates deterministically |
| BA-AC-019 | Predicate contains JavaScript, SQL, or network operation | Predicate is rejected before activation |
| BA-AC-020 | Predicate exceeds depth or operand limits | Predicate is rejected with bounded validation error |
| BA-AC-021 | Equivalent canonical predicates are evaluated twice | Same digest and same result are produced |
| BA-AC-022 | Activity Pack is added through registry only | New capability composition becomes available without runtime code change |
| BA-AC-023 | Activity Pack references itself or forms a cycle | Pack activation is rejected |
| BA-AC-024 | Active packs are mutually incompatible | Effective profile returns `blocked` and names both packs |
| BA-AC-025 | Profile value is inherited from Tenant | Effective snapshot marks it `inherited` with Tenant revision lineage |
| BA-AC-026 | Brand overrides an allowed default | Snapshot marks old source and local override separately |
| BA-AC-027 | Inheritance fence blocks one dimension | Descendant does not receive that dimension; unrelated dimensions still inherit |
| BA-AC-028 | Workspace profile exists without Brand | It may supply defaults but cannot authorize Commerce execution |
| BA-AC-029 | Two Brands share one Workspace | Effective profiles, caches, packs, and recommendations remain isolated by Brand |
| BA-AC-030 | Same SKU appears in two Brands | Profile and capability resolution do not merge the Brands |
| BA-AC-031 | Brand profile revision changes | Effective snapshot, discovery, Blueprint score, plan drafts, and agent context are invalidated |
| BA-AC-032 | Activity Pack version changes | Dependent snapshots become stale and are recompiled |
| BA-AC-033 | Adapter certification expires | Capability readiness and Blueprint scores are invalidated |
| BA-AC-034 | Stale snapshot is supplied to a write | Write fails closed with stale-profile error |
| BA-AC-035 | Read-only view uses a stale snapshot within allowed projection policy | View is clearly marked stale and does not grant mutation authority |
| BA-AC-036 | Brand changes primary activity | Impact preview lists affected capabilities, providers, workflows, surfaces, and data migrations before activation |
| BA-AC-037 | Profile activation is attempted without owner authority | Activation is denied or routed to approval |
| BA-AC-038 | Profile rollback is requested | Earlier approved revision is restored through a new revision; history remains immutable |
| BA-AC-039 | Apparel stock/outlet profile has unique items plus POS | Atomic reservation and Stock Unit packs are required |
| BA-AC-040 | Same apparel Brand selects WooCommerce Standard | Blueprint is constrained or rejected when cross-channel unique-item guarantees are required |
| BA-AC-041 | Same Brand selects WooCommerce Governed Bridge | Blueprint becomes compatible only when bridge certification and reservation capabilities pass |
| BA-AC-042 | Professional services profile has no inventory | Inventory and POS packs become `not_relevant`; forms, CRM, appointment, and payment-link packs are recommended |
| BA-AC-043 | Travel DMC profile is evaluated | Supplier, itinerary, quotation, multi-currency, and booking-adapter packs are recommended; WooCommerce is not assumed |
| BA-AC-044 | SaaS subscription profile is evaluated | Subscription, entitlement, usage, billing, and support packs are recommended |
| BA-AC-045 | Marketplace profile is evaluated | Vendor, commission, settlement, dispute, and marketplace-compliance packs are required |
| BA-AC-046 | Active WordPress plugin is detected | Plugin is inventory evidence only; capability is not certified automatically |
| BA-AC-047 | WordPress phases A-P apply to activity | Only applicable packs appear; unrelated lifecycle packs remain optional or not relevant |
| BA-AC-048 | WooCommerce plugin conflicts with an inherited regulatory pack | Readiness is blocked with plugin and policy lineage |
| BA-AC-049 | Brand uses inherited Workspace Google Drive connection | Explicit Brand delegation and root policy are required |
| BA-AC-050 | Activity requires confidential customer files | File capability inherits restricted sharing, retention, and access policies |
| BA-AC-051 | User edits billing MRR | Commercial-account profile changes; activity packs and Commerce authority do not change |
| BA-AC-052 | User edits business inventory semantics | New Business Operating Profile revision triggers impact preview and recompilation |
| BA-AC-053 | Agent sees free-text prompt claiming another activity | Governed active profile wins; agent cannot change activity or authority from prompt text |
| BA-AC-054 | No active profile exists and agent performs discovery | Agent may propose candidates and questions but not activate providers or writes |
| BA-AC-055 | Effective snapshot is created | Snapshot includes Tenant, Workspace, Brand, activity, pack, policy, authority, connection, adapter, catalog, and Blueprint revisions |
| BA-AC-056 | Snapshot evidence is inspected | No credential, signed URL, raw provider payload, private file content, or PII is present |
| BA-AC-057 | Profile conflict is resolved by approval | New approved revision is generated; conflict is not silently mutated in place |
| BA-AC-058 | Parent policy is revoked | Descendant snapshots are invalidated through authority epoch and invalidation events |
| BA-AC-059 | Two resolution nodes process the same version vector | Canonical effective profile and context hash are identical |
| BA-AC-060 | Cache key omits Brand or revision | Contract test fails and runtime implementation is rejected |
| BA-AC-061 | Legacy Tenant has `industry` and `verticals_json` only | Migration creates draft candidates and requests confirmation; no default Brand is inferred |
| BA-AC-062 | Existing `/connect` client sends old payload | Payload remains accepted and maps to candidate evidence without breaking onboarding |
| BA-AC-063 | Current commercial profile route is called | It continues to return customer commercial metadata during migration |
| BA-AC-064 | Business Operating Profile route is called | It uses separate permissions, revisions, schema, and lifecycle |
| BA-AC-065 | Brand activity is suspended | Consequential profile-dependent execution blocks while historical projections remain auditable |
| BA-AC-066 | Secondary activity is removed | Only capabilities whose remaining predicates no longer match are removed; impact is shown |
| BA-AC-067 | Cross-cutting multi-branch pack is added | Location, inventory, reporting, and reconciliation requirements are composed dynamically |
| BA-AC-068 | Market/country changes | Tax, currency, consent, localization, payment, shipping, and regulatory packs are reevaluated |
| BA-AC-069 | Profile resolution exceeds latency SLO | Degraded alert is raised; unsafe fallback to unversioned defaults is forbidden |
| BA-AC-070 | Two-Brand pilot completes | Cross-Brand isolation, dynamic recommendations, inheritance lineage, rollback, and stale rejection are evidenced in one report |
