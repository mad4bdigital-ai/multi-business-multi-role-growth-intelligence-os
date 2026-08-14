#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(SCRIPT_DIR, "..", "..");

export const DATABASE_RUNTIME_IDENTITY_ENV = Object.freeze({
  runtime: "DB_NAME",
  governance: "GOVERNANCE_DB_NAME",
  persistence: "RUNTIME_PERSISTENCE_DB_NAME",
});

const IDENTITY_ENV_KEYS = Object.freeze(Object.values(DATABASE_RUNTIME_IDENTITY_ENV));
const IDENTITY_FIELDS = Object.freeze([
  ...IDENTITY_ENV_KEYS,
  "TARGET_SCHEMA",
  "target_schema",
]);
const SUPPORTED_EXTENSIONS = new Set([
  ".cjs", ".js", ".json", ".md", ".mjs", ".sh", ".ts", ".tsx", ".yaml", ".yml",
]);
const EXCLUDED_SEGMENTS = new Set([
  ".git", ".next", "artifacts", "build", "coverage", "dist", "node_modules", "vendor",
]);
const HOSTINGER_DATABASE_LITERAL = /\bu\d{5,}_[A-Za-z0-9][A-Za-z0-9_]{2,127}\b/iu;
const MANUAL_INPUT_BINDING = /\b(?:TARGET_SCHEMA|DB_NAME|GOVERNANCE_DB_NAME|RUNTIME_PERSISTENCE_DB_NAME)\b\s*:\s*\$\{\{\s*inputs\.[A-Za-z0-9_-]+\s*\}\}/iu;

const RULES = Object.freeze({
  database_identity_literal: {
    message: "A concrete database/schema identity is embedded in executable repository content.",
    remediation: "Resolve the identity from the role-specific App Env variable and fail closed when it is absent.",
  },
  database_identity_fallback_literal: {
    message: "A database identity App Env variable has a non-empty literal fallback.",
    remediation: "Remove the fallback; database identity must come from App Env or fail closed.",
  },
  database_identity_manual_override: {
    message: "A workflow input can override a database/schema runtime identity.",
    remediation: "Resolve database identity from the deployed App Env in the same evidence cycle instead of accepting operator-entered schema values.",
  },
});

function normalize(value) {
  return String(value || "").split(path.sep).join("/").replace(/^\.\//u, "");
}

function classifyZone(relativePath) {
  const normalized = `/${normalize(relativePath).toLowerCase()}`;
  const basename = path.posix.basename(normalized);
  if (normalized.includes("/migrations/") || normalized.includes("/migration/")) return "migration";
  if (
    normalized.includes("/tests/") ||
    normalized.includes("/test/") ||
    normalized.includes("/fixtures/") ||
    normalized.includes("/__tests__/") ||
    basename.startsWith("test-") ||
    basename.includes(".test.")
  ) return "test";
  if (normalized.includes("/docs/") || normalized.includes("/specs/") || normalized.endsWith(".md")) return "documentation";
  return "runtime";
}

function suppressionFor(lines, index, ruleId) {
  const candidate = lines.slice(Math.max(0, index - 2), index + 1).join("\n");
  const match = candidate.match(/database-runtime-identity-policy:\s*allow\s+([a-z0-9_-]+)\s+--\s+(.{12,})/iu);
  if (!match) return null;
  const requested = match[1].toLowerCase();
  if (requested !== "all" && requested !== ruleId) return null;
  return match[2].trim();
}

function finding({ ruleId, relativePath, lineIndex, lines }) {
  const suppressionReason = suppressionFor(lines, lineIndex, ruleId);
  return {
    rule_id: ruleId,
    severity: "high",
    confidence: "high",
    zone: classifyZone(relativePath),
    path: normalize(relativePath),
    line: lineIndex + 1,
    message: RULES[ruleId].message,
    remediation: RULES[ruleId].remediation,
    value_disclosed: false,
    suppressed: Boolean(suppressionReason),
    suppression_reason: suppressionReason || "",
    secrets_included: false,
  };
}

function nonEmptyLiteralFallback(line, envKey) {
  const escaped = envKey.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const accesses = [
    `process\\.env\\.${escaped}`,
    `env\\.${escaped}`,
    `process\\.env\\[["']${escaped}["']\\]`,
    `env\\[["']${escaped}["']\\]`,
  ].join("|");
  const jsMatch = line.match(new RegExp(`(?:${accesses})\\s*(?:\\|\\||\\?\\?)\\s*(["'\x60])([^"'\x60]*)\\1`, "u"));
  if (jsMatch && String(jsMatch[2] || "").trim()) return true;
  const shellMatch = line.match(new RegExp(`\\$\\{${escaped}:-([^}]*)\\}`, "u"));
  return Boolean(shellMatch && String(shellMatch[1] || "").trim());
}

function staticIdentityAssignment(line) {
  for (const field of IDENTITY_FIELDS) {
    const escaped = field.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const quoted = line.match(new RegExp(`\\b${escaped}\\b\\s*[:=]\\s*(["'\x60])([^"'\x60]+)\\1`, "u"));
    if (quoted && String(quoted[2] || "").trim()) return true;
    const yaml = line.match(new RegExp(`^\\s*${escaped}\\s*:\\s*([A-Za-z0-9][A-Za-z0-9_.:-]{1,127})\\s*(?:#.*)?$`, "u"));
    if (yaml) return true;
  }
  return false;
}

function scanFile(repositoryRoot, absolutePath) {
  const relativePath = normalize(path.relative(repositoryRoot, absolutePath));
  const lines = fs.readFileSync(absolutePath, "utf8").split(/\r?\n/u);
  const findings = [];
  const seen = new Set();
  const add = (item) => {
    const key = `${item.rule_id}:${item.path}:${item.line}`;
    if (!seen.has(key)) {
      seen.add(key);
      findings.push(item);
    }
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (HOSTINGER_DATABASE_LITERAL.test(line) || staticIdentityAssignment(line)) {
      add(finding({ ruleId: "database_identity_literal", relativePath, lineIndex: index, lines }));
    }
    if (IDENTITY_ENV_KEYS.some((envKey) => nonEmptyLiteralFallback(line, envKey))) {
      add(finding({ ruleId: "database_identity_fallback_literal", relativePath, lineIndex: index, lines }));
    }
    if (relativePath.startsWith(".github/workflows/") && MANUAL_INPUT_BINDING.test(line)) {
      add(finding({ ruleId: "database_identity_manual_override", relativePath, lineIndex: index, lines }));
    }
  }
  return findings;
}

function shouldInspect(relativePath) {
  const normalized = normalize(relativePath);
  const segments = normalized.split("/");
  if (segments.some((segment) => EXCLUDED_SEGMENTS.has(segment))) return false;
  return SUPPORTED_EXTENSIONS.has(path.extname(normalized).toLowerCase());
}

function collectFiles(repositoryRoot, changedFiles) {
  if (Array.isArray(changedFiles)) {
    return [...new Set(changedFiles.map(normalize).filter(Boolean))]
      .filter(shouldInspect)
      .map((relativePath) => path.resolve(repositoryRoot, relativePath))
      .filter((absolutePath) => fs.existsSync(absolutePath) && fs.lstatSync(absolutePath).isFile())
      .sort();
  }

  const files = [];
  const visit = (absolutePath) => {
    const stat = fs.lstatSync(absolutePath);
    if (stat.isSymbolicLink()) return;
    const relativePath = normalize(path.relative(repositoryRoot, absolutePath));
    if (relativePath && relativePath.split("/").some((segment) => EXCLUDED_SEGMENTS.has(segment))) return;
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(absolutePath)) visit(path.join(absolutePath, entry));
      return;
    }
    if (stat.isFile() && shouldInspect(relativePath)) files.push(absolutePath);
  };
  visit(repositoryRoot);
  return files.sort();
}

export function readDatabaseIdentityChangedFiles(changedFilesPath) {
  if (!changedFilesPath) return null;
  return fs.readFileSync(changedFilesPath, "utf8").split(/\r?\n/u).map(normalize).filter(Boolean);
}

export function scanDatabaseRuntimeIdentity({ repositoryRoot = DEFAULT_ROOT, changedFiles } = {}) {
  const root = path.resolve(repositoryRoot);
  const normalizedChangedFiles = Array.isArray(changedFiles)
    ? [...new Set(changedFiles.map(normalize).filter(Boolean))].sort()
    : null;
  const files = collectFiles(root, normalizedChangedFiles);
  const findings = files.flatMap((file) => scanFile(root, file))
    .sort((left, right) => left.path.localeCompare(right.path) || left.line - right.line || left.rule_id.localeCompare(right.rule_id));
  const active = findings.filter((item) => !item.suppressed);
  const blocking = active.filter((item) => item.zone === "runtime");
  const byRule = {};
  for (const item of active) byRule[item.rule_id] = (byRule[item.rule_id] || 0) + 1;
  return {
    contract: "mad4b.database-runtime-identity-policy.v1",
    generated_at: new Date().toISOString(),
    scan_scope: normalizedChangedFiles ? "changed_files" : "repository",
    changed_file_count: normalizedChangedFiles?.length ?? null,
    role_env_contract: DATABASE_RUNTIME_IDENTITY_ENV,
    policy: {
      app_env_is_source_of_truth: true,
      literal_database_identity_allowed: false,
      nonempty_database_env_fallback_allowed: false,
      workflow_manual_schema_override_allowed: false,
      fail_closed_when_identity_missing: true,
    },
    summary: {
      scanned_files: files.length,
      finding_count: active.length,
      blocking_finding_count: blocking.length,
      suppressed_count: findings.length - active.length,
      by_rule: byRule,
    },
    findings,
    secrets_included: false,
  };
}

export function formatDatabaseRuntimeIdentityReport(report, format = "text") {
  if (format === "json") return JSON.stringify(report, null, 2);
  const blocking = report.findings.filter((item) => !item.suppressed && item.zone === "runtime");
  return [
    "Database runtime identity policy",
    `Scope: ${report.scan_scope}`,
    `Files scanned: ${report.summary.scanned_files}`,
    `Active findings: ${report.summary.finding_count}`,
    `Blocking runtime findings: ${report.summary.blocking_finding_count}`,
    `Suppressed findings: ${report.summary.suppressed_count}`,
    ...blocking.map((item) => `${item.rule_id} ${item.path}:${item.line} ${item.message}`),
  ].join("\n");
}

function parseArgs(argv) {
  const options = {
    repositoryRoot: DEFAULT_ROOT,
    changedFilesPath: "",
    outputPath: "",
    format: "text",
    reportOnly: false,
  };
  for (const argument of argv) {
    if (argument === "--report-only") options.reportOnly = true;
    else if (argument.startsWith("--root=")) options.repositoryRoot = path.resolve(argument.slice(7));
    else if (argument.startsWith("--changed-files-from=")) options.changedFilesPath = path.resolve(argument.slice(21));
    else if (argument.startsWith("--output=")) options.outputPath = path.resolve(argument.slice(9));
    else if (argument.startsWith("--format=")) options.format = argument.slice(9);
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const changedFiles = readDatabaseIdentityChangedFiles(options.changedFilesPath);
    const report = scanDatabaseRuntimeIdentity({ repositoryRoot: options.repositoryRoot, changedFiles });
    if (options.outputPath) {
      fs.mkdirSync(path.dirname(options.outputPath), { recursive: true });
      fs.writeFileSync(options.outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    }
    console.log(formatDatabaseRuntimeIdentityReport(report, options.format));
    process.exitCode = !options.reportOnly && report.summary.blocking_finding_count > 0 ? 1 : 0;
  } catch (error) {
    console.error(`Database runtime identity policy failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
}

const executed = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (executed === import.meta.url) await main();
