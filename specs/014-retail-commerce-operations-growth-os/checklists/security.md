# Security Checklist

## Identity and isolation

- [x] Authentication and authorization are separate gates.
- [x] Caller-supplied tenant/workspace/brand/location/connection values cannot override principal context.
- [x] Default access is deny.
- [x] Exact target resource and backend binding are required.
- [x] Cross-tenant, wrong-brand, wrong-location, wrong-terminal, and wrong-connection tests are required.
- [x] Role labels do not independently grant authority.

## Mutations

- [x] Unsafe mutations require idempotency.
- [x] Conflict-sensitive aggregates require expected version.
- [x] Unique-item reservations are atomic.
- [x] Unknown payment/provider outcomes are reconciled before replay.
- [x] High-risk discounts, refunds, overrides, claims, and spend are approval governed.
- [x] Automatic consistency controls do not depend on human approval.

## Credentials and providers

- [x] Credentials resolve through governed connections.
- [x] Commerce tables store connection references only.
- [x] Webhooks require signature, freshness, audience, and resource binding.
- [x] Provider errors and readback are normalized.
- [x] Provider capability and enablement are separate from catalog visibility.
- [x] No provider write is authorized by this specification.

## Privacy

- [x] Customer PII is excluded from analytics, Outbox, audit, and catalog payloads.
- [x] Consent is resolved before analytics/ad routing.
- [x] Payment instrument data is outside platform storage.
- [x] AI prompts and results use bounded safe product evidence.
- [x] Logs and evidence reject secret-like keys and values.
- [x] Retention and anonymization are required.

## Media

- [x] Upload sessions are scoped and expiring.
- [x] MIME, size, checksum, image decoder, and safety controls are required.
- [x] Raw media is not embedded in JSON event/audit payloads.
- [x] Public access is controlled by publication/storage policy.
- [x] AI content cannot bypass sensitive-field review.

## Offline POS

- [x] Unique-item offline sale requires an allocation lease.
- [x] Lease is device/branch/resource scoped and expiring.
- [x] Reconnect reconciliation is required.
- [x] A disconnected client cannot fabricate final authority.

## Required implementation evidence

- [ ] Threat model reviewed.
- [ ] Secret scanner and no-secret fixtures pass.
- [ ] Cross-tenant and confused-deputy tests pass.
- [ ] Webhook replay/signature tests pass.
- [ ] Payment duplicate and unknown-outcome tests pass.
- [ ] Offline lease tamper/expiry tests pass.
- [ ] PII rejection tests pass.
- [ ] Dependency and image-processing security review passes.
- [ ] Production CSP, CORS, cookies, and browser security headers pass.
- [ ] Vulnerability and penetration review is complete for payment/POS/public surfaces.
