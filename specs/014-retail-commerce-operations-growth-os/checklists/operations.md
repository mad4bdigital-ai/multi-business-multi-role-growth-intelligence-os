# Operations and Release Checklist

## Database and migrations

- [ ] All commerce tables have tenant/workspace keys, indexes, owners, lifecycle, retention, backup, and sensitivity classification.
- [ ] Migrations are additive, dry-run verified, and applied only through governed migration authority.
- [ ] Collations, identifier lengths, foreign keys, and unique constraints are reviewed.
- [ ] Backfill is chunked and restartable.
- [ ] Rollback or feature-disable path is proven.
- [ ] Production migration ledger matches deployed code.

## Runtime and workers

- [ ] SQL remains authority when Redis/BullMQ is unavailable.
- [ ] Worker claims, leases, concurrency, retry, jitter, and dead-letter are configured.
- [ ] Reservation expiry lag is monitored.
- [ ] Payment unknown-outcome age is monitored.
- [ ] Outbox lag and consumer health are monitored.
- [ ] Media queue age and failure rate are monitored.
- [ ] Catalog rejection and reconciliation lag are monitored.
- [ ] Measurement rejection/dedupe/delivery rates are monitored.
- [ ] Workers stop safely when disabled and do not overlap incompatible cycles.

## Provider readiness

- [ ] ERP adapter version and contract certification are current.
- [ ] Payment webhook and inspection paths are verified in sandbox.
- [ ] Shipping adapter degraded behavior is documented.
- [ ] Catalog accounts, mappings, quotas, and issue readback are verified.
- [ ] GA/ads properties and consent bindings are verified.
- [ ] Credentials are resolved through governed bindings without payload exposure.
- [ ] Provider rate limits and circuit breakers are configured.

## Frontend and devices

- [ ] RetailOS is registered in governed surface policy and generated catalogs.
- [ ] Arabic RTL and English pass viewport and accessibility matrices.
- [ ] POS terminal/device registration and shift lifecycle are verified.
- [ ] Offline allocation leases and reconnect reconciliation are verified.
- [ ] Production mode hides/disables QA Sandbox controls.
- [ ] No provider/service credentials are shipped to the browser.
- [ ] Error, pending, unknown, blocked, and recovered states are truthful.

## Data reconciliation

- [ ] Inventory totals and unique Stock Unit states reconcile.
- [ ] Active reservation and expiry reconciliation passes.
- [ ] Orders, payments, refunds, and settlements reconcile.
- [ ] ERP projections and platform operation ledgers reconcile.
- [ ] Catalog item/price/availability reconciliation passes.
- [ ] Measurement purchase/refund dedupe reconciliation passes.
- [ ] Ad spend, revenue, refunds, costs, and contribution reconcile.

## Release

- [ ] Required CI checks pass on fresh base/head.
- [ ] OpenAPI/schema/generator parity passes.
- [ ] Unit, integration, concurrency, security, fault-injection, and visual tests pass.
- [ ] Deployment manifest reports expected commit and branch.
- [ ] Production/main parity is confirmed.
- [ ] Controlled same-cycle runtime smoke passes.
- [ ] Rollback/disable is tested.
- [ ] On-call owner, runbooks, dashboards, and support escalation are ready.
- [ ] Unresolved gaps are classified, assigned, and non-blocking or release is stopped.
