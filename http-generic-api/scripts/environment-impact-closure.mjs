#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CONTRACT = "mad4b.environment-impact-closure.v1";
const SHA_RE = /^[0-9a-f]{40}$/u;

const sourcePaths = Object.freeze({
  deployment_branch_policy: "http-generic-api/config/deployment-branch-policy.json",
  domain_family_policy: "http-generic-api/config/domain-family-policy.json",
  runtime_environment_invariant: "specs/020-platform-resource-identity-brand-governance/contracts/runtime-environment-invariant-contract.json",
  runtime_db_write_authority: "specs/020-platform-resource-identity-brand-governance/contracts/runtime-db-write-authority-profiles.json",
  runtime_database_readiness: "specs/020-platform-resource-identity-brand-governance/contracts/runtime-database-readiness-contract.json",
  activation_gateway_staging_policy: "edge/activation-gateway/generated/route-policy.staging.json",
  e2e_contract: ".changes/e2e/staging-autopilot-oauth-certification-maintenance.json",
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

function hostFromUrl(value) {
  try { return new URL(String(value || "")).hostname.toLowerCase(); }
  catch { return ""; }
}

function globToRegExp(pattern) {
  const normalized = String(pattern || "").replaceAll("\\", "/");
  let expression = "^";
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    const next = normalized[index + 1];
    if (character === "*" && next === "*") {
      expression += ".*";
      index += 1;
    } else if (character === "*") {
      expression += "[^/]*";
    } else if (character === "?") {
      expression += "[^/]";
    } else {
      expression += character.replace(/[|\\{}()[\]^$+?.]/gu, "\\$&");
    }
  }
  return new RegExp(`${expression}$`, "u");
}

function classifyPath(filePath, pathClasses = []) {
  const normalized = String(filePath || "").replaceAll("\\", "/");
  const matches = [];
  for (const pathClass of pathClasses) {
    if ((pathClass.patterns || []).some((pattern) => globToRegExp(pattern).test(normalized))) {
      matches.push(pathClass);
    }
  }
  return matches;
}

function changedPaths(baseSha, headSha) {
  if (!SHA_RE.test(baseSha) || !SHA_RE.test(headSha) || baseSha === headSha) return [];
  const output = requireGitNameStatus(baseSha, headSha);
  return output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [status, ...parts] = line.split(/\s+/u);
      const paths = parts.filter(Boolean);
      return {
        status,
        path: paths.at(-1) || "",
        previous_path: status.startsWith("R") || status.startsWith("C") ? paths.at(-2) || null : null,
      };
    });
}

function requireGitNameStatus(baseSha, headSha) {
  return execFileSync("git", ["diff", "--name-status", "--find-renames", baseSha, headSha], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function migrationEvidence(readinessContract) {
  const requiredField = readinessContract?.required_preflight_evidence?.tool_catalog_schema?.required_field;
  const migrationDir = path.join(root, "http-generic-api/migrations");
  const candidates = fs.readdirSync(migrationDir)
    .filter((name) => name.endsWith(".sql"))
    .map((name) => path.join(migrationDir, name))
    .filter((filePath) => fs.readFileSync(filePath, "utf8").includes(String(requiredField || "")));
  const evidence = candidates.map((filePath) => {
    const relativePath = path.relative(root, filePath).replaceAll("\\", "/");
    return { path: relativePath, sha256: sha256(fs.readFileSync(filePath)) };
  });
  return {
    required_field: requiredField || null,
    matching_migration_count: evidence.length,
    migrations: evidence.sort((left, right) => left.path.localeCompare(right.path)),
  };
}

function buildReport({ baseSha = null, headSha = null } = {}) {
  const deployment = readJson(sourcePaths.deployment_branch_policy);
  const domain = readJson(sourcePaths.domain_family_policy);
  const environment = readJson(sourcePaths.runtime_environment_invariant);
  const dbAuthority = readJson(sourcePaths.runtime_db_write_authority);
  const readiness = readJson(sourcePaths.runtime_database_readiness);
  const gateway = readJson(sourcePaths.activation_gateway_staging_policy);
  const e2e = readJson(sourcePaths.e2e_contract);
  const policy = deployment.environment_impact || {};
  const issues = [];
  const addIssue = (code, detail = null) => issues.push({ code, detail });
  const expect = (condition, code, detail = null) => { if (!condition) addIssue(code, detail); };

  expect(policy.schema_version === "mad4b.environment-impact-policy.v1", "environment_impact_policy_contract_mismatch");
  expect(deployment.source_of_change?.branch === deployment.staging?.source_branch, "staging_source_branch_mismatch");
  expect(deployment.promotion?.target_branch === deployment.production?.source_branch, "production_target_branch_mismatch");
  expect(deployment.staging?.production_traffic_allowed === false, "staging_production_traffic_not_false");
  expect(deployment.staging?.hostnames?.length > 0, "staging_hostnames_missing");
  expect(deployment.production?.hostnames?.length > 0, "production_hostnames_missing");

  const domainEnvironments = domain.environments || {};
  const stagingDomain = domainEnvironments.staging || {};
  const productionDomain = domainEnvironments.production || {};
  const stagingHosts = stable(deployment.staging?.hostnames || []);
  const productionHosts = stable(deployment.production?.hostnames || []);
  const stagingDomainHosts = stable(Object.values(stagingDomain.hostnames || {}).map((entry) => entry.hostname));
  const productionDomainHosts = stable(Object.values(productionDomain.hostnames || {}).map((entry) => entry.hostname));
  expect(JSON.stringify(stagingHosts) === JSON.stringify(stagingDomainHosts), "staging_branch_domain_hosts_disagree", { deployment: stagingHosts, domain: stagingDomainHosts });
  expect(JSON.stringify(productionHosts) === JSON.stringify(productionDomainHosts), "production_branch_domain_hosts_disagree", { deployment: productionHosts, domain: productionDomainHosts });
  expect(stagingHosts.every((host) => !productionHosts.includes(host)), "staging_production_hostname_overlap");
  expect(domain.routing_authority?.mismatch_action === "deny_and_do_not_fallback", "domain_mismatch_fallback_not_denied");
  expect((domain.isolation_rules || []).includes("production_credentials_must_not_appear_in_staging_environment"), "production_credentials_staging_isolation_missing");
  expect((domain.isolation_rules || []).includes("staging_tunnel_token_must_not_appear_in_production_environment"), "staging_credentials_production_isolation_missing");

  const rules = environment.routing_rules || [];
  const stagingRule = rules.find((rule) => rule.environment_key === "staging");
  const productionRule = rules.find((rule) => rule.environment_key === "production");
  expect(Boolean(stagingRule), "staging_runtime_environment_rule_missing");
  expect(Boolean(productionRule), "production_runtime_environment_rule_missing");
  if (stagingRule) {
    expect(JSON.stringify(stable(stagingRule.allowed_hosts)) === JSON.stringify(stagingHosts), "staging_runtime_domain_hosts_disagree");
    expect(stagingRule.default_for_custom_gpt === true, "staging_default_selection_missing");
  }
  if (productionRule) {
    expect(JSON.stringify(stable(productionRule.allowed_hosts)) === JSON.stringify(productionHosts), "production_runtime_domain_hosts_disagree");
    expect(productionRule.explicit_selection_required === true, "production_explicit_selection_missing");
  }
  expect(environment.invariant === "requested_environment == resolved_environment == credential_environment == provider_host_environment", "environment_chain_invariant_missing");
  for (const condition of [
    "environment_chain_mismatch",
    "cross_environment_credential_namespace",
    "cross_environment_provider_host",
    "implicit_production_selection",
    "production_to_staging_fallback",
    "staging_to_production_fallback",
  ]) expect((environment.fail_closed_conditions || []).includes(condition), `environment_fail_closed_missing:${condition}`);

  const registryPolicy = dbAuthority.registry_policy || {};
  for (const [key, expected] of Object.entries({
    duplicate_binding_is_invalid: true,
    unbound_write_is_fail_closed: true,
    generic_runtime_principal_fallback: false,
    schema_wide_privileges_forbidden: true,
    global_privileges_forbidden: true,
    grant_option_forbidden: true,
  })) expect(registryPolicy[key] === expected, `db_authority_policy_mismatch:${key}`);
  const profileKeys = new Set();
  const identityPrefixes = new Set();
  for (const profile of dbAuthority.profiles || []) {
    expect(!profileKeys.has(profile.profile_key), `duplicate_db_profile:${profile.profile_key}`);
    profileKeys.add(profile.profile_key);
    expect((profile.environment_keys || []).includes("staging"), `db_profile_missing_staging:${profile.profile_key}`);
    expect((profile.environment_keys || []).includes("production"), `db_profile_missing_production:${profile.profile_key}`);
    expect(Boolean(profile.identity_env_prefix), `db_profile_identity_prefix_missing:${profile.profile_key}`);
    if (profile.identity_env_prefix) {
      expect(!identityPrefixes.has(profile.identity_env_prefix), `duplicate_db_identity_prefix:${profile.identity_env_prefix}`);
      identityPrefixes.add(profile.identity_env_prefix);
    }
  }
  expect(readiness.status === "prepared-only", "runtime_database_readiness_status_changed_without_activation_authority");
  expect(readiness.runtime_mutation_allowed === false, "runtime_database_mutation_not_false");
  expect(readiness.production_activation_allowed === false, "runtime_database_production_activation_not_false");
  const migration = migrationEvidence(readiness);
  expect(migration.matching_migration_count === 1, "required_schema_field_migration_not_unique", migration);
  expect(readiness.required_preflight_evidence?.tool_catalog_schema?.required_evidence?.includes("migration checksum is recorded"), "migration_checksum_evidence_requirement_missing");
  expect(readiness.required_preflight_evidence?.activation_gate?.hard_activation_blocked_until_all_required_evidence === true, "hard_activation_block_not_declared");

  const gatewayHost = hostFromUrl(gateway.upstream_origin);
  expect(stagingHosts.includes(gateway.public_host), "gateway_public_host_outside_staging");
  expect(stagingHosts.includes(gatewayHost), "gateway_upstream_outside_staging");
  expect(!productionHosts.includes(gateway.public_host) && !productionHosts.includes(gatewayHost), "gateway_overlaps_production");
  expect(gateway.mutation_stale_policy === "deny", "gateway_stale_mutation_not_denied");
  expect(Number(gateway.read_stale_grace_seconds) === 0, "gateway_read_stale_grace_not_zero");
  expect(gateway.deployment_signature_required === true, "gateway_deployment_signature_not_required");

  const declaredImpact = e2e.environment_impact || {};
  const declaredTargets = stable(declaredImpact.declared_targets || []);
  const pathChanges = changedPaths(baseSha, headSha);
  const pathClasses = policy.path_classes || [];
  const classifiedChanges = pathChanges.map((change) => ({
    ...change,
    classes: classifyPath(change.path, pathClasses).map((item) => item.id),
  }));
  const stagingOnly = classifiedChanges.filter((change) => change.classes.includes("staging_only"));
  const productionOnly = classifiedChanges.filter((change) => change.classes.includes("production_only"));
  const shared = classifiedChanges.filter((change) => change.classes.includes("shared_runtime"));
  expect(policy.collision_rules?.some((rule) => rule.id === "staging-production-path-overlap" && rule.effect === "block"), "staging_production_collision_rule_missing");
  expect(policy.collision_rules?.some((rule) => rule.id === "shared-runtime-requires-staging-certification" && rule.effect === "require"), "shared_runtime_certification_rule_missing");
  if (stagingOnly.length && productionOnly.length) {
    expect(declaredImpact.cross_environment_reviewed === true, "cross_environment_change_not_explicitly_reviewed", { staging_only: stagingOnly, production_only: productionOnly });
    expect(declaredTargets.includes("staging") && declaredTargets.includes("production"), "cross_environment_targets_incomplete", declaredTargets);
  }
  if ((stagingOnly.length || shared.length) && declaredTargets.length > 0) {
    expect(declaredTargets.includes("staging"), "staging_impact_missing_from_e2e_contract");
  }
  if (productionOnly.length) {
    expect(declaredTargets.includes("production"), "production_impact_missing_from_e2e_contract");
  }

  const sourceFingerprints = Object.fromEntries(Object.entries(sourcePaths).map(([key, relativePath]) => [key, {
    path: relativePath,
    sha256: sha256(readText(relativePath)),
  }]));
  return {
    contract: CONTRACT,
    generated_at: new Date().toISOString(),
    expected_head_sha: SHA_RE.test(headSha || "") ? headSha : null,
    base_sha: SHA_RE.test(baseSha || "") ? baseSha : null,
    source_of_truth: sourcePaths,
    environment_authority: {
      staging: { branch: deployment.staging?.source_branch || null, hosts: stagingHosts, credential_namespace: stagingDomain.credential_namespace || null },
      production: { branch: deployment.production?.source_branch || null, hosts: productionHosts, credential_namespace: productionDomain.credential_namespace || null },
    },
    schema_compatibility: migration,
    db_authority: {
      contract: dbAuthority.contract || null,
      profile_count: profileKeys.size,
      identity_prefix_count: identityPrefixes.size,
      generic_runtime_principal_fallback: registryPolicy.generic_runtime_principal_fallback === true,
    },
    gateway: {
      policy_key: gateway.policy_key || null,
      public_host: gateway.public_host || null,
      upstream_host: gatewayHost || null,
      policy_hash: gateway.content_hash_sha256 || null,
      stale_mutation_policy: gateway.mutation_stale_policy || null,
    },
    changed_paths: classifiedChanges,
    path_impact_summary: {
      staging_only: stagingOnly.map((change) => change.path),
      production_only: productionOnly.map((change) => change.path),
      shared_runtime: shared.map((change) => change.path),
      unclassified: classifiedChanges.filter((change) => change.classes.length === 0).map((change) => change.path),
    },
    declared_environment_impact: {
      targets: declaredTargets,
      cross_environment_reviewed: declaredImpact.cross_environment_reviewed === true,
      live_staging_certification_required: declaredImpact.live_staging_certification_required === true,
      production_mutation_allowed: declaredImpact.production_mutation_allowed === true,
    },
    issue_count: issues.length,
    issues,
    converged: issues.length === 0,
    safety: {
      read_only: true,
      database_mutation: false,
      migration_apply: false,
      provider_mutation: false,
      production_deploy: false,
      ruleset_mutation: false,
      credential_payload_read: false,
      secrets_included: false,
    },
  };
}

export { buildReport, classifyPath, globToRegExp };

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("environment-impact-closure.mjs")) {
  const baseSha = String(arg("base-sha", process.env.BASE_SHA || "")).trim().toLowerCase() || null;
  const headSha = String(arg("head-sha", process.env.HEAD_SHA || process.env.EXPECTED_HEAD_SHA || "")).trim().toLowerCase() || null;
  const reportFile = path.resolve(arg("report-file", path.join(root, ".artifacts/environment-impact-closure/report.json")));
  const report = buildReport({ baseSha, headSha });
  fs.mkdirSync(path.dirname(reportFile), { recursive: true });
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ contract: CONTRACT, converged: report.converged, issue_count: report.issue_count, changed_path_count: report.changed_paths.length, report_file: reportFile }));
  if (!report.converged) process.exitCode = 1;
}
