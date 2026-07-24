import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const server = readFileSync(new URL("./server.js", import.meta.url), "utf8");
const runtime = readFileSync(
  new URL("./effectiveAuthorityReconciliationRuntime.js", import.meta.url),
  "utf8"
);
const scheduler = readFileSync(
  new URL(
    "./src/application/effectiveAuthority/effectiveAuthorityReconciliationScheduler.js",
    import.meta.url
  ),
  "utf8"
);
const runbook = readFileSync(
  new URL("../docs/ueacp-shadow-reconciliation.md", import.meta.url),
  "utf8"
);

assert.match(
  server,
  /import \{ startEffectiveAuthorityReconciliationScheduler \} from "\.\/effectiveAuthorityReconciliationRuntime\.js";/
);
assert.match(server, /startEffectiveAuthorityReconciliationScheduler\(\)/);
assert.match(server, /ueacp_reconciliation_scheduler_start/);
assert.match(server, /ueacp_reconciliation_scheduler_start_failed/);
assert.match(server, /secrets_included: false/);
assert.match(runtime, /UEACP_SHADOW_EVIDENCE_MODE \|\| "disabled"/);
assert.match(scheduler, /UEACP_RECONCILIATION_ENABLED/);
assert.match(scheduler, /if \(!truthy\(env\.UEACP_RECONCILIATION_ENABLED\)\)/);
assert.match(scheduler, /reason: "overlap_prevented"/);
assert.match(scheduler, /UEACP_RECONCILIATION_PERSIST/);
assert.doesNotMatch(scheduler, /setTimeout\([^)]*0/);
assert.match(runbook, /scheduler is disabled by default/i);
assert.match(runbook, /legacy_runtime_authoritative=true/);
assert.match(runbook, /execution_authority_changed=false/);
assert.match(runbook, /provider_calls=false/);
assert.match(runbook, /credential_payload_reads=false/);
assert.match(runbook, /external_writes=false/);
assert.match(runbook, /secrets_included=false/);

console.log("effective authority reconciliation startup tests passed");
