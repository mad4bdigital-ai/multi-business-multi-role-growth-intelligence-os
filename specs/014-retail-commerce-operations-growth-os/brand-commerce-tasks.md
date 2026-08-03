# Brand-Scoped Commerce Implementation Tasks

## Phase BC-0 — Contract normalization

- [ ] Replace Workspace-only commerce authority wording with Brand-scoped authority in implementation contracts.
- [ ] Require `brand_ref` in all commerce commands, events, aggregates, jobs, approvals, evidence, and provider deliveries.
- [ ] Register `brand-commerce-context.schema.json` in contract validation.
- [ ] Add stable Brand context and connection error codes.
- [ ] Add contract tests proving null Brand is rejected.

## Phase BC-1 — Brand Commerce Profile

- [ ] Add governed migration for `brand_commerce_profiles`.
- [ ] Add lifecycle states and revision column.
- [ ] Add readiness projection for currency, locale, timezone, pricing, returns, consent, tax, and file profile.
- [ ] Add capability-gated create/update/activate/suspend operations.
- [ ] Add same-cycle readback and bounded audit evidence.
- [ ] Add stale revision conflict tests.

## Phase BC-2 — Brand authority and connections

- [ ] Add `brand_domain_authority_bindings` with uniqueness per Brand/domain/effective revision.
- [ ] Add `brand_connection_bindings` with `brand_owned`, `workspace_delegated`, and `platform_managed` modes.
- [ ] Require explicit delegation for Workspace-owned connections.
- [ ] Extend connection ownership resolver to return exact Brand candidate evidence.
- [ ] Block personal-connection inheritance through Workspace membership.
- [ ] Validate adapter certification before authoritative activation.
- [ ] Add zero/multiple binding denial tests.
- [ ] Add revocation and expiry tests.

## Phase BC-3 — Context Kernel integration

- [ ] Extend candidate graph with Brand Commerce Profile, channel, location, terminal, and domain authority.
- [ ] Resolve Brand from governed hostname for public storefronts.
- [ ] Resolve Brand from terminal/shift for POS.
- [ ] Resolve Brand from task/resource for Photography, Inventory, Customer Service, and Marketing.
- [ ] Require explicit authorized Brand selection when no deterministic surface binding exists.
- [ ] Build Brand revision vector and context hash.
- [ ] Reject stale profile, channel, location, authority, or connection revisions before credential loading.
- [ ] Add telemetry that records bounded Brand refs without secrets or customer data.

## Phase BC-4 — Brand channels and locations

- [ ] Add Brand storefront hostname bindings.
- [ ] Add Brand channel, catalog, Live Commerce, and application-surface bindings.
- [ ] Add Brand location, warehouse, pickup, terminal, and device bindings.
- [ ] Support shared physical locations with isolated Brand inventory and settlement.
- [ ] Add deterministic conflict for mismatched channel/location/terminal.
- [ ] Add admin read projections for readiness and ambiguity repair.

## Phase BC-5 — Commerce data hardening

- [ ] Add non-null `brand_id` to all new commerce domain tables.
- [ ] Include Brand in unique keys, foreign keys, idempotency scopes, and aggregate identities.
- [ ] Include Brand in cache keys, search projections, Outbox aggregate keys, and Inbox processing keys.
- [ ] Add cross-Brand resource ownership predicates in repositories.
- [ ] Add same external ID under two Brands tests.
- [ ] Add cross-Brand reservation, order, payment, return, and publication denial tests.

## Phase BC-6 — Brand provider bindings

- [ ] Add Brand-specific ERP/company mapping.
- [ ] Add Brand payment provider and merchant-account binding.
- [ ] Add Brand shipping provider/account and policy binding.
- [ ] Add Google Merchant, Meta, TikTok, marketplace, and WhatsApp Brand bindings.
- [ ] Add GA4, GTM, pixels, consent, server-event, and attribution Brand bindings.
- [ ] Prevent request bodies from selecting provider account IDs as authority.
- [ ] Add provider readback preserving original Brand context.
- [ ] Add shared-provider-account mapping and attribution tests.

## Phase BC-7 — Brand File Profile and Google Drive

- [ ] Add `brand_file_profiles` and lifecycle/revision fields.
- [ ] Bind one Brand file authority connection through Brand ownership or explicit Workspace delegation.
- [ ] Map root, product media, campaign, supplier, customer-service, evidence, and archive folders.
- [ ] Enforce root containment for create/upload/rename/move/copy/trash/restore/share operations.
- [ ] Add Shared Drive support and Brand root readiness.
- [ ] Include Brand in file operation ledger, idempotency, manifest, and readback evidence.
- [ ] Block personal Drive fallback for shared Brand commerce assets.
- [ ] Add cross-Brand file search and move/copy denial tests.
- [ ] Implement the demo-archive reference workflow under a Brand root.

## Phase BC-8 — UX and agent tools

- [ ] Add visible Brand switcher filtered by authority.
- [ ] Pin Brand in header, POS, camera, inventory, marketing, customer-service, and file surfaces.
- [ ] Warn and block when a resource belongs to another Brand.
- [ ] Require confirmation when changing Brand with unsaved work.
- [ ] Make public storefront Brand implicit from hostname, not a shopper-controlled selector.
- [ ] Expose Brand readiness and missing connection diagnostics to authorized admins.
- [ ] Ensure agents use Brand-scoped application services rather than provider/folder tools directly.
- [ ] Add Arabic RTL and mobile tests for Brand selection and file operations.

## Phase BC-9 — Migration and rollout

- [ ] Inventory all Workspace-only commerce, analytics, catalog, connection, and Drive settings.
- [ ] Classify records as unambiguous, ambiguous, orphaned, or shared.
- [ ] Create governed mapping plan from legacy records to Brand profiles.
- [ ] Prohibit automatic default-Brand inference for writes.
- [ ] Add dry-run collision report for SKUs, external IDs, catalog IDs, provider accounts, and file roots.
- [ ] Pilot at least two Brands in one Workspace.
- [ ] Run all `brand-commerce-acceptance.md` tests.
- [ ] Enable Brand-required writes behind a fail-closed feature gate.
- [ ] Retire Workspace-only write paths after verified readback and rollback window.

## Phase BC-10 — Operational verification

- [ ] Add dashboards for Brand context failures, authority ambiguity, stale bindings, and cross-Brand denials.
- [ ] Add reconciliation for Brand/domain/connection mapping drift.
- [ ] Add alerting for inactive Brand receiving provider events.
- [ ] Add SLOs for Brand context resolution and provider dispatch.
- [ ] Prove no secret, signed URL, raw provider payload, or private file content enters logs/evidence.
- [ ] Perform post-merge audit and track residual legacy paths.
