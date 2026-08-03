# External Integration and Workspace File Fabric Review Gate

## Architecture

- [ ] Single writer per bounded domain is approved.
- [ ] Domain keys and scope hierarchy are approved.
- [ ] Canonical ports do not expose provider-specific business models.
- [ ] External entity mappings cannot grant authority.
- [ ] Outbox and Webhook Inbox responsibilities are distinct.
- [ ] Unknown provider outcomes block blind replay.
- [ ] BullMQ remains transport rather than business state authority.

## Context and connection ownership

- [ ] User identity derives from User JWT.
- [ ] Live membership and resource authority are checked.
- [ ] Personal, Company Workspace, and Brand owner scopes are preserved.
- [ ] Personal connections cannot be borrowed by another member.
- [ ] Consequential writes cannot silently fall back to a broader connection.
- [ ] Equal-ranked connections fail as ambiguous.
- [ ] Connection and authority revisions invalidate stale plans.

## Google authorization

- [ ] Google identity and Drive consent are separate.
- [ ] OAuth state is signed, expiring, nonce-bound, context-bound, and single-use.
- [ ] Reconnect verifies the same provider account and expected revision.
- [ ] Minimum scopes are selected from capability policy.
- [ ] Credentials materialize only after exact context and plan resolution.
- [ ] Tokens, signed URLs, and raw authorization payloads are excluded from evidence.

## Workspace files

- [ ] Canonical file/folder/revision/permission model is approved.
- [ ] List and search are bounded and permission filtered.
- [ ] Binary reads do not coerce arbitrary bytes to text.
- [ ] Large files use resumable upload.
- [ ] Create, rename, move, copy, trash, and restore use idempotency and readback.
- [ ] Permanent delete is a separate step-up capability.
- [ ] Retention policy cannot be bypassed through provider deletion.
- [ ] Shared Drive semantics and inherited permissions are covered.
- [ ] Revisions and change cursors are connection/space scoped.
- [ ] Search index results revalidate live authority.

## Sharing and permissions

- [ ] Public or `anyone` sharing is denied by default.
- [ ] External-domain sharing is separately governed.
- [ ] Ownership transfer is independently authorized.
- [ ] Permission widening may create an approval hold.
- [ ] Permission readback confirms the effective provider state.
- [ ] Logs and projections avoid unnecessary email and invitation disclosure.

## Adapter certification

- [ ] Adapter/version/provider API/mapping identities are immutable in a certificate.
- [ ] Uncertified adapters cannot become authoritative writers.
- [ ] Cross-tenant, cross-user, and cross-Brand denial tests exist.
- [ ] Idempotency, concurrency, timeout, retry, and readback tests exist.
- [ ] Signature, replay, rate-limit, and Dead Letter tests exist.
- [ ] Google Drive reference batch case is included.
- [ ] Certificate constraints are enforced at runtime.

## User experience and operations

- [ ] Arabic RTL responsive file workspace is designed.
- [ ] Mobile upload and progress behavior are covered.
- [ ] Batch partial failure is visible per item.
- [ ] Resume does not repeat completed writes.
- [ ] Manifests include counts, parents, types, sizes, and checksums when available.
- [ ] Queued, provider-accepted, verified, failed, and unknown states are distinct.
- [ ] Provider outage degraded behavior is fail-closed for writes.
- [ ] SLOs, alerts, runbooks, retention, and disaster recovery are defined.

## Safety

- [ ] No runtime mutation is present in this specification PR.
- [ ] No database migration is applied.
- [ ] No provider or Google Drive write is executed.
- [ ] No credentials or secrets are included.
- [ ] Mock or UI parity is not represented as production completion evidence.
