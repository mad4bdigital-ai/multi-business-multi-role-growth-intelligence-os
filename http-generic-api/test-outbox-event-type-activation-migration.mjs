import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const migration = await fs.readFile(
  path.join(root, "migrations", "20260716_activate_growth_intelligence_report_persisted_outbox_event.sql"),
  "utf8"
);
const producerSource = await fs.readFile(path.join(root, "growthIntelligenceRegistry.js"), "utf8");

assert.match(migration, /UPDATE\s+platform_outbox_event_types/i);
assert.match(migration, /SET\s+status\s*=\s*'active'/i);
assert.match(migration, /event_type\s*=\s*'growth_intelligence\.report_persisted'/i);
assert.match(migration, /current_schema_version\s*=\s*1/i);
assert.match(migration, /producer_key\s*=\s*'growth_intelligence_registry'/i);
assert.match(migration, /payload_classification\s*=\s*'internal'/i);
assert.match(migration, /contains_pii\s*=\s*0/i);
assert.match(migration, /status\s*=\s*'draft'/i);

assert.doesNotMatch(migration, /platform_outbox_consumers/i);
assert.doesNotMatch(migration, /platform_outbox_events/i);
assert.doesNotMatch(migration, /platform_outbox_deliveries/i);
assert.doesNotMatch(migration, /transport_key/i);
assert.doesNotMatch(migration, /endpoint_url/i);
assert.doesNotMatch(migration, /credential_ref/i);
assert.doesNotMatch(migration, /OUTBOX_DELIVERY_ENABLED/i);
assert.doesNotMatch(migration, /INSERT\s+INTO/i);
assert.doesNotMatch(migration, /DELETE\s+FROM/i);
assert.doesNotMatch(migration, /DROP\s+/i);
assert.doesNotMatch(migration, /ALTER\s+/i);

assert.match(producerSource, /enqueuePlatformOutboxEvent/);
assert.match(producerSource, /growth_intelligence\.report_persisted/);
assert.match(producerSource, /outboxMode = "disabled"/);
assert.match(producerSource, /dev_transactional/);
assert.match(producerSource, /Growth Intelligence outbox producer mode is restricted to a _dev database/);
assert.match(producerSource, /outboxEvent = await enqueuePlatformOutboxEvent/);

console.log("guarded outbox event-type activation migration tests passed");
