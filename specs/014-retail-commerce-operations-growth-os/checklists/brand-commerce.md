# Brand-Scoped Commerce Review Checklist

## Context and authority

- [ ] Brand is mandatory for every commerce operation.
- [ ] Workspace is documented as an administrative container, not sufficient commerce authority.
- [ ] One writer per Brand/domain is enforced.
- [ ] Zero and multiple Brand authority bindings fail closed.
- [ ] Caller Brand/provider/folder IDs remain constraints only.
- [ ] Brand revision and context hash are required for mutations.
- [ ] Credential resolution happens after Brand and connection binding validation.

## Membership and isolation

- [ ] Workspace membership alone does not grant all Brand access.
- [ ] Brand membership/resource authority is checked.
- [ ] Cross-Brand products, Stock Units, orders, customers, files, and campaigns are denied.
- [ ] Idempotency, cache, search, Outbox, Inbox, and aggregate keys preserve Brand.
- [ ] Revoked Brand membership or binding blocks subsequent execution.

## Connections and providers

- [ ] Brand-owned connections are supported.
- [ ] Workspace-owned connections require explicit Brand delegation.
- [ ] Personal connections never become shared through Workspace membership.
- [ ] No silent Brand-to-Workspace, Brand-to-Brand, or Brand-to-personal fallback exists.
- [ ] ERP, payments, shipping, catalogs, WhatsApp, analytics, and ads bindings are Brand-scoped.
- [ ] Provider account IDs from requests do not grant routing authority.
- [ ] Unknown outcome readback preserves the original Brand context.

## Channels, locations, and surfaces

- [ ] Public hostname resolves exactly one Brand.
- [ ] POS terminal and shift resolve one Brand.
- [ ] Live Commerce session resolves one Brand.
- [ ] Branch/warehouse/pickup bindings are Brand-aware.
- [ ] Shared physical locations preserve separate Brand stock and settlement.
- [ ] Internal UI displays and pins the current Brand.
- [ ] Brand switching is permission-filtered and safe with unsaved work.

## Commerce data

- [ ] New commerce tables require non-null Brand identity.
- [ ] Unique constraints include Brand where necessary.
- [ ] Reservation and order locks cannot collide across Brands.
- [ ] Customer, supplier, pricing, return, and consent records preserve Brand.
- [ ] Measurement, attribution, and contribution facts preserve Brand.
- [ ] Catalog publications route to Brand-specific destinations.

## Google Drive and files

- [ ] Every commerce Brand has a Brand File Profile before shared file writes.
- [ ] Brand Drive connection is Brand-owned or explicitly delegated.
- [ ] Shared commerce assets do not fall back to personal Drive.
- [ ] Root containment is enforced for create/upload/move/copy/share/delete.
- [ ] Product, campaign, supplier, service, evidence, and archive roots are mapped.
- [ ] Search filters Brand before content retrieval.
- [ ] Cross-Brand file transfer requires separate capability and evidence.
- [ ] Batch resume does not duplicate completed writes.
- [ ] Manifest and readback include Brand binding evidence.

## Migration and testing

- [ ] Workspace-only legacy configuration is classified as unbound.
- [ ] Default-Brand inference is prohibited for production writes.
- [ ] Ambiguous mappings enter a repair queue.
- [ ] Pilot contains at least two Brands in one Workspace.
- [ ] Negative cross-Brand tests are included.
- [ ] `brand-commerce-acceptance.md` is completed before production activation.
- [ ] No secrets, signed URLs, raw provider payloads, or private file content appear in evidence.
