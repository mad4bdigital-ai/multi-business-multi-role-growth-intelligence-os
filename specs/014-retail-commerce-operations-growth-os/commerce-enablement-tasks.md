# Commerce Enablement and WordPress/WooCommerce Implementation Tasks

## Phase CE-0 — Contract and terminology normalization

- [ ] Register `commerce-capability-catalog.schema.json`.
- [ ] Register `wordpress-woocommerce-adapter.schema.json`.
- [ ] Add `woocommerce` to supported Commerce Adapter backend/provider modes.
- [ ] Add canonical site and WooCommerce domain keys.
- [ ] Require Brand and Brand Site Profile revisions in every site/store operation.
- [ ] Add stable errors for missing Brand site, ambiguous site, missing exact connection, unsupported plugin, bridge required, and maturity mismatch.
- [ ] Add contract tests proving inventory-only capability cannot claim apply support.

## Phase CE-1 — Capability Catalog foundation

- [ ] Add SQL tables for capability definitions, versions, implementations, requirements, dependencies, runbooks, and acceptance suites.
- [ ] Add unique keys by capability key and version.
- [ ] Add implementation maturity and availability states.
- [ ] Add capability-family taxonomy and bilingual labels.
- [ ] Add provider/plugin/localization requirements.
- [ ] Add capability deprecation and retirement rules.
- [ ] Add Resource API read projections for authorized catalog browsing.
- [ ] Add platform-admin mutation path with governance and readback.

## Phase CE-2 — Existing implementation census

- [ ] Inventory WordPress phases A–P and their exported functions.
- [ ] Register each phase as one or more capability implementations.
- [ ] Classify each implementation as inventory-only, dry-run-ready, apply-supported, or certified.
- [ ] Link tests, contracts, runtime modules, actions, workflows, and runbooks.
- [ ] Inventory WordPress blog publishing, credential intake, CMS grants, resource grants, and connector execution.
- [ ] Inventory existing hosting, upload, Drive, analytics, security, backup, and release tools.
- [ ] Detect duplicate or overlapping implementations and select canonical paths.
- [ ] Block unsupported capability claims in CI.

## Phase CE-3 — Solution Blueprint registry

- [ ] Add Blueprint registry and versioning.
- [ ] Add domain-authority matrix rows.
- [ ] Add required/optional/incompatible capabilities.
- [ ] Add required connection families and adapter certifications.
- [ ] Add workflow templates, launch gates, runbooks, and exit strategy.
- [ ] Seed Platform Native, ERPNext, WooCommerce Standard, Woo Governed Bridge, Woo+ERP, Headless Woo, WordPress Content + External Commerce, Existing Store Takeover, and Lead Commerce blueprints.
- [ ] Add Blueprint compatibility evaluator.
- [ ] Add deterministic scoring with reason codes.
- [ ] Add cross-Brand isolation tests.

## Phase CE-4 — Brand Commerce Discovery service

- [ ] Add discovery session and result ledgers.
- [ ] Resolve exact Brand, Brand profile, site profiles, domain authorities, connections, and grants.
- [ ] Collect business-goal inputs.
- [ ] Run bounded provider and site probes.
- [ ] Produce capability assessments, blockers, risks, and evidence.
- [ ] Score Blueprint alternatives.
- [ ] Detect stale results after Brand/site/connection/plugin revisions.
- [ ] Generate dependency-ordered gap plan.
- [ ] Generate durable implementation plan after user selection.

## Phase CE-5 — Brand Site Profile

- [ ] Add Brand Site Profile and site-role tables.
- [ ] Bind canonical hostname and governed frontend surface.
- [ ] Bind exact WordPress, WooCommerce, hosting, CDN, DNS, security, analytics, and file connections.
- [ ] Add profile revision and context hash.
- [ ] Add staging/development/production relationships.
- [ ] Add site lifecycle and degradation states.
- [ ] Migrate legacy Brand domain/site settings without default inference.
- [ ] Add two-Brand same-Workspace denial tests.

## Phase CE-6 — WordPress lifecycle capability adapters

- [ ] Wrap phases A–P behind application services and capability implementations.
- [ ] Separate assessment, migration/change, and continuous-control modes.
- [ ] Preserve existing phase gates and safe-candidate logic.
- [ ] Move SQL-authoritative operation state and evidence out of Sheet-primary paths.
- [ ] Preserve Sheets import/export/mirror compatibility.
- [ ] Add exact Brand Site Profile and connection resolution.
- [ ] Replace fuzzy `LIKE` connected-system selection.
- [ ] Remove direct reliance on raw legacy Brand credential fields.
- [ ] Preserve credential-intake recovery.
- [ ] Preserve CMS site and resource grants.
- [ ] Add per-phase scheduler policies for continuous controls.

## Phase CE-7 — WordPress capability packs

- [ ] Content Foundation pack.
- [ ] Builder and Theme Assets pack.
- [ ] Site Configuration pack.
- [ ] Forms and Integrations pack.
- [ ] Media and Attachments pack.
- [ ] Users, Roles, and Auth pack.
- [ ] SEO and Redirects pack.
- [ ] Analytics and Consent pack.
- [ ] Performance pack.
- [ ] Security pack.
- [ ] Observability pack.
- [ ] Backup and Recovery pack.
- [ ] Release and Rollback pack.
- [ ] Data Integrity pack.
- [ ] QA and Acceptance pack.
- [ ] Production Cutover pack.

## Phase CE-8 — WooCommerce discovery adapter

- [ ] Resolve Woo exact Brand Store connection.
- [ ] Add REST authentication through governed credentials.
- [ ] Read WordPress, WooCommerce, PHP, and HPOS versions.
- [ ] Read store settings, currency, taxes, checkout, inventory, and account configuration.
- [ ] Inventory products, variations, categories, attributes, orders, customers, coupons, refunds, webhooks, shipping zones, and system status.
- [ ] Inventory plugins and scheduled-action health.
- [ ] Normalize without raw customer/payment/plugin secrets.
- [ ] Add read-only certification suite.

## Phase CE-9 — WooCommerce standard REST adapter

- [ ] Add canonical ports for product and variation read/write.
- [ ] Add stock read/write with expected limitations.
- [ ] Add order/customer/coupon/refund reads.
- [ ] Add governed product writes with idempotency ledger.
- [ ] Add order and refund mutation only after high-risk capability review.
- [ ] Add provider error normalization.
- [ ] Add unknown-outcome readback.
- [ ] Add rate-limit and bounded retry policy.
- [ ] Add exact external entity bindings.
- [ ] Certify standard mode as sole writer only for assigned domains.

## Phase CE-10 — Provider Webhook Inbox for WooCommerce

- [ ] Add Woo signature verification plugin.
- [ ] Add event topic allowlist.
- [ ] Add replay/deduplication logic.
- [ ] Persist bounded Inbox envelopes.
- [ ] Normalize product, order, customer, coupon, and bridge events.
- [ ] Add async processing and dead-letter.
- [ ] Add webhook health and delivery reconciliation.
- [ ] Preserve original Brand and Store context.

## Phase CE-11 — Governed WooCommerce Bridge plugin

- [ ] Create versioned WordPress plugin package in a separate implementation PR.
- [ ] Implement readiness and capability endpoints.
- [ ] Implement request signing, timestamp, nonce, and replay protection.
- [ ] Implement idempotency and operation ledgers.
- [ ] Implement reservation/release/commit APIs.
- [ ] Implement expected-version and exact product/variation/unique-unit mapping.
- [ ] Document database transaction/locking boundary.
- [ ] Implement operation/resource readback.
- [ ] Implement bounded event delivery and retry inspection.
- [ ] Implement maintenance and degraded states.
- [ ] Add WordPress/Woo/PHP/HPOS compatibility matrix.
- [ ] Add plugin uninstall and safe-disable semantics.

## Phase CE-12 — WooCommerce extension profiles

- [ ] Define extension compatibility registry.
- [ ] Add allowlist/profile/unknown classifications.
- [ ] Add subscriptions profile.
- [ ] Add bookings profile.
- [ ] Add memberships profile.
- [ ] Add bundles/composites profile.
- [ ] Add multilingual and multi-currency profiles.
- [ ] Add multi-vendor and multi-location profiles.
- [ ] Add payment and shipping extension profiles.
- [ ] Block Blueprint activation on conflicting or unknown high-risk extensions.

## Phase CE-13 — WooCommerce + ERPNext topologies

- [ ] Implement Variant A authority matrix and downstream ERP mirror.
- [ ] Implement Variant B ERP authority and Woo projection.
- [ ] Add bridge-mediated checkout/order flow.
- [ ] Add drift detection for direct Woo writes.
- [ ] Add product, stock, order, customer, payment, and fulfillment mapping profiles.
- [ ] Add end-to-end unknown-outcome tests.
- [ ] Add cross-channel unique-item concurrency tests.

## Phase CE-14 — Enablement Center frontend

- [ ] Register governed Brand surface.
- [ ] Add Goal and Blueprint step.
- [ ] Add capability map and maturity indicators.
- [ ] Add alternatives and tradeoff view.
- [ ] Add readiness and dependency-ordered gap plan.
- [ ] Add connection and authorization setup flows.
- [ ] Add durable implementation plan and progress.
- [ ] Add evidence and acceptance view.
- [ ] Add Arabic RTL, responsive, accessibility, and mobile support.

## Phase CE-15 — Site and Commerce Operations Cockpit

- [ ] Add storefront and checkout health.
- [ ] Add orders, payments, stock, refunds, and fulfillment health.
- [ ] Add webhook Inbox and Outbox health.
- [ ] Add Woo scheduled-action backlog.
- [ ] Add WordPress errors, performance, security, backup, and release health.
- [ ] Add analytics/consent/feed coverage.
- [ ] Add incidents, approvals, and reconciliation work queues.
- [ ] Add recommended actions with authority, risk, rollback, and readback.
- [ ] Add role-specific dashboards.

## Phase CE-16 — Agent and workflow integration

- [ ] Expose read-only capability discovery tools.
- [ ] Expose Blueprint comparison tool.
- [ ] Expose plan-generation tool.
- [ ] Expose operational-health summarization tool.
- [ ] Route mutations through the same application services as UI.
- [ ] Require capability envelopes and exact Brand context.
- [ ] Prevent provider IDs and plugin names from granting authority.
- [ ] Add no-secret and bounded-evidence tests.

## Phase CE-17 — Commercial plans and usage

- [ ] Map capabilities and Blueprints to plans without bypassing authority.
- [ ] Add usage dimensions for probes, syncs, storage, monitoring, and managed operations.
- [ ] Add optional managed-service assistance levels.
- [ ] Add customer-visible limits and overage behavior.
- [ ] Add commercial-profile recommendation inputs.

## Phase CE-18 — Certification and pilot

- [ ] Certify one WordPress content site in read/write Sandbox.
- [ ] Certify one WooCommerce Standard Sandbox.
- [ ] Certify one WooCommerce Governed Bridge Sandbox.
- [ ] Test two Brands inside one Workspace.
- [ ] Test exact connection and no fallback.
- [ ] Test plugin conflict and unsupported version.
- [ ] Test backup restore and release rollback.
- [ ] Test checkout/order/payment/webhook unknown outcome.
- [ ] Test operations cockpit alerts and reconciliation.
- [ ] Record production-readiness constraints.

## Phase CE-19 — Rollout and closeout

- [ ] Start with discovery/read-only mode.
- [ ] Enable low-risk WordPress operations.
- [ ] Enable standard Woo reads and selected writes.
- [ ] Enable bridge mode only after certification.
- [ ] Perform post-launch audit.
- [ ] Confirm capability catalog matches deployed runtime.
- [ ] Confirm Blueprints match actual authority bindings.
- [ ] Retire legacy fuzzy and secret-bearing paths.
- [ ] Update Spec Kit completion evidence without claiming unverified production behavior.
