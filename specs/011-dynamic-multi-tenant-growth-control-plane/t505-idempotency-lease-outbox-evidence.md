# T505 Idempotency, Lease, and Outbox Integration Evidence

## Scope

This slice adds integration coverage over existing runtime authorities without adding a new execution lifecycle, database table, provider adapter, or delivery mechanism.

## Reused authorities

- `execution_plan_mutation_receipts` and `createDurableReceiptAwareExecutor()` own provider-effect idempotency.
- `platform_outbox_events` owns immutable event identity.
- `platform_outbox_deliveries` owns per-consumer delivery state and claim leases.
- `runPlatformOutboxWorker()` owns claim, expiry recovery, delivery acknowledgement, and replay behavior.

## Proved invariants

1. Repeating the same plan step and request reuses the successful mutation receipt and does not call the provider executor twice.
2. Receipt replay does not enqueue a second outbox event.
3. `INSERT IGNORE` plus event/consumer identity creates one delivery row per event and consumer.
4. While one worker owns a live claim, a competing worker observes no eligible delivery.
5. An expired claim is released and reclaimed once.
6. Replayed event delivery retains the same event ID so a consumer can deduplicate without applying the effect twice.
7. Delivered rows are not transmitted again.
8. Outbox batches remain no-secret and metadata-only for the tested effect evidence.

## Operational boundaries

- The integration uses an in-memory SQL contract fake and a stubbed HTTPS receiver.
- No live database query or mutation is performed.
- No provider or external network call is performed.
- No migration is applied.
- No deployment, production activation, or credential access is performed.
