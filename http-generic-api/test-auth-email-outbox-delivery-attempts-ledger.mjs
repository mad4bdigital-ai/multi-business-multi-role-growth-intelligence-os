import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const worker = readFileSync(new URL("./authEmailOutboxWorker.js", import.meta.url), "utf8");
const migration = readFileSync(new URL("./migrations/20260723_auth_email_outbox_delivery_attempts.sql", import.meta.url), "utf8");

assert.match(migration, /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+auth_email_outbox_delivery_attempts/i, "migration must add the delivery attempt ledger table");
assert.match(migration, /attempt_status\s+ENUM\('started','sent','failed','skipped'\)/i, "ledger must capture started sent failed and skipped states");
assert.match(migration, /external_send_performed\s+TINYINT\(1\)\s+NOT\s+NULL\s+DEFAULT\s+0/i, "ledger must explicitly capture external send evidence");
assert.match(migration, /secrets_included\s+TINYINT\(1\)\s+NOT\s+NULL\s+DEFAULT\s+0/i, "ledger must explicitly record no-secrets evidence");
assert.match(migration, /idx_auth_email_attempts_email/, "ledger must be queryable by outbox email_id");
assert.match(migration, /idx_auth_email_attempts_ticket/, "ledger must be queryable by ticket_id");
assert.doesNotMatch(migration, /\bDELETE\b|\bDROP\b|\bTRUNCATE\b/i, "migration must not be destructive");

assert.match(worker, /async\s+function\s+recordAuthEmailOutboxDeliveryAttempt/, "worker must define an attempt recorder");
assert.match(worker, /INSERT\s+INTO\s+auth_email_outbox_delivery_attempts/i, "worker must write the attempt ledger");
assert.match(worker, /status:\s*"sent"/, "worker must record sent attempts");
assert.match(worker, /status:\s*"failed"/, "worker must record failed attempts");
assert.match(worker, /status:\s*"skipped"/, "worker must record skipped attempts");
assert.match(worker, /external_send_performed:\s*status\s*===\s*"sent"/, "ledger metadata must only mark external send for sent attempts");
assert.match(worker, /secrets_included:\s*false/, "worker must never claim secrets are included in ledger metadata");

const recorderBlock = worker.slice(worker.indexOf("async function recordAuthEmailOutboxDeliveryAttempt"), worker.indexOf("export async function getAuthEmailOutboxStatus"));
assert.doesNotMatch(recorderBlock, /decryptUserAppCredentials|refresh_token|client_secret|gmail\.users\.messages\.send/i, "attempt recorder must not handle secrets or send email");

console.log("auth email outbox delivery attempt ledger tests passed");
