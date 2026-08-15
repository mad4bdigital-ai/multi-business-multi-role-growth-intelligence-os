import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { discoverConfigurationCandidates } from "./configuration-candidate-discovery.mjs";

const CONTRACT = "mad4b.configuration-drift-guard.v1";
const DEFAULT_POLICY = "docs/governance/configuration-drift-policy.json";
const DEFAULT_OUTPUT_DIR = ".artifacts/configuration-drift-guard";

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2).replaceAll("-", "_");
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) args[key] = true;
    else { args[key] = value; index += 1; }
  }
  return args;
}

function sha256(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

function fingerprint(candidate) {
  return [candidate.path, candidate.symbol, candidate.expression_kind, candidate.suggested_config_key].join("|");
}

function validSuppression(suppression, now = new Date()) {
  if (!suppression || typeof suppression !== "object") return false;
  if (!suppression.fingerprint || !suppression.owner || !suppression.reason || !suppression.expires_at) return false;
  const expiry = new Date(suppression.expires_at);
  return Number.isFinite(expiry.getTime()) && expiry > now;
}

function finding(code, severity, message, details = {}) {
  return { code, severity, message, ...details };
}

async function loadJson(path, fallback = null) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch { return fallback; }
}

function checkAuthority(policy, repositoryPolicy) {
  const findings = [];
  if (repositoryPolicy?.contract !== "mad4b.repository-maintenance-tool-governance.v1") {
    findings.push(finding("AUTHORITY_POLICY_INVALID", "critical", "Repository maintenance authority policy contract is invalid."));
  }
  const tools = [
    ["configuration-candidate-discovery", "http-generic-api/scripts/maintenance-tools/configuration-candidate-discovery.mjs", "mad4b.configuration-candidate-discovery.v1"],
    ["configuration-drift-guard", "http-generic-api/scripts/maintenance-tools/configuration-drift-guard.mjs", "mad4b.configuration-drift-guard.v1"],
  ];
  for (const [key, entrypoint, reportContract] of tools) {
    const tool = repositoryPolicy?.tools?.[key];
    if (!tool) findings.push(finding("DISCOVERY_TOOL_UNREGISTERED", "critical", `${key} is absent from the central authority registry.`));
    else {
      if (tool.mode !== "read_only") findings.push(finding("DISCOVERY_TOOL_MODE_DRIFT", "critical", `${key} must remain read_only.`));
      if (tool.entrypoint !== entrypoint) findings.push(finding("DISCOVERY_TOOL_ENTRYPOINT_DRIFT", "critical", `${key} entrypoint drifted.`));
      if (tool.report_contract !== reportContract) findings.push(finding("DISCOVERY_TOOL_CONTRACT_DRIFT", "critical", `${key} report contract drifted.`));
    }
  }
  if (!Array.isArray(policy.required_contract_paths) || policy.required_contract_paths.length === 0) {
    findings.push(finding("DRIFT_POLICY_CONTRACT_SCOPE_MISSING", "critical", "Drift policy must declare required contract paths."));
  }
  return findings;
}

function checkContractScope(policy, e2eContracts = []) {
  const findings = [];
  const contracts = e2eContracts.filter(Boolean);
  const include = new Set(contracts.flatMap((contract) => Array.isArray(contract?.scope?.include) ? contract.scope.include : []));
  for (const requiredPath of policy.required_contract_paths || []) {
    if (!include.has(requiredPath)) findings.push(finding("E2E_SCOPE_DRIFT", "critical", `No E2E contract covers required path ${requiredPath}.`, { path: requiredPath }));
  }
  for (const contract of contracts) {
    if (contract.secrets_included !== false) findings.push(finding("E2E_SECRET_FLAG_DRIFT", "critical", "Every configuration E2E contract must declare secrets_included=false.", { feature_key: contract.feature_key || null }));
    if (contract.current_phase === "production") findings.push(finding("E2E_PRODUCTION_PHASE_DRIFT", "critical", "Configuration control plane cannot enter Production phase.", { feature_key: contract.feature_key || null }));
  }
  if (contracts.length === 0) findings.push(finding("E2E_CONTRACT_MISSING", "critical", "At least one configuration E2E contract is required."));
  return findings;
}

function checkSafety(report, manifest, policy) {
  const findings = [];
  const falseFlags = ["repository_mutation_executed", "database_mutation_executed", "protected_ref_mutation_executed", "secrets_included"];
  for (const flag of falseFlags) if (report?.[flag] !== false) findings.push(finding("REPORT_SAFETY_FLAG_DRIFT", "critical", `${flag} must remain false.`));
  for (const flag of ["migration_generation_allowed", "runtime_mutation_allowed", "secrets_included"]) {
    if (manifest?.[flag] !== (flag === "secrets_included" ? false : false)) findings.push(finding("MANIFEST_SAFETY_FLAG_DRIFT", "critical", `${flag} must remain false.`));
  }
  if (report?.mode !== "report-only") findings.push(finding("DISCOVERY_MODE_DRIFT", "critical", "Discovery report mode must remain report-only."));
  if (report?.summary?.secret_candidates > (policy.max_existing_secret_candidates ?? Number.MAX_SAFE_INTEGER)) findings.push(finding("SECRET_CANDIDATE_COUNT_DRIFT", "high", "Existing secret candidate count exceeded governed baseline ceiling.", { actual: report.summary.secret_candidates, maximum: policy.max_existing_secret_candidates }));
  return findings;
}

function renderMarkdown(result) {
  const rows = result.findings.length
    ? result.findings.map((item) => `| ${item.severity} | ${item.code} | ${item.path || "—"} | ${item.message} |`).join("\n")
    : "| none | — | — | No configuration drift detected. |";
  return `# Configuration Drift Guard\n\n- Contract: \`${result.contract}\`\n- Result: **${result.ok ? "PASS" : "FAIL"}**\n- Current candidates: ${result.current_candidate_count}\n- Baseline candidates: ${result.baseline_candidate_count}\n- New candidates: ${result.new_candidate_count}\n- Suppressed new candidates: ${result.suppressed_candidate_count}\n- Removed candidates: ${result.removed_candidate_count}\n- Repository mutation: no\n- Database mutation: no\n- Production activation: no\n- Secrets included: no\n\n| Severity | Code | Path | Finding |\n|---|---|---|---|\n${rows}\n`;
}

export async function runConfigurationDriftGuard({ repositoryRoot = process.cwd(), policyPath = DEFAULT_POLICY, outputDir = DEFAULT_OUTPUT_DIR, failOnDrift = false } = {}) {
  const originalCwd = process.cwd();
  process.chdir(repositoryRoot);
  try {
    const policy = await loadJson(policyPath, null);
    const repositoryPolicy = await loadJson(".github/repository-maintenance-tool-governance.json", null);
    const e2eContracts = await Promise.all([
      loadJson(".changes/e2e/configuration-drift-guard-20260815.json", null),
      loadJson(".changes/e2e/platform-configuration-control-plane-20260815.json", null),
    ]);
    const reportDir = resolve(outputDir, "discovery");
    const report = await discoverConfigurationCandidates({ repositoryRoot, inventoryPath: policy?.inventory_path || "docs/repository-inventory.json", outputDir: reportDir });
    const manifest = await loadJson(resolve(reportDir, "configuration-candidates-manifest.json"), null);
    const baseline = new Set(policy?.baseline_fingerprints || []);
    const current = new Set((report.candidates || []).map(fingerprint));
    const allSuppressions = Array.isArray(policy?.suppressions) ? policy.suppressions : [];
    const validSuppressions = allSuppressions.filter((item) => validSuppression(item));
    const suppressions = new Map(validSuppressions.map((item) => [item.fingerprint, item]));
    const newCandidates = [...current].filter((item) => !baseline.has(item)).sort();
    const suppressed = newCandidates.filter((item) => suppressions.has(item));
    const unsuppressed = newCandidates.filter((item) => !suppressions.has(item));
    const removed = [...baseline].filter((item) => !current.has(item)).sort();
    const findings = [];
    if (!policy || policy.contract !== CONTRACT) findings.push(finding("DRIFT_POLICY_INVALID", "critical", `Drift policy must use ${CONTRACT}.`));
    for (const suppression of allSuppressions) if (!validSuppression(suppression)) findings.push(finding("INVALID_OR_EXPIRED_SUPPRESSION", "high", "Every suppression must have an owner, reason, fingerprint, and future expiry.", { fingerprint: suppression?.fingerprint || null }));
    findings.push(...checkAuthority(policy || {}, repositoryPolicy));
    findings.push(...checkContractScope(policy || {}, e2eContracts));
    findings.push(...checkSafety(report, manifest, policy || {}));
    for (const item of unsuppressed) findings.push(finding("NEW_CONFIGURATION_CANDIDATE_DRIFT", "high", "A new configuration candidate is not in the approved baseline or a valid suppression.", { fingerprint: item }));
    if ((policy?.fail_on_removed_candidates === true) && removed.length) findings.push(finding("REMOVED_CONFIGURATION_CANDIDATE_DRIFT", "medium", "A baseline candidate disappeared without an explicit baseline update.", { fingerprints: removed.slice(0, 50) }));
    const result = {
      contract: CONTRACT,
      schema_version: 1,
      ok: findings.length === 0,
      policy_path: policyPath,
      current_candidate_count: current.size,
      baseline_candidate_count: baseline.size,
      new_candidate_count: newCandidates.length,
      suppressed_candidate_count: suppressed.length,
      removed_candidate_count: removed.length,
      current_fingerprint_sha256: sha256([...current].sort().join("\n")),
      findings,
      repository_mutation_executed: false,
      database_mutation_executed: false,
      production_activation_executed: false,
      secrets_included: false,
      manifest_safety: {
        migration_generation_allowed: manifest?.migration_generation_allowed === true,
        runtime_mutation_allowed: manifest?.runtime_mutation_allowed === true,
        secrets_included: manifest?.secrets_included === true,
      },
    };
    await mkdir(resolve(outputDir), { recursive: true });
    await writeFile(resolve(outputDir, "configuration-drift-guard.json"), `${JSON.stringify(result, null, 2)}\n`);
    await writeFile(resolve(outputDir, "configuration-drift-guard.md"), renderMarkdown(result));
    if (failOnDrift && !result.ok) process.exitCode = 2;
    return result;
  } finally { process.chdir(originalCwd); }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv);
  const result = await runConfigurationDriftGuard({
    repositoryRoot: args.root || process.cwd(),
    policyPath: args.policy || DEFAULT_POLICY,
    outputDir: args.output_dir || DEFAULT_OUTPUT_DIR,
    failOnDrift: Boolean(args.fail_on_drift),
  });
  process.stdout.write(`${JSON.stringify({ contract: result.contract, ok: result.ok, findings: result.findings.length, new_candidate_count: result.new_candidate_count, secrets_included: false }, null, 2)}\n`);
}
