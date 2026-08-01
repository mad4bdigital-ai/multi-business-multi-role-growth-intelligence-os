import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(
  new URL("./migrations/1042_sprint69_support_ticket_lifecycle_sla_dedupe.sql", import.meta.url),
  "utf8",
);

const addColumnsIndex = migration.indexOf("ADD COLUMN IF NOT EXISTS first_response_at");
const evidenceBackfillIndex = migration.indexOf("derived_first_response_at");
const triggerIndex = migration.indexOf("CREATE TRIGGER trg_ticket_lifecycle_sla_milestones");
const slaReconciliationIndex = migration.indexOf("-- Milestone-aware SLA reconciliation");

assert.ok(addColumnsIndex >= 0, "migration must add milestone columns");
assert.ok(evidenceBackfillIndex > addColumnsIndex, "event evidence backfill must run after columns exist");
assert.ok(triggerIndex > evidenceBackfillIndex, "trigger must be created after legacy evidence backfill");
assert.ok(slaReconciliationIndex > triggerIndex, "SLA reconciliation must run after milestone evidence is durable");

assert.match(migration, /FROM ticket_lifecycle_events e/);
assert.match(migration, /DROP TRIGGER IF EXISTS trg_ticket_lifecycle_sla_milestones/);
assert.match(migration, /AFTER INSERT ON ticket_lifecycle_events/);
assert.match(migration, /NEW\.visibility = 'customer'/);
assert.match(migration, /NEW\.event_type NOT IN \('ticket_created', 'dedupe_matched', 'queue_assigned'\)/);
assert.match(migration, /NEW\.event_type IN \('triaged', 'ticket_triaged', 'assignee_changed', 'diagnostic_started'\)/);
assert.match(migration, /NEW\.event_type = 'state_transition'/);
assert.match(migration, /LOWER\(COALESCE\(NEW\.actor_type, 'system'\)\) NOT IN \('tenant_user', 'customer', 'user'\)/);
assert.match(migration, /COALESCE\(first_response_at, NEW\.created_at\)/);
assert.match(migration, /COALESCE\(triaged_at, NEW\.created_at\)/);
assert.match(migration, /milestone_trigger_count/);

assert.doesNotMatch(migration, /DELIMITER/i, "single-statement trigger must not rely on client delimiter commands");
assert.doesNotMatch(migration, /CREATE TRIGGER[\s\S]*?BEGIN/i, "trigger must remain a single SQL statement for the migration runner");
assert.doesNotMatch(migration, /DROP\s+(TABLE|COLUMN|INDEX)/i);
assert.doesNotMatch(migration, /DELETE\s+FROM/i);

console.log("support ticket SLA milestone trigger and evidence backfill contract passed");
