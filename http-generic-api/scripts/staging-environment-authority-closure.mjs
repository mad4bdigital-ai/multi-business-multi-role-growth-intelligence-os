#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CONTRACT = "mad4b.staging-environment-authority-closure.v1";

const sourcePaths = Object.freeze({
  deployment_branch_policy: "http-generic-api/config/deployment-branch-policy.json",
  runtime_environment_invariant: "specs/020-platform-resource-identity-brand-governance/contracts/runtime-environment-invariant-contract.json",
  runtime_db_write_authority: "specs/020-platform-resource-identity-brand-governance/contracts/runtime-db-write-authority-profiles.json",
  activation_gateway_staging_policy: "edge/activation-gateway/generated/route-policy.staging.json",
  staging_compose: "http-generic-api/docker-compose.staging.yml",
  staging_dockerfile: "http-generic-api/Dockerfile.staging",
});

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`--${name} requires a value`);
  return value;
}

function readText(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function stable(values = []) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
}

function sameSet(left = [], right = []) {
  const a = stable(left);
  const b = stable(right);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function hostFromUrl(value) {
  try { return new URL(String(value || "")).hostname.toLowerCase(); }
  catch { return ""; }
}

const deployment = readJson(sourcePaths.deployment_branch_policy);
const environment = readJson(sourcePaths.runtime_environment_invariant);
const dbAuthority = readJson(sourcePaths.runtime_db_write_authority);
const gateway = readJson(sourcePaths.activation_gateway_staging_policy);
const compose = readText(sourcePaths.staging_compose);
const dockerfile = readText(sourcePaths.staging_dockerfile);
const expectedSha = String(arg("expected-sha", process.env.EXPECTED_HEAD_SHA || "")).trim().toLowerCase();
const reportFile = path.resolve(arg("report-file", path.join(root, ".artifacts/staging-environment-authority-closure/report.json")));

const issues = [];
const requireTrue = (condition, code) => { if (!condition) issues.push(code); };

requireTrue(deployment?.schema_version === "mad4b.deployment-branch-policy.v1", "deployment_branch_policy_contract_mismatch");
const staging = deployment?.staging || {};
const production = deployment?.production || {};
requireTrue(staging.source_branch === deployment?.source_of_change?.branch, "staging_source_branch_not_change_authority");
requireTrue(staging.production_traffic_allowed === false, "staging_production_traffic_must_be_false");
requireTrue(production.source_branch === deployment?.promotion?.target_branch, "production_source_branch_not_promotion_target");
requireTrue(deployment?.promotion?.source_branch === staging.source_branch, "promotion_source_not_staging_authority");
requireTrue(deployment?.promotion?.force_push_allowed === false, "promotion_force_push_must_be_false");

requireTrue(environment?.contract === "mad4b.spec020.runtime-environment-invariant.v1", "runtime_environment_contract_mismatch");
const stagingRule = (environment?.routing_rules || []).find((rule) => rule.environment_key === "staging");
const productionRule = (environment?.routing_rules || []).find((rule) => rule.environment_key === "production");
requireTrue(Boolean(stagingRule), "staging_environment_rule_missing");
requireTrue(Boolean(productionRule), "production_environment_rule_missing");
if (stagingRule) {
  requireTrue(sameSet(staging.hostnames || [], stagingRule.allowed_hosts || []), "staging_hostname_authorities_disagree");
  requireTrue(stagingRule.default_for_custom_gpt === true, "staging_default_environment_contract_missing");
  requireTrue(sameSet(stagingRule.production_hosts_forbidden || [], production.hostnames || []), "staging_forbidden_production_hosts_incomplete");
}
if (productionRule) {
  requireTrue(sameSet(production.hostnames || [], productionRule.allowed_hosts || []), "production_hostname_authorities_disagree");
  requireTrue(productionRule.explicit_selection_required === true, "production_explicit_selection_required_missing");
  requireTrue(sameSet(productionRule.staging_hosts_forbidden || [], staging.hostnames || []), "production_forbidden_staging_hosts_incomplete");
}
for (const required of [
  "environment_chain_mismatch",
  "cross_environment_credential_namespace",
  "cross_environment_provider_host",
  "implicit_production_selection",
  "production_to_staging_fallback",
  "staging_to_production_fallback",
]) requireTrue((environment?.fail_closed_conditions || []).includes(required), `environment_fail_closed_condition_missing:${required}`);
requireTrue(environment?.same_cycle_readback?.required === true, "environment_same_cycle_readback_not_required");

requireTrue(dbAuthority?.contract === "mad4b.spec020.runtime-db-write-authority-profiles.v1", "runtime_db_authority_contract_mismatch");
const registryPolicy = dbAuthority?.registry_policy || {};
for (const [key, expected] of Object.entries({
  duplicate_binding_is_invalid: true,
  unbound_write_is_fail_closed: true,
  generic_runtime_principal_fallback: false,
  schema_wide_privileges_forbidden: true,
  global_privileges_forbidden: true,
  grant_option_forbidden: true,
})) requireTrue(registryPolicy[key] === expected, `runtime_db_authority_policy_mismatch:${key}`);
const profileKeys = new Set();
const bindingKeys = new Set();
const identityPrefixes = new Set();
for (const profile of dbAuthority?.profiles || []) {
  requireTrue(Boolean(profile.profile_key), "runtime_db_profile_key_missing");
  requireTrue(!profileKeys.has(profile.profile_key), `runtime_db_profile_duplicate:${profile.profile_key}`);
  profileKeys.add(profile.profile_key);
  requireTrue((profile.environment_keys || []).includes("staging"), `runtime_db_profile_staging_missing:${profile.profile_key}`);
  requireTrue((profile.environment_keys || []).includes("production"), `runtime_db_profile_production_missing:${profile.profile_key}`);
  requireTrue(Boolean(profile.identity_env_prefix), `runtime_db_identity_prefix_missing:${profile.profile_key}`);
  if (profile.identity_env_prefix) {
    requireTrue(!identityPrefixes.has(profile.identity_env_prefix), `runtime_db_identity_prefix_duplicate:${profile.identity_env_prefix}`);
    identityPrefixes.add(profile.identity_env_prefix);
  }
  for (const binding of profile.bindings || []) {
    const key = `${profile.profile_key}:${binding.table_name}`;
    requireTrue(Boolean(binding.table_name), `runtime_db_table_binding_missing:${profile.profile_key}`);
    requireTrue(!bindingKeys.has(key), `runtime_db_binding_duplicate:${key}`);
    bindingKeys.add(key);
    requireTrue(binding.requires_same_cycle_readback === true, `runtime_db_same_cycle_readback_missing:${key}`);
    requireTrue((binding.allowed_operations || []).includes("SELECT"), `runtime_db_select_readback_missing:${key}`);
  }
}

requireTrue(gateway?.policy_key === "activation_gateway_staging", "staging_gateway_policy_key_mismatch");
requireTrue((staging.hostnames || []).includes(gateway?.public_host), "staging_gateway_host_not_in_environment_authority");
requireTrue(!(production.hostnames || []).includes(gateway?.public_host), "staging_gateway_host_overlaps_production");
requireTrue(gateway?.mutation_stale_policy === "deny", "staging_gateway_stale_mutation_policy_not_deny");
requireTrue(Number(gateway?.read_stale_grace_seconds) === 0, "staging_gateway_read_stale_grace_not_zero");
requireTrue(gateway?.deployment_signature_required === true, "staging_gateway_deployment_signature_not_required");
const gatewayUpstreamHost = hostFromUrl(gateway?.upstream_origin);
requireTrue((staging.hostnames || []).includes(gatewayUpstreamHost), "staging_gateway_upstream_not_in_staging_authority");
requireTrue(!(production.hostnames || []).includes(gatewayUpstreamHost), "staging_gateway_upstream_points_to_production");

for (const host of production.hostnames || []) {
  requireTrue(!compose.includes(host), `staging_compose_contains_production_host:${host}`);
}
requireTrue(/NODE_ENV:\s*staging/u.test(compose), "staging_compose_node_env_not_staging");
requireTrue(/DB_HOST:\s*runtime-db/u.test(compose), "staging_runtime_db_host_not_isolated");
requireTrue(/GOVERNANCE_DB_HOST:\s*governance-db/u.test(compose), "staging_governance_db_host_not_isolated");
requireTrue(/RUNTIME_PERSISTENCE_DB_HOST:\s*persistence-db/u.test(compose), "staging_persistence_db_host_not_isolated");
requireTrue(/PRODUCTION_MUTATION_AUTHORIZED:\s*["']?false["']?/u.test(compose), "staging_production_mutation_flag_not_false");
requireTrue(/RULESET_MUTATION_AUTHORIZED:\s*["']?false["']?/u.test(compose), "staging_ruleset_mutation_flag_not_false");
requireTrue(/STAGING_BUILD_COMMIT/u.test(compose), "staging_build_commit_arg_missing");
requireTrue(/STAGING_BUILD_BRANCH/u.test(compose), "staging_build_branch_arg_missing");
requireTrue(/STAGING_BUILD_COMMIT/u.test(dockerfile), "staging_dockerfile_commit_provenance_missing");
requireTrue(/deployment-manifest\.json/u.test(dockerfile), "staging_dockerfile_deployment_manifest_missing");
requireTrue(/staging-route-policy\.json/u.test(dockerfile), "staging_gateway_policy_not_baked_into_image");

const sourceFingerprints = Object.fromEntries(Object.entries(sourcePaths).map(([key, relativePath]) => [key, {
  path: relativePath,
  sha256: sha256(readText(relativePath)),
}]));

const report = {
  contract: CONTRACT,
  generated_at: new Date().toISOString(),
  expected_head_sha: /^[0-9a-f]{40}$/u.test(expectedSha) ? expectedSha : null,
  staging_authority: {
    source_branch: staging.source_branch || null,
    hostnames: stable(staging.hostnames || []),
    deployment_mode: staging.deployment_mode || null,
    production_traffic_allowed: staging.production_traffic_allowed === true,
  },
  production_authority: {
    source_branch: production.source_branch || null,
    hostnames: stable(production.hostnames || []),
  },
  gateway: {
    public_host: gateway?.public_host || null,
    upstream_host: gatewayUpstreamHost || null,
    policy_hash: gateway?.content_hash_sha256 || null,
    mutation_stale_policy: gateway?.mutation_stale_policy || null,
    read_stale_grace_seconds: Number(gateway?.read_stale_grace_seconds || 0),
  },
  db_authority: {
    contract_status: dbAuthority?.status || null,
    authority: dbAuthority?.authority || null,
    profile_count: profileKeys.size,
    binding_count: bindingKeys.size,
    generic_runtime_principal_fallback: registryPolicy.generic_runtime_principal_fallback === true,
  },
  environment_contract: {
    status: environment?.status || null,
    authority: environment?.authority || null,
    same_cycle_readback_required: environment?.same_cycle_readback?.required === true,
  },
  source_fingerprints: sourceFingerprints,
  issue_count: issues.length,
  issues: stable(issues),
  converged: issues.length === 0,
  safety: {
    read_only: true,
    database_mutation: false,
    migration_apply: false,
    provider_mutation: false,
    production_deploy: false,
    ruleset_mutation: false,
    secrets_included: false,
  },
};

fs.mkdirSync(path.dirname(reportFile), { recursive: true });
fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ contract: CONTRACT, converged: report.converged, issue_count: issues.length, report_file: reportFile }));
if (!report.converged) process.exitCode = 1;
