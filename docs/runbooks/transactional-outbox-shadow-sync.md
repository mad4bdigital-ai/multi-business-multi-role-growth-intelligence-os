# Transactional Outbox and Shadow Sync Runbook

## Purpose

This runbook defines the portable one-way synchronization path from the production platform to a masked read-only shadow environment.

The design supports the current Hostinger runtime and a later move to Hetzner without changing event contracts or business write semantics.

## Safety model

- Production is the only source of user and operational data.
- Synchronization is one-way: production to shadow.
- Development and staging never write data back to production.
- Schema promotion uses governed migrations, not the outbox.
- Code promotion uses approved Git commits and release artifacts, not the outbox.
- External delivery is disabled by default.
- Events containing secrets are rejected before persistence.
- PII is masked before delivery.
- Consumers use idempotent event IDs and a per-consumer delivery ledger.

## Components

- `platform_outbox_event_types`: allowlisted event contracts and schema versions.
- `platform_outbox_events`: immutable business events committed with the business transaction.
- `platform_outbox_consumers`: target configuration and activation state.
- `platform_outbox_mask_policies`: masking and deny policies.
- `platform_outbox_deliveries`: per-consumer idempotency, claims, retries, and dead-letter state.
- `platformOutbox.js`: enqueue, sanitize, claim, deliver, retry, and status service.
- `scripts/platform-outbox-worker.mjs`: Hostinger cron and future Hetzner loop entry point.

## Initial state after migration

The default consumer must remain:

```text
consumer_key=prod_shadow_v1
transport_key=noop
status=disabled
```

No external request is allowed in this state.

## Event type onboarding

1. Define a stable business event, not a raw table-change event.
2. Add or update its event type registry row through a governed migration.
3. Start with `status=draft`.
4. Review payload classification, PII, size, and compatibility.
5. Add deterministic tests.
6. Promote the event type to `active` through a separate governed migration.
7. Emit the event inside the same database transaction as the business change.

Example transaction ownership:

```js
const conn = await pool.getConnection();
try {
  await conn.beginTransaction();
  await conn.query("UPDATE orders SET status = ? WHERE order_id = ?", ["paid", orderId]);
  await enqueuePlatformOutboxEvent({
    connection: conn,
    eventType: "order.payment_confirmed",
    aggregateType: "order",
    aggregateId: orderId,
    payload: { order_id: orderId, status: "paid" },
    metadata: { request_id: requestId },
    sourceEnvironment: "production",
  });
  await conn.commit();
} catch (error) {
  await conn.rollback();
  throw error;
} finally {
  conn.release();
}
```

The caller owns commit and rollback when a connection is supplied.

### Growth Intelligence development producer

`persistGrowthIntelligencePilot` keeps `outbox_mode=disabled` by default. The only enabled producer mode in this phase is:

```text
outbox_mode=dev_transactional
```

That mode must fail before the first business write unless `SELECT DATABASE()` returns a name ending in `_dev`. The report records, insights, actions, approval holds, and one `growth_intelligence.report_persisted` event must commit in one transaction. Any event validation or insert failure must roll back the whole transaction.

The event payload is limited to report/workflow/brand identifiers, schema and status fields, aggregate counts, and a registry-resolved business activity key when available. Report bodies, executive summaries, insight/action text, user identity, credentials, tokens, provider responses, and raw evidence are forbidden.

After deployment, run exactly one governed development pilot with `outbox_mode=dev_transactional`, then verify:

```text
event_count increases by exactly 1
event_type=growth_intelligence.report_persisted
delivery_counts remain unchanged
consumer status remains disabled
transport remains noop
external request count remains 0
```

Do not enable the producer on production until the production outbox foundation and event-type migrations have their own approved rollout and readback.

## Payload rules

Never include:

- passwords or password hashes
- access or refresh tokens
- cookies or authorization headers
- API keys or provider credentials
- private keys or recovery codes
- raw payment credentials

Use identifiers and business facts only. Keep each event below the configured maximum event size.

## Hostinger operating mode

Hostinger should use bounded run-once executions rather than relying on a permanently running worker.

Read-only status:

```bash
npm run outbox:status
```

Read-only delivery preview:

```bash
npm run outbox:dry-run
```

Governed run-once delivery after activation:

```bash
npm run outbox:run-once
```

Recommended cron frequency after activation:

```text
Every minute initially.
Reduce the interval only after runtime and database load evidence is available.
```

The run-once command still fails closed unless every activation requirement is satisfied.

## Activation requirements

Do not activate delivery until all items pass in the same cycle:

1. The shadow endpoint exists and accepts `mad4b.platform.outbox.batch.v1`.
2. The endpoint is HTTPS.
3. Its hostname is present in `OUTBOX_ALLOWED_HOSTS`.
4. `OUTBOX_DELIVERY_ENABLED=true` is set.
5. The consumer transport is `https_batch_v1`.
6. The consumer status is `shadow` or `active`.
7. The masking policy is active and forbids secrets.
8. The credential reference resolves from an approved environment secret when authentication is required.
9. Dry-run returns only expected event types and masked classifications.
10. A receiver-side idempotency table is active before the first delivery.
11. Rollback is documented: disable the consumer and clear the feature flag.

Activation should be a separate plan-bound approval and migration/configuration change. Do not combine foundation deployment with external activation.

## Receiver contract

The normative batch, acknowledgement, replay, and idempotency rules are defined in `docs/specs/mad4b-platform-outbox-batch-v1.md`.

The receiver must process a batch atomically where practical and use `event_id` as the idempotency key.

Required behavior:

- reject unsupported contract or schema versions
- reject payloads marked `secrets_included=true`
- store the event ID before or with the target mutation
- return a non-2xx response if the whole batch is not accepted
- never call production from the receiver
- apply only allowlisted event types
- expose health, readiness, last checkpoint, and lag metrics

## Failure handling

- Temporary failures move to `failed` with exponential backoff.
- Claims expire automatically so another worker can continue.
- Events exceeding maximum attempts move to `dead_letter`.
- Do not delete dead-letter rows automatically.
- Investigate and replay through a separately approved repair path.
- Pause the consumer if lag grows continuously or dead-letter count becomes non-zero.

## Monitoring

Track at minimum:

- event count
- pending delivery count
- failed delivery count
- dead-letter count
- oldest pending event age
- last successful delivery
- last failure code
- current consumer status
- deployed commit
- migration checksum and schema version

Suggested initial alerts:

```text
oldest pending age > 300 seconds
failed deliveries > 0 for 10 minutes
dead-letter count > 0
consumer heartbeat missing for 5 minutes
receiver schema version mismatch
```

## Reconciliation

The outbox is event-driven and does not replace periodic reconciliation.

Run a scheduled comparison of:

- selected table counts
- primary-key presence
- deleted records
- sampled deterministic row hashes
- latest event/checkpoint timestamps

Reconciliation must be read-only by default and produce a governed repair plan rather than mutating either side automatically.

## Migration to Hetzner

The event contract and database tables stay unchanged.

On Hetzner:

1. Run the worker as a dedicated container or systemd service.
2. Use `npm run outbox:loop` with graceful shutdown.
3. Place the worker and receiver on a private network where possible.
4. Restrict firewalls to the required application paths.
5. Move credential references to the approved secrets runtime.
6. Keep the HTTPS batch contract during the transition.
7. Add binlog CDC later only as a replication accelerator; do not remove business outbox events.
8. Maintain the run-once command as an operational fallback.

## Rollback and containment

Immediate containment:

1. Set `OUTBOX_DELIVERY_ENABLED=false`.
2. Change the consumer to `paused` or `disabled`.
3. Confirm no new delivery claims are being created.
4. Let existing claims expire or release them through a governed repair operation.
5. Preserve event and delivery rows for diagnosis.

Foundation rollback does not require dropping the additive tables. Leave them inactive until the issue is resolved.

## Production rollout sequence

1. Merge code after CI and security review.
2. Deploy with delivery disabled.
3. Apply the additive migration to development.
4. Verify table structure and seeded disabled consumer.
5. Apply to staging and run status/dry-run tests.
6. Add one draft event type and one controlled producer path.
7. Verify events persist with zero external delivery.
8. Build and certify the masked shadow receiver.
9. Activate a shadow consumer in a separate approved rollout.
10. Expand event coverage gradually.

## Non-goals

This foundation does not:

- synchronize schemas
- apply production migrations automatically
- copy the entire production database continuously
- support bidirectional synchronization
- enable external delivery by default
- replace backups or point-in-time recovery
- permit secrets in event payloads
