# Complete Operation Paths

Each path includes actor, entry, authority, transition, denial, retry, readback, observability, and recovery.

## OP-001 — Reserve a unique Stock Unit

**Actor:** Shopper, Cashier, Live operator, or trusted system client.

**Entry:** `POST /commerce/reservations` with product/Stock Unit, channel, location, TTL, expected version, and idempotency key.

**Authority:** authenticated principal or public session policy; tenant/workspace/brand; exact location/channel; selected commerce backend; reserve capability; product visibility.

**Normal sequence:**

1. Resolve Commerce Context and revision.
2. Validate request schema and idempotency scope.
3. Begin authoritative backend transaction.
4. Lock exact Stock Unit or atomic ERP reservation target.
5. Confirm current state/version and channel eligibility.
6. Create active reservation with expiry.
7. Transition `Available -> Reserved`.
8. Write `commerce.reservation.created.v1` to Outbox in the same transaction.
9. Commit.
10. Return reservation, version, expiry, operation identity, and readback.

**Denial/conflict:**

- wrong tenant/location/channel: 403;
- backend unresolved/ambiguous: 409;
- stale context/version: 409;
- already reserved/sold/quarantined: 409;
- idempotency key with different payload: 409.

**Retry:** same key returns same result. A new key is forbidden until authoritative state is read.

**Readback:** fetch reservation and Stock Unit from authoritative backend after commit.

**Observability:** reservation latency, conflict reason, channel, aggregate ref, safe actor ref, context revision, Outbox ref.

**Recovery:** expiry worker or explicit authorized release. No human approval for normal conflict prevention.

## OP-002 — Expire or release reservation

**Actor:** Reservation expiry worker, checkout failure handler, authorized manager cancellation, or provider reconciliation.

**Entry:** due reservation scan or `DELETE /commerce/reservations/{id}`.

**Normal sequence:**

1. Claim due reservation using SQL/adapter lock.
2. Verify status `active` and expected version.
3. Transition reservation to `expired` or `released`.
4. Transition Stock Unit `Reserved -> Available` if no committed order owns it.
5. Write release and availability events in the same transaction.
6. Commit and propagate catalog/search changes asynchronously.

**Alternate:** if payment is unknown, do not release until reconciliation policy permits.

**Idempotency:** repeated worker claim returns already terminal without changing quantity.

**Readback:** active reservation count and Stock Unit state.

**Recovery:** stuck lease alert and reconciliation job.

## OP-003 — Create online order and reconcile payment

**Actor:** Shopper checkout, payment provider webhook, payment reconciliation worker.

**Entry:** `POST /commerce/orders`, followed by signed provider callback or readback.

**Normal sequence:**

1. Validate active reservation, price snapshot, customer/session, fulfillment, consent, currency, and discount.
2. Create order in `awaiting_payment` idempotently.
3. Create provider payment intent through certified adapter.
4. Store safe provider reference and outcome state.
5. On signed/certified `captured`, atomically commit reservation, transition Stock Unit to Sold, confirm order, and enqueue Outbox events.
6. Return authoritative order readback.

**Failed outcome:** mark payment failed, cancel or retain order by policy, release reservation exactly once.

**Unknown outcome:** mark `unknown`, retain bounded reservation, schedule readback, block blind retry, and return 202/409 classification with operation projection.

**Webhook denial:** invalid signature, timestamp, audience, provider connection, order binding, or duplicate mismatch.

**Recovery:** provider inspection, ledger reconciliation, manual conflict review only if evidence conflicts.

## OP-004 — Submit POS sale

**Actor:** Cashier on registered terminal.

**Entry:** `POST /commerce/pos/sales`.

**Authority:** user membership, cashier capability, branch, terminal/device, shift, backend, payment method, discount threshold.

**Normal sequence:**

1. Resolve terminal and shift.
2. Revalidate prices and stock.
3. Reserve or consume items through authoritative inventory service.
4. Validate discount; create approval hold only above threshold.
5. Record payment and POS sale idempotently.
6. Commit stock/order/invoice and Outbox.
7. Return receipt projection and settlement references.

**Offline unique item:** require valid offline allocation lease. Otherwise park basket and fail finalization.

**Conflict:** reject with current stock state and no partial receipt.

**Recovery:** reconnect reconciliation compares leases, local sale identity, authoritative invoice, and Outbox.

## OP-005 — Receive supplier lot and generate QC work

**Actor:** Inventory operator.

**Entry:** `POST /commerce/supplier-receipts`.

**Normal sequence:**

1. Resolve supplier, location, PO reference, backend, and receiving capability.
2. Validate quantities/cost metadata and duplicate receipt identity.
3. Create receipt and supplier lot.
4. Create variant quantities or Stock Units.
5. Evaluate QC sampling policy.
6. Create workflow plan/tasks for sample inspection.
7. Put affected stock into `Quarantine` or `Pending QC` when required.
8. Commit and enqueue supplier/inventory events.

**Human step:** record sample inspection decision.

**Automatic continuation:** route accepted stock to Available, defects to Quarantine/Damaged/Supplier Return; update derived supplier metrics.

**Recovery:** receipt reversal is a governed compensating operation, not row deletion.

## OP-006 — Product intake, photography, AI draft, and publication

**Actor:** Photographer, Content Reviewer, Worker.

**Entry:** `POST /commerce/product-intakes`.

**Normal sequence:**

1. Resolve product/variant/Stock Unit/lot or create draft identities.
2. Resolve category Shot List and channel policy.
3. Create upload sessions scoped to intake and tenant.
4. Capture media and persist checksum/metadata.
5. When minimum evidence is complete, enqueue media processing automatically.
6. Generate safe derivatives and quality evidence.
7. Enqueue AI extraction and channel draft generation.
8. Store field-level value, confidence, evidence, model/profile versions.
9. Quality Gate evaluates completeness and required human decisions.
10. Reviewer approves/rejects sensitive facts.
11. Approved publication revision is written and provider delta is enqueued.

**Denial:** unsupported MIME, oversized image, duplicate evidence policy, missing required shot, low confidence, missing defect/measurement, stale product/price/stock revision.

**Retry:** workers use pipeline/job idempotency and reuse existing successful stages.

**Readback:** publication and provider issue states; frontend cannot infer success from queued state.

## OP-007 — Catalog delta synchronization

**Actor:** Outbox consumer.

**Entry:** committed product, price, availability, media, or publication event.

**Normal sequence:**

1. Claim Outbox delivery.
2. Resolve active provider connection and publication mapping.
3. Build channel payload from canonical revision.
4. Validate provider-specific schema and policy.
5. Submit with delivery idempotency identity.
6. Inspect provider acknowledgement or item status.
7. Mark delivered, warning, rejected, retry scheduled, or dead letter.

**High-priority rule:** unique-item reservation/sale availability deltas have priority over noncritical content updates.

**Recovery:** periodic full reconciliation compares canonical product set with provider item status and creates repair deliveries.

## OP-008 — Accept and route measurement event

**Actor:** Browser collector, server event producer, POS, provider conversion source.

**Entry:** `POST /commerce/measurement-events`.

**Normal sequence:**

1. Validate event schema/version.
2. Resolve tenant/brand/site/property bindings.
3. Enforce consent and allowed destinations.
4. Reject PII and prohibited keys.
5. Validate item IDs and transaction binding where required.
6. Deduplicate event ID and purchase transaction identity.
7. Persist accepted/rejected/deduplicated classification.
8. Enqueue destination deliveries.
9. Reconcile delivery status asynchronously.

**Alternate:** essential operational event may be retained internally while marketing destinations are suppressed.

**Readback:** destination delivery status, not raw provider response.

## OP-009 — Return, inspection, refund, and restock

**Actor:** Customer Service or Cashier, Inspector, Finance Worker.

**Entry:** `POST /commerce/returns`.

**Normal sequence:**

1. Validate order line, return window, policy revision, prior return/refund, and actor scope.
2. Create return case idempotently.
3. Inspector records physical condition and evidence.
4. System automatically routes item state.
5. Refund operation is created under threshold/approval policy.
6. Provider refund is dispatched and reconciled.
7. Restock/catalog deltas occur only from committed stock transition.

**Unknown refund:** no duplicate refund; reconciliation and manual conflict review if provider evidence conflicts.

**Recovery:** compensating stock transition requires exact return/item reference and expected version.

## OP-010 — Complaint pattern to Audit Finding and Growth action

**Actor:** Customer Service and policy worker.

**Entry:** complaint record or message classification.

**Normal sequence:**

1. Bind complaint to tenant/customer/order/product without exposing PII in analytics.
2. Normalize issue type and evidence.
3. Deduplicate and evaluate threshold/window policy.
4. Create or update an Audit Finding when threshold crosses.
5. Create a review task or Growth Intelligence action candidate.
6. Human accepts/rejects proposed corrective action.

**Boundary:** the finding or approved action never authorizes provider write or campaign spend.

## OP-011 — Ad performance reconciliation

**Actor:** Scheduled worker or authorized analyst refresh.

**Entry:** provider facts, measurement facts, commerce orders/refunds/cost facts.

**Normal sequence:**

1. Resolve provider connections and date window.
2. Import immutable facts with provider/source revision.
3. Normalize campaign/ad/product/location dimensions.
4. Link orders through click IDs, UTM, transaction, channel, and bounded attribution rules.
5. Compute separate attribution views and contribution after ads.
6. Persist reconciliation run and drift/errors.

**Provider mutation:** campaign/budget changes require separate capability, budget authority, approval, and readback; the reconciliation path is read-only.

## OP-012 — Switch commerce backend

**Actor:** Tenant Admin plus Platform governance.

**Entry:** governed migration plan, never a normal settings toggle.

**Preconditions:** target adapter certified; source and target snapshots; write freeze strategy; identity mapping; reconciliation; rollback plan; approvals.

**Sequence:**

1. Create migration plan and baseline hashes.
2. Block new long-lived operations or enter controlled dual-read mode.
3. Export/import in bounded chunks.
4. Reconcile products, stock, reservations, open orders, payments, returns, suppliers, and publications.
5. Activate target binding atomically.
6. Invalidate old context revisions and capabilities.
7. Run same-cycle smoke.
8. Keep old backend read-only for rollback window.

**Forbidden:** dual writable authority.

## OP-013 — Provider outage and graceful degradation

**Actor:** Health monitor and worker.

**Sequence:**

1. Detect timeout/error-rate/readiness failure.
2. Open circuit and classify provider degraded/down.
3. Preserve domain transaction when external provider is noncritical.
4. Queue/retry Outbox delivery within policy.
5. Block operations that require authoritative provider response, such as new online card payment when no fallback exists.
6. Surface safe operator guidance.
7. On recovery, probe readiness and replay due deliveries.
8. Reconcile provider state before healthy classification.

## OP-014 — Production parity verification

**Actor:** CI, release operator, automated smoke runner.

**Sequence:**

1. Validate schemas/OpenAPI/generators.
2. Run unit, integration, cross-tenant, concurrency, idempotency, fault injection, and adapter contract tests.
3. Apply migrations through governed runner.
4. Verify runtime version and migration ledger.
5. Run controlled commerce smoke using rollback/test tenant.
6. Verify Outbox, workers, provider sandbox, UI responsive/RTL/accessibility, and readback.
7. Compare v6 acceptance matrix.
8. Classify incomplete if any backend invariant is only represented by UI.
