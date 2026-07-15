# MAD4B Platform Outbox Batch v1

## Status

Draft receiver contract for the one-way production-to-shadow synchronization path.

This specification does not activate a consumer, configure an endpoint, bind a credential, or permit external delivery.

## Contract identity

```text
mad4b.platform.outbox.batch.v1
```

The sender already emits this contract from `platformOutbox.js`. A receiver must implement the rules below before the consumer can move from `disabled/noop` to an approved HTTPS shadow configuration.

## Transport

- Method: `POST`
- Scheme: HTTPS only
- Redirects: forbidden
- Content type: `application/json`
- Authentication: independently approved bearer or X-API-Key reference when required
- The endpoint hostname must be present in the sender allowlist.
- Credentials must never appear in the URL, query string, event payload, metadata, logs, or repository.

Required request headers:

```text
Content-Type: application/json
X-MAD4B-Outbox-Contract: mad4b.platform.outbox.batch.v1
X-MAD4B-Consumer: <consumer_key>
X-MAD4B-Batch-SHA256: <sha256 of exact request body bytes>
```

The receiver must recompute `X-MAD4B-Batch-SHA256` before opening a database transaction.

## Batch shape

```json
{
  "contract": "mad4b.platform.outbox.batch.v1",
  "consumer_key": "prod_shadow_v1",
  "source_environment": "production",
  "sent_at": "2026-07-14T00:00:00.000Z",
  "events": [
    {
      "event_id": "00000000-0000-4000-8000-000000000000",
      "event_type": "growth_intelligence.report_persisted",
      "schema_version": 1,
      "aggregate_type": "growth_intelligence_report",
      "aggregate_id": "report-id",
      "tenant_id": "tenant-id",
      "workspace_id": null,
      "occurred_at": "2026-07-14T00:00:00.000Z",
      "payload": {},
      "metadata": {},
      "payload_sha256": "<sha256 of the canonical source payload>",
      "payload_classification": "internal",
      "contains_pii": false
    }
  ],
  "secrets_included": false
}
```

The receiver must reject the whole batch when:

- `contract` is unsupported;
- the header contract and body contract differ;
- `secrets_included` is not exactly `false`;
- an event type or schema version is not allowlisted;
- a required event identity field is missing;
- the batch body hash does not match the request header;
- an event repeats within the same request with conflicting content;
- the batch exceeds the receiver's approved size or event-count limits.

## Receiver idempotency ledger

The receiver must create its own durable ledger before the first delivery. A minimal relational shape is:

```sql
CREATE TABLE shadow_outbox_event_receipts (
  event_id CHAR(36) NOT NULL PRIMARY KEY,
  consumer_key VARCHAR(120) NOT NULL,
  event_type VARCHAR(160) NOT NULL,
  schema_version SMALLINT UNSIGNED NOT NULL,
  aggregate_type VARCHAR(100) NOT NULL,
  aggregate_id VARCHAR(191) NOT NULL,
  source_environment VARCHAR(32) NOT NULL,
  payload_sha256 CHAR(64) NOT NULL,
  batch_sha256 CHAR(64) NOT NULL,
  receipt_status ENUM('received','applied','rejected') NOT NULL,
  first_received_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  applied_at DATETIME(6) NULL,
  last_error_code VARCHAR(120) NULL,
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
    ON UPDATE CURRENT_TIMESTAMP(6),
  KEY idx_shadow_outbox_receipts_type (event_type, schema_version, applied_at),
  KEY idx_shadow_outbox_receipts_status (receipt_status, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

Raw credentials and unmasked production payloads must not be stored in this ledger.

## Atomic processing algorithm

1. Authenticate the request and verify the hostname/path policy.
2. Validate headers, body shape, contract, batch hash, event allowlist, schema versions, classifications, and `secrets_included=false` before opening a transaction.
3. Begin one receiver transaction for the batch where practical.
4. For each event, lock or insert its `event_id` receipt.
5. If the same `event_id` already exists with the same event type, schema version, aggregate identity, and payload hash, treat it as an accepted replay and do not apply the target mutation again.
6. If the same `event_id` exists with a different hash or identity, roll back the whole batch and return `409`.
7. Apply the event through an allowlisted receiver handler. Handlers may write only to shadow-owned projections.
8. Mark the receipt `applied` in the same transaction as the target projection mutation.
9. Commit only after every non-replay event succeeds.
10. Return a 2xx response only when the entire batch is accepted.

A receiver must never acknowledge a partially applied batch with 2xx because the sender treats a successful response as delivery of every claimed event in that batch.

## Response contract

Successful response:

```json
{
  "ok": true,
  "contract": "mad4b.platform.outbox.receiver.ack.v1",
  "consumer_key": "prod_shadow_v1",
  "accepted_count": 1,
  "applied_count": 1,
  "replayed_count": 0,
  "secrets_included": false
}
```

Status guidance:

- `200`: whole batch accepted; duplicates with matching identity/hash may be counted as replayed.
- `400`: malformed request or invalid batch hash.
- `401`: missing or invalid authentication.
- `403`: authenticated caller or consumer is not allowed.
- `409`: idempotency conflict for an existing `event_id`.
- `422`: unsupported contract, event type, schema version, or classification.
- `429`: receiver rate limit; include retry guidance.
- `503`: transient receiver or dependency failure; no partial acknowledgement.

Responses must use a stable JSON error envelope and must not expose stack traces, SQL text, credentials, or payload bodies.

## First event candidate

Event type:

```text
growth_intelligence.report_persisted
```

Initial registry status:

```text
draft
```

Producer candidate:

```text
growth_intelligence_registry
```

Aggregate identity:

```text
aggregate_type=growth_intelligence_report
aggregate_id=<report_id>
```

Version 1 payload fields planned for the producer-wiring phase:

```json
{
  "report_id": "report-id",
  "workflow_run_id": "workflow-run-id",
  "brand_key": "brand-key",
  "report_type": "growth_intelligence",
  "report_schema_version": 1,
  "status": "approval_pending",
  "quality_status": "pass",
  "insight_count": 3,
  "action_count": 2,
  "approval_hold_count": 2,
  "business_activity_type_key": "optional-registry-resolved-key"
}
```

Rules:

- `business_activity_type_key` may be included only when resolved from `business_activity_types`; it must be omitted rather than inferred when unavailable.
- The payload must not include report bodies, executive-summary text, insight titles or rationale, action titles, decision notes, user names, email addresses, IP addresses, credentials, tokens, provider responses, or raw evidence.
- Tenant and workspace identity remain in the event envelope, not duplicated inside the payload.
- Metadata may contain internal correlation/audit identifiers and the producer key, but no user identity or secret-bearing request data.

## Promotion sequence

1. Merge this contract and the draft event-type registration.
2. Apply the additive draft registration to development through the governed migration runner.
3. Verify the event type is `draft` and no events or deliveries are created.
4. Add deterministic producer tests using a caller-owned transaction.
5. Promote the event type to `active` through a separate governed migration.
6. Wire `persistGrowthIntelligencePilot` to enqueue one event before commit.
7. Verify report persistence and outbox insertion commit or roll back together.
8. Confirm the disabled/noop consumer produces zero deliveries.
9. Certify a receiver against this contract before configuring an endpoint.
10. Activate transport and consumer status only through a separate plan-bound rollout.

## Non-goals

This contract does not:

- permit production delivery;
- define a public receiver URL;
- provision or store credentials;
- activate `prod_shadow_v1`;
- change `transport_key=noop`;
- wire a producer;
- copy raw database rows;
- support bidirectional synchronization;
- permit secrets or unmasked PII.
