import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const script = readFileSync(new URL("./scripts/capability-resolution-simulation-suite.mjs", import.meta.url), "utf8");
const migration = readFileSync(new URL("./migrations/223_sprint67_dynamic_capability_simulation_suite.sql", import.meta.url), "utf8");
const adminCli = readFileSync(new URL("./routes/adminCliRoutes.js", import.meta.url), "utf8");
const runner = readFileSync(new URL("./scripts/governed-migration-runner.mjs", import.meta.url), "utf8");

assert.match(script, /dynamic_capability_use_case_simulation_suite_v1/);
assert.match(script, /runCapabilityResolutionSimulationSuite/);
assert.match(script, /v_app_integration_capability_map/);
assert.match(script, /Simulation suite is policy-only/);
assert.match(script, /secrets_included: false/);
assert.match(script, /policy_gap/);
assert.match(script, /registry_gap/);
assert.doesNotMatch(script, /decryptToken|value_ciphertext|private_key|oauth_token/i);
assert.doesNotMatch(script, /fetch\(|axios|child_process|exec\(|spawn\(/);

assert.match(migration, /dynamic_capability_use_case_simulation_suite_v1/);
assert.match(migration, /capability_resolution_simulation_suite/);
assert.match(migration, /freelancer_wordpress_publish_managed_service/);
assert.match(migration, /client_owned_wordpress_publish_dedicated/);
assert.match(migration, /codex_user_owned_local_review/);
assert.match(migration, /codex_platform_managed_fallback_review/);
assert.match(migration, /remote_ssh_production_deploy/);
assert.match(migration, /hostinger_dns_update/);
assert.match(migration, /github_docs_pr_platform_managed/);
assert.match(migration, /google_analytics_read_brand_dashboard/);
assert.match(migration, /google_ads_budget_change/);
assert.match(migration, /google_tag_manager_publish/);
assert.match(migration, /n8n_activate_workflow/);
assert.match(migration, /make_mcp_trigger_read_only/);
assert.match(migration, /browser_visual_inspection/);
assert.match(migration, /custom_api_webhook_write/);
assert.match(migration, /workspace_enum_expansion/);
assert.match(migration, /defer_until_impact_review/);
assert.match(migration, /budget_and_quota_authority_registry/);
assert.match(migration, /capability_resolution_envelope_ledger/);
assert.match(migration, /no_execution',true/);
assert.match(migration, /secrets_included',false/);
assert.match(migration, /requires_user_disclosure/);
assert.match(migration, /quota_required/);
assert.match(migration, /audit_required/);
assert.doesNotMatch(migration, /ALTER\s+TABLE\s+workspace_registry/i);
assert.doesNotMatch(migration, /OPENAI_API_KEY\s*[:=]|OPENROUTER_API_KEY\s*[:=]|sk-[A-Za-z0-9_\-]{12,}/i);
assert.doesNotMatch(migration, /DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i);

assert.match(adminCli, /capability_resolution_simulation_suite/);
assert.match(adminCli, /scripts\/capability-resolution-simulation-suite\.mjs/);
assert.match(runner, /223_sprint67_dynamic_capability_simulation_suite\.sql/);

console.log("Dynamic capability simulation suite guard passed");
