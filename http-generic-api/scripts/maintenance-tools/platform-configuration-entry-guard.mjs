import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const DEFAULT_REGISTRY = "docs/governance/platform-configuration-entry-registry.json";
const DEFAULT_CANDIDATES = ".artifacts/repository-tool-lifecycle/configuration-candidates/configuration-candidates.json";
const DEFAULT_BASELINE_EXTENSION = "docs/governance/configuration-drift-baseline-extensions.json";
const DEFAULT_OUTPUT = ".artifacts/repository-tool-lifecycle/platform-configuration-entry-guard.json";
export const CONTRACT = "mad4b.platform-configuration-entry-guard.v1";
const KEY_PATTERN = /^[a-z][a-z0-9]*(\.[a-z0-9]+)+$/u;
const REQUIRED_ENTRY_FIELDS = [
  "config_key",
  "schema_ref",
  "owner",
  "risk_class",
  "scope_types",
  "binding_ref",
  "resolver_ref",
  "readback_ref",
  "shadow_evidence_ref",
  "classification",
  "status",
];

function sha256(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
}

function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function normalizePath(value) {
  return String(value || "").replaceAll("\\", "/").replace(/^\.\//u, "");
}

function normalizeKey(value) {
  return String(value || "").trim().toLowerCase().replaceAll("_", ".").replace(/\.+/gu, ".");
}

function finding(code, severity, message, details = {}) {
  return { code, severity, message, ...details };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function parseChangedFilesFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, "utf8")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const fields = line.split(/\s+/u);
      if (fields[0] === "D") return [];
      if (fields[0] === "R" || fields[0] === "C") return fields.slice(-1).map(normalizePath);
      return [normalizePath(fields.length > 1 ? fields[1] : fields[0])];
    });
}

function ignoredPath(filePath, prefixes) {
  const normalized = normalizePath(filePath);
  return prefixes.some((prefix) => normalized.startsWith(normalizePath(prefix)));
}

function refExists(repositoryRoot, reference) {
  const normalized = normalizePath(reference);
  return Boolean(normalized) && fs.existsSync(path.join(repositoryRoot, normalized));
}

function entryShapeFindings(entry, index, repositoryRoot) {
  const findings = [];
  for (const field of REQUIRED_ENTRY_FIELDS) {
    if (entry?.[field] === undefined || entry?.[field] === null || entry?.[field] === "") {
      findings.push(finding("CONFIG_ENTRY_METADATA_MISSING", "critical", `Entry ${index} is missing ${field}.`, { index, field }));
    }
  }
  const key = normalizeKey(entry?.config_key);
  if (!KEY_PATTERN.test(key)) findings.push(finding("CONFIG_ENTRY_KEY_INVALID", "critical", `Entry ${index} has an invalid config_key.`, { index, config_key: entry?.config_key || null }));
  if (entry?.classification !== "runtime_setting") findings.push(finding("CONFIG_ENTRY_CLASSIFICATION_INVALID", "critical", "Only runtime_setting candidates may enter the general Config Catalog entry registry.", { index, classification: entry?.classification || null }));
  if (!Array.isArray(entry?.scope_types) || entry.scope_types.length === 0) findings.push(finding("CONFIG_ENTRY_SCOPE_MISSING", "critical", "Every configuration entry requires at least one scope type.", { index, config_key: key }));
  if (!["low", "medium", "high", "critical"].includes(entry?.risk_class)) findings.push(finding("CONFIG_ENTRY_RISK_INVALID", "critical", "Every configuration entry requires a bounded risk class.", { index, config_key: key }));
  if (!["shadow", "staged"].includes(entry?.status)) findings.push(finding("CONFIG_ENTRY_STATUS_INVALID", "critical", "New configuration entries must remain shadow or staged until independent promotion.", { index, config_key: key, status: entry?.status || null }));
  if (entry?.secrets_included !== undefined && entry.secrets_included !== false) findings.push(finding("CONFIG_ENTRY_SECRET_FLAG", "critical", "Configuration entry metadata must not include secrets.", { index, config_key: key }));
  for (const field of ["schema_ref", "binding_ref", "resolver_ref", "readback_ref", "shadow_evidence_ref"]) {
    if (entry?.[field] && !refExists(repositoryRoot, entry[field])) findings.push(finding("CONFIG_ENTRY_REFERENCE_MISSING", "critical", `${field} does not point to a repository file.`, { index, config_key: key, field, reference: entry[field] }));
  }
  return findings;
}

function safetyFindings(registry) {
  const findings = [];
  const safety = registry?.safety || {};
  for (const key of ["values_included", "secrets_included", "runtime_mutation_allowed", "database_mutation_allowed", "production_activation_allowed"]) {
    if (safety[key] !== false) findings.push(finding("CONFIG_REGISTRY_SAFETY_FLAG", "critical", `${key} must remain false.`, { key, actual: safety[key] }));
  }
  return findings;
}

function candidateFingerprint(candidate) {
  return [candidate.path, candidate.symbol, candidate.expression_kind, candidate.suggested_config_key].join("|");
}

function classifyChangedCandidates(candidates, changedFiles, ignoredPrefixes, entriesByKey, baselineFingerprints = new Set()) {
  const findings = [];
  const changed = new Set(changedFiles.map(normalizePath));
  for (const candidate of candidates || []) {
    const filePath = normalizePath(candidate.path);
    if (!changed.has(filePath) || ignoredPath(filePath, ignoredPrefixes)) continue;
    const candidateClass = String(candidate.candidate_class || "");
    const configKey = normalizeKey(candidate.suggested_config_key);
    if (baselineFingerprints.has(candidateFingerprint(candidate))) continue;
    if (candidateClass === "generated_artifact") continue;
    if (candidateClass === "secret_candidate") {
      findings.push(finding("NEW_SECRET_CONFIGURATION_CANDIDATE", "critical", "A new secret candidate cannot enter the Config Catalog.", { path: filePath, line: candidate.line, candidate_id: candidate.candidate_id }));
      continue;
    }
    if (candidateClass === "policy_candidate") {
      findings.push(finding("NEW_POLICY_CONFIGURATION_CANDIDATE", "high", "Policy candidates require a specialized policy registry and cannot enter the general runtime Config Catalog.", { path: filePath, line: candidate.line, suggested_config_key: configKey }));
      continue;
    }
    if (candidateClass !== "runtime_setting") {
      findings.push(finding("NEW_CONFIGURATION_CLASSIFICATION_REQUIRED", "high", "A new candidate must be classified before registration.", { path: filePath, line: candidate.line, candidate_class: candidateClass || null }));
      continue;
    }
    if (!entriesByKey.has(configKey)) {
      findings.push(finding("CONFIG_ENTRY_REGISTRATION_MISSING", "critical", "New runtime setting has no metadata-only Config Catalog registration.", { path: filePath, line: candidate.line, suggested_config_key: configKey }));
    }
  }
  return findings;
}

export function collectBaselineFingerprints({ baselineDocument = null, baselineExtensionDocument = null } = {}) {
  const fingerprints = new Set(Array.isArray(baselineDocument?.baseline_fingerprints) ? baselineDocument.baseline_fingerprints : []);
  for (const entry of Array.isArray(baselineExtensionDocument?.entries) ? baselineExtensionDocument.entries : []) {
    const safeGovernanceInput = entry?.configuration_class === "ci_governance_input"
      && entry?.contains_secret_value === false
      && entry?.grants_runtime_mutation === false
      && entry?.grants_production_activation === false;
    if (safeGovernanceInput && typeof entry?.fingerprint === "string" && entry.fingerprint.trim()) fingerprints.add(entry.fingerprint.trim());
  }
  return fingerprints;
}

export function evaluateConfigurationEntryGuard({ repositoryRoot = ROOT, registry, candidates, changedFiles = [], baselineFingerprints = new Set() } = {}) {
  const effectiveRegistry = registry || readJson(path.join(repositoryRoot, DEFAULT_REGISTRY));
  const effectiveCandidates = candidates || readJson(path.join(repositoryRoot, DEFAULT_CANDIDATES));
  const entries = Array.isArray(effectiveRegistry.entries) ? effectiveRegistry.entries : [];
  const ignoredPrefixes = Array.isArray(effectiveRegistry.ignored_changed_path_prefixes) ? effectiveRegistry.ignored_changed_path_prefixes : [];
  const findings = [];
  if (effectiveRegistry.contract !== "mad4b.platform-configuration-entry-registry.v1") findings.push(finding("CONFIG_REGISTRY_CONTRACT_INVALID", "critical", "The configuration entry registry contract is invalid."));
  findings.push(...safetyFindings(effectiveRegistry));
  const entriesByKey = new Map();
  entries.forEach((entry, index) => {
    const key = normalizeKey(entry?.config_key);
    if (entriesByKey.has(key)) findings.push(finding("CONFIG_ENTRY_DUPLICATE", "critical", "Config Catalog entry keys must be unique.", { config_key: key }));
    entriesByKey.set(key, entry);
    findings.push(...entryShapeFindings(entry, index, repositoryRoot));
  });
  findings.push(...classifyChangedCandidates(effectiveCandidates.candidates || [], changedFiles, ignoredPrefixes, entriesByKey, baselineFingerprints));
  const result = {
    contract: CONTRACT,
    schema_version: 1,
    ok: findings.length === 0,
    changed_files: changedFiles.map(normalizePath).sort(),
    candidate_count: Array.isArray(effectiveCandidates.candidates) ? effectiveCandidates.candidates.length : 0,
    baseline_candidate_count: baselineFingerprints.size,
    registry_entry_count: entries.length,
    registered_config_keys: [...entriesByKey.keys()].sort(),
    findings,
    safety: {
      values_included: false,
      secrets_included: false,
      runtime_mutation_allowed: false,
      database_mutation_allowed: false,
      production_activation_allowed: false,
    },
  };
  result.report_sha256 = sha256(canonicalize(result));
  return result;
}

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

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const args = parseArgs(process.argv);
  const repositoryRoot = path.resolve(args.root || ROOT);
  const registry = readJson(path.resolve(repositoryRoot, args.registry || DEFAULT_REGISTRY));
  const candidates = readJson(path.resolve(repositoryRoot, args.candidates || DEFAULT_CANDIDATES));
  const changedFiles = parseChangedFilesFile(args.changed_files || process.env.CHANGED_FILES_FILE);
  const baselineDocument = args.baseline_policy ? readJson(path.resolve(repositoryRoot, args.baseline_policy)) : null;
  const baselineExtensionPath = args.baseline_extension || DEFAULT_BASELINE_EXTENSION;
  const baselineExtensionDocument = baselineExtensionPath && fs.existsSync(path.resolve(repositoryRoot, baselineExtensionPath))
    ? readJson(path.resolve(repositoryRoot, baselineExtensionPath))
    : null;
  const baselineFingerprints = collectBaselineFingerprints({ baselineDocument, baselineExtensionDocument });
  const result = evaluateConfigurationEntryGuard({ repositoryRoot, registry, candidates, changedFiles, baselineFingerprints });
  const outputPath = path.resolve(repositoryRoot, args.output || DEFAULT_OUTPUT);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ contract: result.contract, ok: result.ok, findings: result.findings.length, registry_entry_count: result.registry_entry_count, secrets_included: false }, null, 2)}\n`);
  if (args.fail_on_findings && !result.ok) process.exitCode = 2;
}
