# Commerce Enablement and WordPress/WooCommerce Review Checklist

## Capability discovery

- [ ] Commerce capabilities are visible as user-facing outcomes, not only technical actions.
- [ ] Every capability declares availability and implementation maturity separately.
- [ ] Inventory-only implementations cannot claim apply or production certification.
- [ ] Capability requirements include domains, connections, grants, plugins, roles, policy, and localization.
- [ ] Capability evidence becomes stale after relevant revision changes.
- [ ] Cross-Brand capability results are isolated.

## Solution Blueprints

- [ ] Every Blueprint has a versioned domain-authority matrix.
- [ ] Every Blueprint lists required and optional capabilities.
- [ ] Every Blueprint lists required connections and certifications.
- [ ] Every Blueprint has launch gates and steady-state runbooks.
- [ ] Every Blueprint has an exit/migration strategy.
- [ ] Recommendations are deterministic and evidence-backed before AI explanation.
- [ ] Alternative compatible Blueprints and tradeoffs are shown.
- [ ] Selection does not itself grant authority or activate providers.

## Existing platform reuse

- [ ] WordPress phases A–P are registered as canonical capability implementations.
- [ ] Existing WordPress blog publishing and credential recovery are reused.
- [ ] CMS site grants, resource grants, capability envelopes, audit, and evidence are reused.
- [ ] Context Kernel, plans, Outbox, Inbox, workers, and frontend governance are reused.
- [ ] Duplicate site lifecycle frameworks are not introduced.
- [ ] Legacy Sheets are not retained as primary runtime authority.

## Brand Site Profile

- [ ] Every site belongs to one exact Brand.
- [ ] Canonical hostname and site role are explicit.
- [ ] Staging, development, and production relationships are explicit.
- [ ] WordPress, WooCommerce, hosting, DNS/CDN, security, analytics, and file connections are exact bindings.
- [ ] Site and connection revisions are required for mutations.
- [ ] Fuzzy target or `LIKE` connection selection is forbidden for consequential writes.
- [ ] Raw legacy Brand credential fields are not runtime secret authority.

## WordPress lifecycle packs

- [ ] Phase A content and reference repair are covered.
- [ ] Phase B builders and dependencies are covered.
- [ ] Phase C settings reconciliation is covered.
- [ ] Phase D forms and integrations are covered.
- [ ] Phase E media and linkage are covered.
- [ ] Phase F users/roles/auth is covered.
- [ ] Phase G SEO/redirects is covered.
- [ ] Phase H analytics/consent is covered.
- [ ] Phase I performance is covered.
- [ ] Phase J security is covered.
- [ ] Phase K observability is covered.
- [ ] Phase L backup/recovery is covered.
- [ ] Phase M release/rollback is covered.
- [ ] Phase N data integrity is covered.
- [ ] Phase O QA/acceptance is covered.
- [ ] Phase P production cutover is covered.
- [ ] Assessment, change, and continuous-control modes are separated.

## WooCommerce discovery and standard adapter

- [ ] WooCommerce readiness is established by bounded probes, not plugin-name inference.
- [ ] WordPress, WooCommerce, PHP, and HPOS versions are recorded.
- [ ] REST permissions and exact Store connection are recorded.
- [ ] Product, variation, stock, order, customer, coupon, refund, webhook, shipping, and system-status capabilities are explicit.
- [ ] Provider extension fields use mapping profiles.
- [ ] Customer/payment secrets and raw payloads remain outside evidence.
- [ ] Standard Woo mode does not claim atomic cross-channel unique-item reservation.
- [ ] Unknown outcomes enter readback before replay.

## Governed bridge

- [ ] Bridge requests are signed and replay-protected.
- [ ] Brand and Store identity are pinned.
- [ ] Idempotency and operation ledgers exist.
- [ ] Reservation/release/commit use expected version.
- [ ] Database transaction or lock boundary is documented and tested.
- [ ] Operation and resource readback exist.
- [ ] Bridge event delivery is bounded, inspectable, and retryable.
- [ ] Safe disable/uninstall behavior is documented.
- [ ] Version compatibility and certification evidence are recorded.

## WooCommerce + ERPNext

- [ ] Variant A and Variant B authority matrices are distinct.
- [ ] Woo and ERP cannot both write the same stock/order domain.
- [ ] Projection mode blocks or detects direct Woo writes.
- [ ] Checkout obtains authoritative price and reservation.
- [ ] Payment attaches to one canonical external order.
- [ ] Product, order, payment, and fulfillment mappings are versioned.
- [ ] Unknown outcomes and drift are reconciled.

## Webhooks and operations

- [ ] Woo webhooks enter Provider Webhook Inbox.
- [ ] Signature, replay, deduplication, and topic allowlist are enforced.
- [ ] Scheduled-action backlog and webhook delivery health are monitored.
- [ ] Site Operations Cockpit covers orders, payments, stock, refunds, feeds, analytics, performance, security, backups, and releases.
- [ ] Recommended actions show impact, authority, connection, approval, rollback, and readback.
- [ ] Launch includes backup, restore test, QA, canary, monitoring, and reconciliation.

## UX and agents

- [ ] Enablement Center is Brand-scoped, Arabic RTL, responsive, and accessible.
- [ ] Owner, marketer, ecommerce, operations, site-admin, and agency views are role-specific.
- [ ] Agents use the same application services as UI.
- [ ] Agent recommendations do not mutate providers or authority.
- [ ] High-risk actions require explicit capability and approval.

## Proof boundary

- [ ] Documentation is not treated as runtime implementation.
- [ ] Mock or UI parity is not production evidence.
- [ ] Adapter certification is tied to exact implementation and provider versions.
- [ ] Production readiness requires sandbox/staging behavioral evidence.
- [ ] No production, provider, DNS, WordPress, WooCommerce, payment, or Google Drive mutation occurred in the specification PR.
