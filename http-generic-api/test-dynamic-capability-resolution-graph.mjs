import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const script = readFileSync(new URL("./scripts/capability-resolution-dry-run.mjs", import.meta.url), "utf8");
const migration = readFileSync(new URL("./migrations/221_sprint67_dynamic_capability_resolution_graph.sql", import.meta.url), "utf8");
const adminCli = readFileSync(new URL("./routes/adminCliRoutes.js", import.meta.url), "utf8");
const runner = readFileSync(new URL("./scripts/governed-migration-runner.mjs", import.meta.url), "utf8");

assert.match(script, /dynamic_capability_resolution_policy_v1/);
assert.match(script, /dynamic_capability_source_tiers_v1/);
assert.match(script, /v_app_integration_capability_map/);
assert.match(script, /workspace_registry/);
assert.match(script, /v_workspace_resource_grant_effective/);
assert.match(script, /brand_core/);
assert.match(script, /business_activity_types/);
assert.match(script, /credential_bindings/);
assert.match(script, /runtime_dispatch_certification_registry/);
assert.match(script, /user_app_connections/);
assert.match(script, /runCapabilityResolutionDryRun/);
assert.match(script, /approval_required/);
assert.match(script, /quota_required/);
assert.match(script, /audit_required: true/);
assert.match(script, /certifications\.some\(\(row\) => Number\(row\.requires_readback \|\| 0\) === 1\)/);
assert.match(script, /secrets_included: false/);
assert.match(script, /This is a dry-run envelope only; no tool\/app\/runtime was executed/);
assert.doesNotMatch(script, /decryptToken|value_ciphertext|private_key|oauth_token/i);
assert.doesNotMatch(script, /fetch\(|axios|child_process|exec\(|spawn\(/);

assert.match(migration, /dynamic_capability_resolution_policy_v1/);
assert.match(migration, /dynamic_capability_source_tiers_v1/);
assert.match(migration, /capability_resolution_dry_run/);
assert.match(migration, /platform_managed_fallback/);
assert.match(migration, /requires_quota.*true|requires_quota',true/s);
assert.match(migration, /requires_audit_log.*true|requires_audit_log',true/s);
assert.match(migration, /requires_user_disclosure.*true|requires_user_disclosure',true/s);
assert.match(migration, /admin_personal_oauth_must_not_be_shared.*true|admin_personal_oauth_must_not_be_shared',true/s);
assert.match(migration, /extended_workspace_archetypes_policy_only/);
assert.match(migration, /current_workspace_type_enum/);
assert.match(migration, /no_secrets_returned/);
assert.match(migration, /must_not_include/);
assert.match(migration, /no_execution/);
assert.match(migration, /secrets_included',false/);
assert.match(migration, /admin_platform_endpoint_tools/);
assert.doesNotMatch(migration, /ALTER\s+TABLE\s+workspace_registry/i);
assert.doesNotMatch(migration, /OPENAI_API_KEY\s*[:=]|OPENROUTER_API_KEY\s*[:=]|sk-[A-Za-z0-9_\-]{12,}/i);
assert.doesNotMatch(migration, /DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i);

assert.match(adminCli, /capability_resolution_dry_run/);
assert.match(adminCli, /scripts\/capability-resolution-dry-run\.mjs/);
assert.match(runner, /221_sprint67_dynamic_capability_resolution_graph\.sql/);

const refinement = readFileSync(new URL("./migrations/222_sprint67_dynamic_capability_resolution_risk_refinement.sql", import.meta.url), "utf8");
assert.match(refinement, /source_tier_priority_high_risk/);
assert.match(refinement, /client_dedicated','remote_dedicated_runtime/);
assert.match(refinement, /low_risk_workspace_context_required/);
assert.match(refinement, /false/);
assert.match(refinement, /dynamic_capability_resolution_policy_v1/);
assert.doesNotMatch(refinement, /DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i);
assert.match(runner, /222_sprint67_dynamic_capability_resolution_risk_refinement\.sql/);

console.log("Dynamic capability resolution graph guard passed");
