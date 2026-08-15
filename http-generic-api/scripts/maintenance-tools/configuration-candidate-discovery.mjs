import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const CONTRACT = "mad4b.configuration-candidate-discovery.v1";
const DEFAULT_INVENTORY = "docs/repository-inventory.json";
const DEFAULT_OUTPUT_DIR = ".artifacts/configuration-candidate-discovery";
const SCAN_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".sql", ".yml", ".yaml", ".json"]);
const SENSITIVE_KEY = /(?:secret|token|password|passwd|private[_-]?key|client[_-]?secret|api[_-]?key|authorization|cookie|credential|refresh[_-]?token|access[_-]?token)/iu;
const POLICY_KEY = /(?:approval|allowlist|denylist|production|live|write[_-]?scope|policy|permission|authorization|role|scope|canary|kill[_-]?switch)/iu;
const SETTING_KEY = /(?:^|[_\-.])(?:default|config|setting|feature|flag|timeout|ttl|quota|rate[_-]?limit|batch|cache|retry|concurrency|limit)(?:$|[_\-.])/iu;
const CONFIG_SYMBOL = /(?:default|config|setting|feature|flag|timeout|ttl|quota|rate[_-]?limit|batch|cache|retry|concurrency|allowlist|denylist|policy|approval|scope|mode|environment|endpoint|base[_-]?url|host|port|generated|openapi|work[-_]?map)/iu;
const GENERATED_PATH = /(?:generated|work[-_]?maps?|repository-inventory|repository-evaluation|openapi\.(?:yaml|yml|json))/iu;
const EXCLUDED_PATH = /(?:^|\/)(?:node_modules|\.git|\.artifacts|dist|build|coverage|vendor|fixtures?|snapshots?|__snapshots__|tests?|specs?)(?:\/|$)|(?:\.generated\.(?:js|mjs|json|yaml|yml)|\.lock$)/iu;
const LITERAL = /(?:=|:)\s*(?:(["'`])((?:\\.|(?!\1)[^\\])*?)\1|([0-9]+(?:\.[0-9]+)?)|\b(true|false|null)\b)/iu;
const REVIEWED_IMMUTABLE_SOURCE_MIRRORS = new Map([
  ["http-generic-api/scripts/e2e-parallel-pr-gate-legacy.mjs", "2374480b7bafb6bcbdbdac47e1950f0c20123b05ded62bf394db7d2f49c6a425"],
]);

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2).replaceAll("-", "_");
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) args[key] = true;
    else { args[key] = value; i += 1; }
  }
  return args;
}

function normalizePath(value) {
  return String(value || "").replaceAll("\\", "/").replace(/^\.\//u, "");
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

export function isReviewedImmutableSourceMirror(path, content) {
  const expectedHash = REVIEWED_IMMUTABLE_SOURCE_MIRRORS.get(normalizePath(path));
  return Boolean(expectedHash) && sha256(content) === expectedHash;
}

function redact(value) {
  return String(value || "")
    .replace(/((?:authorization|access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|api[_-]?key|password|passwd|private[_-]?key|cookie|secret|token|credential)\s*[:=]\s*)([^\s,;]+)/giu, "$1[REDACTED]")
    .replace(/Bearer\s+[^\s]+/giu, "Bearer [REDACTED]")
    .replace(/gh[pousr]_[A-Za-z0-9_]{20,}/gu, "[REDACTED_GITHUB_TOKEN]");
}

function safePreview(line, sensitive) {
  const clean = redact(line).trim().slice(0, 300);
  return sensitive ? clean.replace(/(["'`])[^"'`]*\1/gu, "$1[REDACTED]$1") : clean;
}

function candidateClass({ path, symbol, line, expressionKind }) {
  const text = `${path} ${symbol} ${line}`;
  if (GENERATED_PATH.test(path) || /(?:generated|work[-_]?map|openapi)/iu.test(symbol)) return { candidate_class: "generated_artifact", risk_class: "medium", migration_action: "exclude_from_migration" };
  if (SENSITIVE_KEY.test(text)) return { candidate_class: "secret_candidate", risk_class: "critical", migration_action: "secret_inventory_and_rotation_review" };
  if (POLICY_KEY.test(text)) return { candidate_class: "policy_candidate", risk_class: "high", migration_action: "specialized_registry_review" };
  if (expressionKind === "environment_reference" || SETTING_KEY.test(text)) return { candidate_class: "runtime_setting", risk_class: "medium", migration_action: "catalog_review_then_shadow_parity" };
  return { candidate_class: "unknown_review_required", risk_class: "medium", migration_action: "manual_classification_required" };
}

function extractSymbol(line, expressionKind) {
  const declaration = line.match(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/u)?.[1];
  if (declaration) return declaration;
  const env = line.match(/process\.env\.([A-Z][A-Z0-9_]*)/u)?.[1];
  if (env) return env;
  const sqlKey = line.match(/config_key\s*[,)=]\s*['"`]([^'"`]+)['"`]/iu)?.[1];
  if (sqlKey) return sqlKey;
  return `${expressionKind}:line`;
}

export function extractCandidates(path, content) {
  const findings = [];
  const lines = String(content).split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim() || /^\s*(?:\/\/|#|--|\*)/u.test(line)) continue;
    const envMatch = line.match(/process\.env\.([A-Z][A-Z0-9_]*)/u);
    const declarationMatch = line.match(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;]+)/u);
    const configSeed = /platform_runtime_config/iu.test(line) && /config_key|config_json|INSERT|UPDATE/iu.test(line);
    if (!envMatch && !declarationMatch && !configSeed) continue;
    const expressionKind = envMatch ? "environment_reference" : configSeed ? "migration_seed" : "literal_declaration";
    const symbol = extractSymbol(line, expressionKind);
    if (!envMatch && !configSeed && (!declarationMatch || !CONFIG_SYMBOL.test(symbol) || !LITERAL.test(line))) continue;
    const context = lines.slice(Math.max(0, index - 1), Math.min(lines.length, index + 2)).join(" ");
    const classification = candidateClass({ path, symbol, line, expressionKind });
    const sensitive = classification.candidate_class === "secret_candidate";
    const literal = line.match(LITERAL);
    const candidateKey = `${path}:${index + 1}:${symbol}:${expressionKind}`;
    findings.push({
      candidate_id: sha256(candidateKey).slice(0, 20),
      path,
      line: index + 1,
      symbol,
      expression_kind: expressionKind,
      candidate_class: classification.candidate_class,
      risk_class: classification.risk_class,
      migration_action: classification.migration_action,
      value_type: envMatch ? "environment_reference" : literal?.[3] ? "number" : literal?.[4] ? "boolean_or_null" : "string_or_expression",
      value_preview: safePreview(line, sensitive),
      evidence: redact(context).trim().slice(0, 600),
      suggested_config_key: envMatch ? envMatch[1].toLowerCase().replaceAll("_", ".") : symbol.replace(/^DEFAULT_/u, "").toLowerCase().replaceAll("_", "."),
      secrets_included: false,
      source_hash: sha256(content),
    });
  }
  return findings;
}

async function trackedFiles() {
  const { stdout } = await execFileAsync("git", ["ls-files", "-z"], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  return stdout.split("\0").filter(Boolean).map(normalizePath).filter((path) => SCAN_EXTENSIONS.has(extname(path).toLowerCase()) && !EXCLUDED_PATH.test(path));
}

async function loadInventory(path) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch { return null; }
}

function normalizeConfigKey(value) {
  return String(value || "").trim().toLowerCase().replaceAll("_", ".").replace(/\.+/gu, ".");
}

function extractRegistryKeys(content) {
  const keys = new Set();
  const source = String(content || "");
  const pattern = /(?:config_key|configKey|growthConfigKey|legacyConfigKey|config-key)\s*[=:,)]\s*["'`]([^"'`]{2,191})["'`]/gu;
  for (const match of source.matchAll(pattern)) keys.add(normalizeConfigKey(match[1]));
  return keys;
}

export function registryMatches({ path, content, suggestedConfigKey, registryKeys }) {
  const source = String(content || "");
  const key = normalizeConfigKey(suggestedConfigKey);
  const matches = [];
  if (registryKeys.has(key)) matches.push("known_config_key");
  if (/platform_runtime_config/iu.test(source)) matches.push("platform_runtime_config");
  if (/growth_control_(?:config|shadow_parity)/iu.test(source)) matches.push("growth_control_registry");
  if (/write_route_policy_registry/iu.test(source)) matches.push("write_route_policy_registry");
  if (/governed_policy_(?:proposal|approval|version|activation)/iu.test(source)) matches.push("governed_policy_registry");
  if (/platform_engine_policy|runtime_policy/iu.test(source)) matches.push("platform_policy_registry");
  if (/migrations?[\\/]/iu.test(path) && !matches.includes("known_config_key")) matches.push("migration_source");
  return [...new Set(matches)].sort();
}

function confidenceFor({ candidateClass, registryMatches: matches, expressionKind }) {
  if (candidateClass === "secret_candidate") return matches.length ? "high" : "medium";
  if (candidateClass === "generated_artifact") return "high";
  if (matches.includes("known_config_key")) return "high";
  if (candidateClass === "policy_candidate") return expressionKind === "environment_reference" ? "high" : "medium";
  if (candidateClass === "runtime_setting") return expressionKind === "environment_reference" ? "medium" : "high";
  return "low";
}

function renderMarkdown(report) {
  const rows = report.candidates.slice(0, 500).map((item) => `| ${item.candidate_class} | ${item.risk_class} | ${item.confidence} | \`${item.path}:${item.line}\` | \`${item.symbol}\` | ${item.registry_matches.join(", ") || "none"} | ${item.migration_action} |`).join("\n");
  return `# Configuration Candidate Discovery\n\n- Contract: \`${report.contract}\`\n- Mode: **report-only**\n- Result: **${report.ok ? "PASS" : "REVIEW_REQUIRED"}**\n- Candidate count: ${report.summary.total}\n- Critical secret candidates: ${report.summary.secret_candidates}\n- Policy candidates: ${report.summary.policy_candidates}\n- Runtime settings: ${report.summary.runtime_settings}\n- Generated artifacts excluded: ${report.summary.generated_artifacts}\n- Repository mutation executed: no\n- Database mutation executed: no\n- Secrets included: no\n\n| Class | Risk | Confidence | Location | Symbol | Registry matches | Action |\n|---|---|---|---|---|---|---|\n${rows || "| none | — | — | — | — | — | — |"}\n`;
}

export async function discoverConfigurationCandidates({ repositoryRoot = process.cwd(), inventoryPath = DEFAULT_INVENTORY, outputDir = DEFAULT_OUTPUT_DIR } = {}) {
  const originalCwd = process.cwd();
  process.chdir(repositoryRoot);
  try {
    const inventory = await loadInventory(inventoryPath);
    const paths = await trackedFiles();
    const records = await Promise.all(paths.map(async (path) => ({ path, content: await readFile(path, "utf8") })));
    const registryKeys = new Set(records.flatMap((record) => [...extractRegistryKeys(record.content)]));
    const inventorySet = Array.isArray(inventory?.files) ? new Set(inventory.files.map((file) => normalizePath(file.path))) : null;
    const candidates = [];
    for (const { path, content } of records) {
      if (isReviewedImmutableSourceMirror(path, content)) continue;
      for (const candidate of extractCandidates(path, content)) {
        const matches = registryMatches({ path, content: candidate.evidence, suggestedConfigKey: candidate.suggested_config_key, registryKeys });
        candidates.push({ ...candidate, registry_matches: matches, confidence: confidenceFor({ candidateClass: candidate.candidate_class, registryMatches: matches, expressionKind: candidate.expression_kind }) });
      }
    }
    candidates.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line || a.symbol.localeCompare(b.symbol));
    const summary = {
      total: candidates.length,
      secret_candidates: candidates.filter((item) => item.candidate_class === "secret_candidate").length,
      policy_candidates: candidates.filter((item) => item.candidate_class === "policy_candidate").length,
      runtime_settings: candidates.filter((item) => item.candidate_class === "runtime_setting").length,
      generated_artifacts: candidates.filter((item) => item.candidate_class === "generated_artifact").length,
      unknown_review_required: candidates.filter((item) => item.candidate_class === "unknown_review_required").length,
      high_confidence: candidates.filter((item) => item.confidence === "high").length,
      registry_matched: candidates.filter((item) => item.registry_matches.length > 0).length,
      known_config_key_matches: candidates.filter((item) => item.registry_matches.includes("known_config_key")).length,
    };
    const report = {
      contract: CONTRACT,
      schema_version: 1,
      mode: "report-only",
      repository_inventory: {
        path: normalizePath(inventoryPath),
        present: Boolean(inventory),
        role: "coverage_reference_not_execution_authority",
        inventory_files: Array.isArray(inventory?.files) ? inventory.files.length : 0,
        tracked_files_scanned: paths.length,
        tracked_files_missing_from_inventory: inventorySet ? paths.filter((path) => !inventorySet.has(path)).length : null,
      },
      scan_extensions: [...SCAN_EXTENSIONS].sort(),
      registry_key_count: registryKeys.size,
      excluded_path_policy: EXCLUDED_PATH.source,
      summary,
      candidates,
      ok: summary.secret_candidates === 0,
      repository_mutation_executed: false,
      database_mutation_executed: false,
      protected_ref_mutation_executed: false,
      secrets_included: false,
    };
    report.report_sha256 = sha256(JSON.stringify(report));
    const manifest = {
      contract: "mad4b.configuration-candidate-manifest.v1",
      source_report_sha256: report.report_sha256,
      mode: "review_required_no_auto_apply",
      approved_candidates: [],
      rejected_candidates: [],
      pending_candidate_ids: candidates.map((item) => item.candidate_id),
      migration_generation_allowed: false,
      runtime_mutation_allowed: false,
      secrets_included: false,
    };
    await mkdir(resolve(outputDir), { recursive: true });
    await writeFile(resolve(outputDir, "configuration-candidates.json"), `${JSON.stringify(report, null, 2)}\n`);
    await writeFile(resolve(outputDir, "configuration-candidates.md"), renderMarkdown(report));
    await writeFile(resolve(outputDir, "configuration-candidates-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    return report;
  } finally { process.chdir(originalCwd); }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv);
  const report = await discoverConfigurationCandidates({
    repositoryRoot: args.root || process.cwd(),
    inventoryPath: args.inventory || DEFAULT_INVENTORY,
    outputDir: args.output_dir || DEFAULT_OUTPUT_DIR,
  });
  process.stdout.write(`${JSON.stringify({ contract: report.contract, ok: report.ok, summary: report.summary, output_dir: args.output_dir || DEFAULT_OUTPUT_DIR, secrets_included: false }, null, 2)}\n`);
  const failOn = String(args.fail_on || "none").toLowerCase();
  process.exitCode = failOn === "secret" && report.summary.secret_candidates > 0 ? 2 : 0;
}
