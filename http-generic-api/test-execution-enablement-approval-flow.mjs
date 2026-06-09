import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const request = readFileSync(new URL("./scripts/execution-enablement-request.mjs", import.meta.url), "utf8");
const approve = readFileSync(new URL("./scripts/execution-enablement-approve.mjs", import.meta.url), "utf8");
const revoke = readFileSync(new URL("./scripts/execution-enablement-revoke.mjs", import.meta.url), "utf8");
const migration = readFileSync(new URL("./migrations/249_sprint67_execution_enablement_approval_flow.sql", import.meta.url), "utf8");
const adminCli = readFileSync(new URL("./routes/adminCliRoutes.js", import.meta.url), "utf8");
const runner = readFileSync(new URL("./scripts/governed-migration-runner.mjs", import.meta.url), "utf8");

for (const source of [request, approve, revoke]) {
  assert.match(source, /execution_enablement/);
  assert.match(source, /secrets_included: false/);
  assert.doesNotMatch(source, /fetch\(|axios|GoogleAdsApi|GoogleAdsClient|mutateCampaignBudgets|mutate\(|child_process|exec\(|spawn\(/i);
  assert.doesNotMatch(source, /GOOGLE_APPLICATION_CREDENTIALS|GOOGLE_ADS_TOKEN|GOOGLE_ADS_DEVELOPER_TOKEN|refresh_token|client_secret|private_key|value_ciphertext|decryptToken|encrypted_credentials/i);
}

assert.match(request, /execution_enablement_requests/);
assert.match(request, /approval_holds/);
assert.match(request, /pending_approval/);
assert.match(approve, /execution_enablement_registry/);
assert.match(approve, /execution_enabled/);
assert.match(approve, /pending_approval/);
assert.match(revoke, /execution_enabled=0/);
assert.match(revoke, /status='disabled'/);

assert.match(migration, /CREATE TABLE IF NOT EXISTS execution_enablement_requests/);
assert.match(migration, /chk_execution_enablement_request_no_secrets/);
assert.match(migration, /execution_enablement_approval_flow_policy_v1/);
assert.match(migration, /execution_enablement_request/);
assert.match(migration, /execution_enablement_approve/);
assert.match(migration, /execution_enablement_revoke/);
assert.match(migration, /requires_approval_hold',true/);
assert.match(migration, /approved_rows_are_scoped_and_expiring',true/);
assert.match(migration, /does_not_execute_target_capability',true/);
assert.match(migration, /no_provider_call',true/);
assert.match(migration, /no_spend_change',true/);
assert.match(migration, /secrets_included',false/);
assert.doesNotMatch(migration, /DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i);
assert.doesNotMatch(migration, /GOOGLE_APPLICATION_CREDENTIALS|GOOGLE_ADS_TOKEN|GOOGLE_ADS_DEVELOPER_TOKEN|OPENAI_API_KEY\s*[:=]|OPENROUTER_API_KEY\s*[:=]|sk-[A-Za-z0-9_\-]{12,}/i);

assert.match(adminCli, /execution_enablement_request/);
assert.match(adminCli, /execution_enablement_approve/);
assert.match(adminCli, /execution_enablement_revoke/);
assert.match(runner, /249_sprint67_execution_enablement_approval_flow\.sql/);

console.log("Execution enablement approval flow guard passed");
