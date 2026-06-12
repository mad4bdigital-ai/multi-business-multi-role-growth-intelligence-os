import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const dbCertifier = readFileSync(new URL("./scripts/dr-certifiers/db-isolated-restore-certifier.mjs", import.meta.url), "utf8");
const n8nCertifier = readFileSync(new URL("./scripts/dr-certifiers/n8n-isolated-restore-boot-certifier.mjs", import.meta.url), "utf8");
const readback = readFileSync(new URL("./scripts/dr-certification-evidence-readback.mjs", import.meta.url), "utf8");
const gated = readFileSync(new URL("./scripts/tool-bus-gated-read-only-dispatch.mjs", import.meta.url), "utf8");
const release = readFileSync(new URL("./releaseReadiness.js", import.meta.url), "utf8");
const routes = readFileSync(new URL("./routes/adminCliRoutes.js", import.meta.url), "utf8");

assert.match(dbCertifier, /isolated_db_restore_mariadb/);
assert.match(dbCertifier, /ports_published: false/);
assert.match(dbCertifier, /production_touched: false/);
assert.match(dbCertifier, /content_returned: false/);
assert.match(dbCertifier, /plaintext_sql_removed/);
assert.match(n8nCertifier, /isolated_n8n_restore_boot/);
assert.match(n8nCertifier, /N8N_RUNNERS_BROKER_PORT/);
assert.match(n8nCertifier, /127\.0\.0\.1/);
assert.match(n8nCertifier, /content_returned: false/);
assert.match(n8nCertifier, /extracted_restore_removed/);
assert.match(readback, /dr_certification\.db_isolated_restore\.latest/);
assert.match(readback, /dr_certification\.n8n_isolated_restore_boot\.latest/);
assert.match(readback, /secrets_included: false/);
assert.match(gated, /tool_bus_gated_read_only_dispatch_pilot/);
assert.match(gated, /tenant_repository_intelligence_report/);
assert.match(gated, /provider_call_performed: false/);
assert.match(gated, /repository_mutation_performed: false/);
assert.match(gated, /dispatch_executed: ok/);
assert.match(release, /checkDrCertificationEvidenceReadiness/);
assert.match(release, /dr_certification_readiness/);
assert.match(routes, /dr_certification_evidence_readback/);
assert.match(routes, /tool_bus_gated_read_only_dispatch/);

console.log(JSON.stringify({ ok: true, test: "dr_certification_and_toolbus_gated_static" }));
