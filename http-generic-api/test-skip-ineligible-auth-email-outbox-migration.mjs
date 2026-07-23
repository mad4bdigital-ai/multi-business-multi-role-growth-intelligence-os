import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("./migrations/20260722_skip_ineligible_auth_email_outbox_smoke_notifications.sql", import.meta.url), "utf8");

assert.match(migration, /UPDATE\s+auth_email_outbox\s+e/i, "migration must target auth_email_outbox");
assert.match(migration, /LEFT\s+JOIN\s+tickets\s+t/i, "migration must verify related ticket state");
assert.match(migration, /e\.purpose\s*=\s*'support_ticket_admin_notification'/i, "migration must be scoped to support ticket admin notifications");
assert.match(migration, /e\.status\s*=\s*'queued'/i, "migration must only touch queued rows");
assert.match(migration, /SET\s+e\.status\s*=\s*'skipped'/i, "migration must skip rather than send or delete");
assert.match(migration, /external_send_performed/i, "migration must preserve no-send evidence");
assert.match(migration, /ticket_not_open/i, "migration must capture closed or resolved ticket reason");
assert.match(migration, /ticket_not_found/i, "migration must capture missing ticket reason");
assert.match(migration, /smoke_test_notification/i, "migration must capture smoke-test reason");
assert.doesNotMatch(migration, /\bDELETE\b/i, "migration must not delete rows");
assert.doesNotMatch(migration, /\bDROP\b/i, "migration must not drop objects");
assert.doesNotMatch(migration, /\bTRUNCATE\b/i, "migration must not truncate objects");

const updateStatements = migration.split(";").filter((statement) => /\bUPDATE\b/i.test(statement));
assert.equal(updateStatements.length, 1, "migration must contain exactly one guarded UPDATE statement");

console.log("skip ineligible auth email outbox migration guard test passed");
