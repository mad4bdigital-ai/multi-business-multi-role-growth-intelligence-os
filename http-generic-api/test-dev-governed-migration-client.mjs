import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertDevDbStatus,
  isToolMutation,
  parseArgs,
  resolveApplyAuthoritySource,
  sanitizeResult,
  validateDevBaseUrl,
  validateGovernanceResolveContextArgs,
  validateGrowthIntelligenceActionDecisionArgs,
  validateGrowthIntelligenceInsightDecisionArgs,
  validateGrowthIntelligenceReportReadArgs,
  validateGrowthIntelligencePilotArgs,
  validateGrowthIntelligenceReadinessRefreshArgs,
  validateShellAliasInvocation,
} from "./scripts/dev-governed-migration-client.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));

assert.equal(validateDevBaseUrl("https://dev.mad4b.com"), "https://dev.mad4b.com");
assert.equal(validateDevBaseUrl("https://dev.mad4b.com/"), "https://dev.mad4b.com");
for (const blocked of [
  "http://dev.mad4b.com",
  "https://auth.mad4b.com",
  "https://evil.dev.mad4b.com",
  "https://user:pass@dev.mad4b.com",
  "https://dev.mad4b.com/path",
  "https://dev.mad4b.com?token=blocked",
]) {
  assert.throws(() => validateDevBaseUrl(blocked));
}

assert.deepEqual(assertDevDbStatus({
  status: 200,
  body: { ok: true, db_name: "u338416126_growthOS_dev", table_count: 497, row_count: 100 },
}), {
  db_name: "u338416126_growthOS_dev",
  table_count: 497,
  row_count: 100,
});
assert.throws(
  () => assertDevDbStatus({ status: 200, body: { ok: true, db_name: "u338416126_growthOS" } }),
  /not dev-scoped/
);

assert.deepEqual(parseArgs([
  "--action=tool-call",
  "--tool=governed_migration_execute",
  "--apply",
]), {
  action: "tool-call",
  base_url: "https://dev.mad4b.com",
  tool: "governed_migration_execute",
  apply: true,
});

const safePilotArgs = {
  tenant_id: "11111111-1111-4111-8111-111111111111",
  brand_key: "pilot_brand",
  business_activity_type_key: "saas",
  persistence_mode: "internal_registry",
  outbox_mode: "dev_transactional",
  evidence_limit: 20,
  report_id: "pilot-report-1",
  requested_by: "growth-platform-admin",
};
assert.equal(validateGrowthIntelligencePilotArgs(safePilotArgs), safePilotArgs);
assert.equal(isToolMutation("growth_intelligence_pilot_run", safePilotArgs), true);
assert.equal(resolveApplyAuthoritySource({
  args: { apply: true },
  action: "tool-call",
  target: "growth_intelligence_pilot_run",
  payload: safePilotArgs,
  env: { DEV_MIGRATION_APPLY_ENABLED: "true" },
}), "environment_flag");
assert.throws(() => resolveApplyAuthoritySource({
  args: {},
  action: "tool-call",
  target: "growth_intelligence_pilot_run",
  payload: safePilotArgs,
  env: { DEV_MIGRATION_APPLY_ENABLED: "true" },
}), /requires --apply/);
for (const blockedPilotArgs of [
  { ...safePilotArgs, persistence_mode: "external" },
  { ...safePilotArgs, outbox_mode: "disabled" },
  { ...safePilotArgs, external_send: true },
  { ...safePilotArgs, tenant_id: "not-a-uuid" },
  { ...safePilotArgs, evidence_limit: 51 },
]) {
  assert.throws(() => validateGrowthIntelligencePilotArgs(blockedPilotArgs));
}

const safeGovernanceContextArgs = {
  business_type_key: "hvac_air_conditioning_services",
  brand_key: "arab_cooling",
  target_key: "arab_cooling",
};
assert.equal(validateGovernanceResolveContextArgs(safeGovernanceContextArgs), safeGovernanceContextArgs);
assert.equal(isToolMutation("governance_resolve_context", safeGovernanceContextArgs), false);
for (const blockedContextArgs of [
  { ...safeGovernanceContextArgs, data_source: "sql" },
  { ...safeGovernanceContextArgs, business_type_key: "" },
  { ...safeGovernanceContextArgs, brand_key: "bad brand" },
  { ...safeGovernanceContextArgs, target_key: "../target" },
  { business_type_key: "hvac_air_conditioning_services", brand_key: "arab_cooling" },
]) {
  assert.throws(() => validateGovernanceResolveContextArgs(blockedContextArgs));
}

const safeReportReadArgs = {
  tenant_id: "4bc39fca-270e-4daa-b373-db75e1f36ccd",
  report_id: "pilot-allroyalegypt-20260718-1",
};
assert.equal(validateGrowthIntelligenceReportReadArgs(safeReportReadArgs), safeReportReadArgs);
assert.equal(isToolMutation("growth_intelligence_report_read", safeReportReadArgs), false);
for (const blockedReportReadArgs of [
  { ...safeReportReadArgs, decision: "accepted" },
  { ...safeReportReadArgs, tenant_id: "not-a-uuid" },
  { ...safeReportReadArgs, report_id: "" },
  { ...safeReportReadArgs, report_id: "../report" },
  { tenant_id: safeReportReadArgs.tenant_id },
]) {
  assert.throws(() => validateGrowthIntelligenceReportReadArgs(blockedReportReadArgs));
}

const decisionBy = "f242960c-2857-4b4d-a504-ee50f8a278b4";
const safeInsightDecisionArgs = {
  tenant_id: safeReportReadArgs.tenant_id,
  report_id: safeReportReadArgs.report_id,
  insight_id: "opp_54b844a667dda0d6",
  decision: "accepted",
  decision_by: decisionBy,
  decision_note: "Approved by the typed review bundle.",
};
assert.equal(validateGrowthIntelligenceInsightDecisionArgs(safeInsightDecisionArgs), safeInsightDecisionArgs);
assert.equal(isToolMutation("growth_intelligence_insight_decide", safeInsightDecisionArgs), true);
for (const blockedInsightDecisionArgs of [
  { ...safeInsightDecisionArgs, external_send: true },
  { ...safeInsightDecisionArgs, decision: "approved" },
  { ...safeInsightDecisionArgs, insight_id: "../insight" },
  { ...safeInsightDecisionArgs, decision_by: "growth-platform-admin" },
  { ...safeInsightDecisionArgs, decision_note: "bad\nline" },
]) {
  assert.throws(() => validateGrowthIntelligenceInsightDecisionArgs(blockedInsightDecisionArgs));
}

const safeActionDecisionArgs = {
  tenant_id: safeReportReadArgs.tenant_id,
  report_id: safeReportReadArgs.report_id,
  action_id: "action_089de9a424c80ca0",
  decision: "approved",
  decision_by: decisionBy,
  decision_note: "Approved as an internal dry-run plan only.",
};
assert.equal(validateGrowthIntelligenceActionDecisionArgs(safeActionDecisionArgs), safeActionDecisionArgs);
assert.equal(isToolMutation("growth_intelligence_action_decide", safeActionDecisionArgs), true);
for (const blockedActionDecisionArgs of [
  { ...safeActionDecisionArgs, execute: true },
  { ...safeActionDecisionArgs, decision: "accepted" },
  { ...safeActionDecisionArgs, action_id: "" },
  { ...safeActionDecisionArgs, tenant_id: "not-a-uuid" },
]) {
  assert.throws(() => validateGrowthIntelligenceActionDecisionArgs(blockedActionDecisionArgs));
}

const safeReadinessArgs = {
  tenant_id: safeReportReadArgs.tenant_id,
  report_id: safeReportReadArgs.report_id,
  assessed_by: "growth-platform-admin",
};
assert.equal(validateGrowthIntelligenceReadinessRefreshArgs(safeReadinessArgs), safeReadinessArgs);
assert.equal(isToolMutation("growth_intelligence_readiness_refresh", safeReadinessArgs), true);
for (const blockedReadinessArgs of [
  { ...safeReadinessArgs, execution_allowed: true },
  { ...safeReadinessArgs, assessed_by: "bad assessor" },
  { ...safeReadinessArgs, report_id: "../report" },
]) {
  assert.throws(() => validateGrowthIntelligenceReadinessRefreshArgs(blockedReadinessArgs));
}

const capabilityEnvelopeId = "70891f74-0200-4942-843e-18cf4ba6643a";
assert.equal(resolveApplyAuthoritySource({
  args: { apply: true },
  action: "shell-alias",
  target: "capability_resolution_envelope_create",
  payload: null,
  env: { DEV_MIGRATION_APPLY_ENABLED: "true" },
}), "environment_flag");
assert.equal(resolveApplyAuthoritySource({
  args: { apply: true },
  action: "tool-call",
  target: "governed_migration_authorization_bootstrap",
  payload: { capability_envelope_id: capabilityEnvelopeId },
  env: {},
}), "capability_envelope");
assert.equal(resolveApplyAuthoritySource({
  args: { apply: true },
  action: "tool-call",
  target: "capability_resolution_envelope_apply_authorize",
  payload: { envelope_id: capabilityEnvelopeId },
  env: {},
}), "capability_envelope");
assert.throws(() => resolveApplyAuthoritySource({
  args: { apply: true },
  action: "tool-call",
  target: "governed_migration_execute",
  payload: { capability_envelope_id: "not-a-uuid" },
  env: {},
}), /valid persisted capability envelope identifier/);
assert.throws(() => resolveApplyAuthoritySource({
  args: { apply: true },
  action: "shell-alias",
  target: "capability_resolution_envelope_approve",
  payload: { envelope_id: capabilityEnvelopeId },
  env: {},
}), /valid persisted capability envelope identifier/);
assert.throws(() => resolveApplyAuthoritySource({
  args: {},
  action: "tool-call",
  target: "governed_migration_execute",
  payload: { capability_envelope_id: capabilityEnvelopeId },
  env: {},
}), /requires --apply/);

assert.deepEqual(
  validateShellAliasInvocation("platform_outbox_worker", ["--action=status"]),
  { mutation_requested: false, extra_args: ["--action=status"] }
);
assert.deepEqual(
  validateShellAliasInvocation("platform_outbox_worker", [
    "--action=dry-run",
    "--consumer=prod_shadow_v1",
    "--limit=100",
  ]),
  {
    mutation_requested: false,
    extra_args: ["--action=dry-run", "--consumer=prod_shadow_v1", "--limit=100"],
  }
);
assert.deepEqual(
  validateShellAliasInvocation("capability_resolution_envelope_create", []),
  { mutation_requested: true, extra_args: [] }
);
for (const blockedArgs of [
  ["--action=run-once"],
  ["--action=loop"],
  ["--action=status", "--apply"],
  ["--action=status", "--limit=0"],
  ["--action=status", "--limit=501"],
  ["--action=status", "--consumer=bad consumer"],
  ["--action=status", "--unknown=value"],
]) {
  assert.throws(() => validateShellAliasInvocation("platform_outbox_worker", blockedArgs));
}

assert.deepEqual(sanitizeResult({
  ok: true,
  nested: {
    access_token: "must-not-leak",
    password: "must-not-leak",
    migration: "safe.sql",
  },
}), {
  ok: true,
  nested: {
    access_token: "[redacted]",
    password: "[redacted]",
    migration: "safe.sql",
  },
});

const source = await fs.readFile(path.join(root, "scripts", "dev-governed-migration-client.mjs"), "utf8");
assert.match(source, /dev\.mad4b\.com/);
assert.match(source, /endsWith\("_dev"\)/);
assert.match(source, /DEV_MIGRATION_APPLY_ENABLED/);
assert.match(source, /redirect: "error"/);
assert.match(source, /governed_migration_execute/);
assert.match(source, /governed_migration_schema_readback/);
assert.match(source, /growth_intelligence_insight_decide/);
assert.match(source, /growth_intelligence_action_decide/);
assert.match(source, /growth_intelligence_readiness_refresh/);
assert.match(source, /capability_resolution_envelope_create/);
assert.match(source, /capability_resolution_envelope_approve/);
assert.doesNotMatch(source, /restore-from-backup/);
assert.doesNotMatch(source, /tool:\s*["']db["']/);
assert.doesNotMatch(source, /\bsql\s*:/i);

const applyWrapper = await fs.readFile(path.join(root, "scripts", "dev-governed-migration-client-apply.mjs"), "utf8");
assert.match(applyWrapper, /DEV_MIGRATION_APPLY_ENABLED:\s*"true"/);
assert.match(applyWrapper, /spawn\(process\.execPath/);
assert.match(applyWrapper, /shell:\s*false/);
assert.match(applyWrapper, /stdio:\s*"inherit"/);
assert.match(applyWrapper, /dev-governed-migration-client\.mjs/);
assert.doesNotMatch(applyWrapper, /exec\(|execSync\(|shell:\s*true/);

const adminCli = await fs.readFile(path.join(root, "routes", "adminCliRoutes.js"), "utf8");
assert.match(adminCli, /dev_governed_migration_client/);
assert.match(adminCli, /dev-governed-migration-client\.mjs/);
assert.match(adminCli, /dev_governed_migration_client_apply/);
assert.match(adminCli, /dev-governed-migration-client-apply\.mjs/);

const packageJson = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
assert.equal(packageJson.scripts["dev:migration:probe"], "node scripts/dev-governed-migration-client.mjs --action=probe");
assert.equal(packageJson.scripts["dev:migration:client"], "node scripts/dev-governed-migration-client.mjs");
assert.equal(packageJson.scripts["dev:migration:status"], "node scripts/dev-governed-migration-client.mjs --action=status");
assert.equal(
  packageJson.scripts["dev:outbox:status"],
  "node scripts/dev-governed-migration-client.mjs --action=shell-alias --alias=platform_outbox_worker --extra-args-base64=WyItLWFjdGlvbj1zdGF0dXMiXQ=="
);
assert.equal(
  packageJson.scripts["dev:outbox:dry-run"],
  "node scripts/dev-governed-migration-client.mjs --action=shell-alias --alias=platform_outbox_worker --extra-args-base64=WyItLWFjdGlvbj1kcnktcnVuIl0="
);

console.log("dev governed migration and outbox read-only client contract tests passed");
