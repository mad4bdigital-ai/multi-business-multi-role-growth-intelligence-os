import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const routes = readFileSync(new URL("./routes/supportTicketRoutes.js", import.meta.url), "utf8");
const worker = readFileSync(new URL("./authEmailOutboxWorker.js", import.meta.url), "utf8");
const migration = readFileSync(new URL("./migrations/20260723_auth_email_outbox_skip_ineligible_tool.sql", import.meta.url), "utf8");

assert.match(worker, /export\s+async\s+function\s+skipAuthEmailOutboxIneligible/, "worker must export a dedicated skip-ineligible service");
assert.match(worker, /mode:\s*"skip_ineligible"/, "skip service must identify its mode");
assert.match(worker, /external_send_performed:\s*false/, "skip service must never report external delivery");
assert.doesNotMatch(worker.slice(worker.indexOf("export async function skipAuthEmailOutboxIneligible"), worker.indexOf("export async function runAuthEmailOutboxWorker")), /sendViaGmail|gmail\.users\.messages\.send|AUTH_EMAIL_OUTBOX_DELIVERY_ENABLED/, "skip service must not depend on Gmail delivery or delivery feature flag");

assert.match(routes, /skipAuthEmailOutboxIneligible/, "route must call the no-delivery skip service");
assert.match(routes, /\/admin\/support\/tickets\/auth-email-outbox\/skip-ineligible/, "route must expose skip-ineligible endpoint");
assert.match(routes, /applies_delivery:\s*false/, "route must return no-delivery evidence");
assert.match(routes, /external_send_performed:\s*false/, "route must return no-external-send evidence");

assert.match(migration, /auth_email_outbox_skip_ineligible/, "migration must register the skip-ineligible tool key");
assert.match(migration, /\/admin\/support\/tickets\/auth-email-outbox\/skip-ineligible/, "migration must register the endpoint path");
assert.match(migration, /no_delivery,cleanup,no_secrets/, "tool must be tagged as no-delivery cleanup");
assert.match(migration, /ON DUPLICATE KEY UPDATE/i, "migration must be idempotent");
assert.doesNotMatch(migration, /\bDELETE\b|\bDROP\b|\bTRUNCATE\b/i, "registry migration must not be destructive");

console.log("auth email outbox skip ineligible tool tests passed");
