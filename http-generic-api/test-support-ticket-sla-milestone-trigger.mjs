import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { splitMigrationSqlStatements } from "./migrationSqlStatements.js";

const migration = await readFile(
  new URL("./migrations/1042_sprint69_support_ticket_lifecycle_sla_dedupe.sql", import.meta.url),
  "utf8",
);

const addColumnsIndex = migration.indexOf("ADD COLUMN IF NOT EXISTS first_response_at");
const evidenceBackfillIndex = migration.indexOf("derived_first_response_at");
const triggerIndex = migration.indexOf("CREATE OR REPLACE TRIGGER trg_ticket_lifecycle_sla_milestones");
const slaReconciliationIndex = migration.indexOf("-- Milestone-aware SLA reconciliation");

assert.ok(addColumnsIndex >= 0, "migration must add milestone columns");
assert.ok(evidenceBackfillIndex > addColumnsIndex, "event evidence backfill must run after columns exist");
assert.ok(triggerIndex > evidenceBackfillIndex, "trigger must be created after legacy evidence backfill");
assert.ok(slaReconciliationIndex > triggerIndex, "SLA reconciliation must run after milestone evidence is durable");

assert.match(migration, /FROM ticket_lifecycle_events e/);
assert.match(migration, /CREATE OR REPLACE TRIGGER trg_ticket_lifecycle_sla_milestones/);
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
assert.doesNotMatch(migration, /CREATE OR REPLACE TRIGGER[\s\S]*?BEGIN/i, "trigger must remain a single SQL statement for the migration runner");
assert.doesNotMatch(migration, /DROP\s+(TABLE|COLUMN|INDEX|TRIGGER)/i);
assert.doesNotMatch(migration, /DELETE\s+FROM/i);

const statements = splitMigrationSqlStatements(migration);
const triggerStatements = statements.filter((statement) => /CREATE OR REPLACE TRIGGER trg_ticket_lifecycle_sla_milestones/i.test(statement));
assert.equal(triggerStatements.length, 1, "governed splitter must expose one standalone trigger statement");
assert.match(triggerStatements[0], /^CREATE OR REPLACE TRIGGER/i);
assert.doesNotMatch(triggerStatements[0], /UPDATE tickets t\s+JOIN/i, "trigger must not be merged into the evidence-backfill statement");
assert.ok(
  statements.some((statement) => /^UPDATE tickets t\s+JOIN/i.test(statement) && /derived_first_response_at/i.test(statement)),
  "governed splitter must expose the lifecycle-evidence backfill independently",
);

console.log("support ticket SLA milestone trigger, evidence backfill, and governed splitter contract passed");
