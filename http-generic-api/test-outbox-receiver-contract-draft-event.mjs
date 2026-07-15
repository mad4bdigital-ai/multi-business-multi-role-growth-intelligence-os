import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(root, "..");

const migration = await fs.readFile(
  path.join(root, "migrations", "20260714_growth_intelligence_report_persisted_outbox_event_draft.sql"),
  "utf8"
);
const contract = await fs.readFile(
  path.join(repositoryRoot, "docs", "specs", "mad4b-platform-outbox-batch-v1.md"),
  "utf8"
);
const outboxSource = await fs.readFile(path.join(root, "platformOutbox.js"), "utf8");
const producerSource = await fs.readFile(path.join(root, "growthIntelligenceRegistry.js"), "utf8");

assert.match(migration, /growth_intelligence\.report_persisted/);
assert.match(migration, /growth_intelligence_registry/);
assert.match(migration, /'internal'/);
assert.match(migration, /\b0,\s*\n\s*'draft'/);
assert.match(migration, /INSERT INTO platform_outbox_event_types/);
assert.match(migration, /ON DUPLICATE KEY UPDATE/);
assert.match(migration, /GREATEST\(current_schema_version, VALUES\(current_schema_version\)\)/);
assert.match(migration, /WHEN status IN \('active','paused','retired'\) THEN status/);
assert.doesNotMatch(migration, /UPDATE\s+platform_outbox_consumers/i);
assert.doesNotMatch(migration, /INSERT INTO\s+platform_outbox_events/i);
assert.doesNotMatch(migration, /https_batch_v1/);
assert.doesNotMatch(migration, /endpoint_url\s*=/i);
assert.doesNotMatch(migration, /credential_ref\s*=/i);
assert.doesNotMatch(migration, /OUTBOX_DELIVERY_ENABLED/);

assert.match(contract, /mad4b\.platform\.outbox\.batch\.v1/);
assert.match(contract, /X-MAD4B-Batch-SHA256/);
assert.match(contract, /shadow_outbox_event_receipts/);
assert.match(contract, /same `event_id` already exists with the same event type/);
assert.match(contract, /different hash or identity, roll back the whole batch and return `409`/);
assert.match(contract, /must never acknowledge a partially applied batch with 2xx/);
assert.match(contract, /growth_intelligence\.report_persisted/);
assert.match(contract, /Initial registry status:\s*\n\s*```text\s*\n\s*draft/);
assert.match(contract, /business_activity_type_key.*resolved from `business_activity_types`/s);
assert.match(contract, /must be omitted rather than inferred/);
assert.match(contract, /does not:\s*\n\s*- permit production delivery;/);
assert.match(contract, /- wire a producer;/);

assert.match(outboxSource, /contract: "mad4b\.platform\.outbox\.batch\.v1"/);
assert.match(outboxSource, /"X-MAD4B-Batch-SHA256": sha256\(payloadText\)/);
assert.match(outboxSource, /redirect: "error"/);
assert.match(outboxSource, /secrets_included: false/);

assert.doesNotMatch(producerSource, /enqueuePlatformOutboxEvent/);
assert.doesNotMatch(producerSource, /growth_intelligence\.report_persisted/);

console.log("outbox receiver contract and draft event registration tests passed");
