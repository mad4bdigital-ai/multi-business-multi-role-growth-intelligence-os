#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(SCRIPT_DIR, "..", "..");
const DEFAULT_CONFIG = path.join(
  DEFAULT_ROOT,
  "http-generic-api",
  "context-kernel-hardcoding-scan.config.json",
);

const RULES = Object.freeze({
  fixed_customer_identifier: {
    severity: "high",
    message: "A UUID-like literal appears next to a customer-scoping field.",
    remediation: "Resolve it from authenticated principal evidence or a governed registry binding.",
  },
  zero_scope_fallback: {
    severity: "high",
    message: "An all-zero scope sentinel is used in a context-sensitive source file.",
    remediation: "Represent missing scope explicitly and fail closed.",
  },
  first_candidate_selection: {
    severity: "high",
    message: "The first context candidate is selected directly.",
    remediation: "Prove uniqueness or return an explicit ambiguity result.",
  },
  unproven_single_candidate_query: {
    severity: "medium",
    message: "A context-sensitive query is capped at one row without scanner-visible uniqueness evidence.",
    remediation: "Bind by an exact unique key or resolve all authorized candidates deterministically.",
  },
  silent_resolution_failure: {
    severity: "high",
    message: "A resolver or query failure is converted into an empty or null result.",
    remediation: "Return a structured dependency or resolution error.",
  },
  permissive_authority_default: {
    severity: "high",
    message: "A permissive authority mode appears to be used as a default.",
    remediation: "Default to deny and require an explicit governed authority decision.",
  },
  implicit_scope_default: {
    severity: "high",
    message: "A default scope object contains customer-scoping fields.",
    remediation: "Build scope from authenticated and authorized runtime context.",
  },
});

const CUSTOMER_CONTEXT = /(?:\b(?:tenant|user|workspace|brand|customer|resource|connection|provider(?:[_-]?account)?|principal|scope)(?:s)?(?:[_-]?(?:id|ref|key))?\b|(?:tenant|user|workspace|brand|customer|resource|connection|provideraccount|principal|scope)[A-Za-z0-9]+|[a-z][A-Za-z0-9]*(?:Tenant|User|Workspace|Brand|Customer|Resource|Connection|ProviderAccount|Principal|Scope)[A-Za-z0-9]*)/i;
const QUERY_CONTEXT = /\bSELECT\b[\s\S]*\b(?:tenants?|workspaces?|brands?|resources?|connections?|providers?|memberships?|authorit(?:y|ies)|scopes?)\b/i;
const AUTHORITY_CONTEXT = /(?:\b(?:grant|authority|permission|policy|access)(?:[_-]?(?:mode|type|level|key|ref|id))?\b|(?:grant|authority|permission|policy|access)(?:Mode|Type|Level|Key|Ref|Id)\b)/i;
const RESOLUTION_CONTEXT = /(?:\b(?:resolve|resolver|query|database|db|connection|tenant|workspace|brand|scope)(?:s)?\b|[a-z][A-Za-z0-9]*(?:Resolve|Resolver|Query|Database|Connection|Tenant|Workspace|Brand|Scope)[A-Za-z0-9]*)/i;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const ZERO_UUID = /\b0{8}-0{4}-0{4}-0{4}-0{12}\b/i;
const FIRST_CANDIDATE = /\b(?:rows|rowset|candidates|results|items|connections|memberships|tenants|workspaces|brands|resources|systems|providers)\s*\[\s*0\s*\]|\b(?:rows|rowset|candidates|results|items|connections|memberships|tenants|workspaces|brands|resources|systems|providers)\s*\.at\(\s*0\s*\)/i;
const SILENT_FAILURE = /\.catch\s*\(\s*(?:async\s*)?\(\s*\)\s*=>\s*(?:\[\s*\[\s*\]\s*\]|\[\s*\]|null|undefined)\s*\)/i;

function normalize(value) {
  return value.split(path.sep).join("/");
}

function normalizeChangedFile(value) {
  return normalize(String(value || "").trim()).replace(/^\.\//u, "");
}

function classifyZone(relativePath) {
  const normalized = `/${normalize(relativePath).toLowerCase()}`;
  const basename = path.posix.basename(normalized);
  if (normalized.includes("/migration") || normalized.includes("/migrations/")) return "migration";
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

function redactEvidence(value) {
  return value
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<uuid>")
    .replace(/\b(secret|token|password|api[_-]?key)\b\s*[:=]\s*["'`][^"'`]+["'`]/gi, "$1=<redacted>")
    .trim()
    .slice(0, 240);
}

function contextFor(lines, index, radius = 3) {
  return lines.slice(Math.max(0, index - radius), Math.min(lines.length, index + radius + 1)).join("\n");
}

function suppressionFor(lines, index, ruleId) {
  const candidate = lines.slice(Math.max(0, index - 2), index + 1).join("\n");
  const match = candidate.match(/context-kernel-scan:\s*allow\s+([a-z0-9_-]+)\s+--\s+(.{12,})/i);
  if (!match) return null;
  const requestedRule = match[1].toLowerCase();
  if (requestedRule !== "all" && requestedRule !== ruleId) return null;
  return match[2].trim();
}

function finding({ ruleId, relativePath, lineIndex, column = 1, evidence, lines, confidence = "medium" }) {
  const suppressionReason = suppressionFor(lines, lineIndex, ruleId);
  return {
    rule_id: ruleId,
    severity: RULES[ruleId].severity,
    confidence,
    zone: classifyZone(relativePath),
    path: normalize(relativePath),
    line: lineIndex + 1,
    column,
    message: RULES[ruleId].message,
    remediation: RULES[ruleId].remediation,
    evidence: redactEvidence(evidence),
    suppressed: Boolean(suppressionReason),
    suppression_reason: suppressionReason ?? "",
  };
}

function scanFile(repositoryRoot, absolutePath) {
  const relativePath = path.relative(repositoryRoot, absolutePath);
  const lines = fs.readFileSync(absolutePath, "utf8").split(/\r?\n/u);
  const findings = [];
  const seen = new Set();
  const add = (item) => {
    const key = `${item.rule_id}:${item.path}:${item.line}:${item.column}`;
    if (!seen.has(key)) {
      seen.add(key);
      findings.push(item);
    }
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const context = contextFor(lines, index);

    if (ZERO_UUID.test(line) && CUSTOMER_CONTEXT.test(context)) {
      add(finding({ ruleId: "zero_scope_fallback", relativePath, lineIndex: index, evidence: line, lines, confidence: "high" }));
    }

    UUID.lastIndex = 0;
    for (const match of line.matchAll(UUID)) {
      if (!ZERO_UUID.test(match[0]) && CUSTOMER_CONTEXT.test(context)) {
        add(finding({ ruleId: "fixed_customer_identifier", relativePath, lineIndex: index, column: match.index + 1, evidence: line, lines, confidence: "high" }));
      }
    }

    const first = line.match(FIRST_CANDIDATE);
    if (first) {
      add(finding({ ruleId: "first_candidate_selection", relativePath, lineIndex: index, column: first.index + 1, evidence: line, lines, confidence: "high" }));
    }

    if (/\bLIMIT\s+1\b/i.test(line) && QUERY_CONTEXT.test(context)) {
      add(finding({ ruleId: "unproven_single_candidate_query", relativePath, lineIndex: index, evidence: line, lines }));
    }

    if (SILENT_FAILURE.test(line) && RESOLUTION_CONTEXT.test(context)) {
      add(finding({ ruleId: "silent_resolution_failure", relativePath, lineIndex: index, evidence: line, lines, confidence: "high" }));
    }

    if (/(?:\?\?|\|\||=)\s*["'`]permissive["'`]/i.test(line) && AUTHORITY_CONTEXT.test(context)) {
      add(finding({ ruleId: "permissive_authority_default", relativePath, lineIndex: index, evidence: line, lines, confidence: "high" }));
    }

    if (
      /\bDEFAULT_(?:SCOPE|CONTEXT)\b/i.test(line) &&
      /\b(?:tenant|user|workspace|brand|customer)(?:_id|Id|Ref)?\s*:/i.test(context) &&
      /["'`][^"'`]+["'`]/.test(context)
    ) {
      add(finding({ ruleId: "implicit_scope_default", relativePath, lineIndex: index, evidence: line, lines }));
    }
  }
  return findings;
}

function changedFileSet(changedFiles) {
  if (!Array.isArray(changedFiles)) return null;
  return new Set(changedFiles.map(normalizeChangedFile).filter(Boolean));
}

function collectFiles(repositoryRoot, config, changedFiles) {
  const extensions = new Set(config.extensions);
  const changed = changedFileSet(changedFiles);
  const files = [];
  const visit = (absolutePath) => {
    const stat = fs.lstatSync(absolutePath);
    if (stat.isSymbolicLink()) return;
    const relativePath = path.relative(repositoryRoot, absolutePath);
    const normalizedRelativePath = normalize(relativePath);
    const segments = normalizedRelativePath.split("/");
    if (segments.some((segment) => config.exclude_path_segments.includes(segment))) return;
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(absolutePath)) visit(path.join(absolutePath, entry));
    } else if (
      stat.isFile() &&
      extensions.has(path.extname(absolutePath).toLowerCase()) &&
      (!changed || changed.has(normalizedRelativePath))
    ) {
      files.push(absolutePath);
    }
  };
  for (const root of config.scan_roots) {
    const absoluteRoot = path.resolve(repositoryRoot, root);
    if (fs.existsSync(absoluteRoot)) visit(absoluteRoot);
  }
  return [...new Set(files)].sort();
}

function readConfig(configPath) {
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  if (config.schema_version !== 1) throw new Error("Scanner config must use schema_version 1.");
  if (!Array.isArray(config.scan_roots) || !Array.isArray(config.extensions)) throw new Error("Scanner config is incomplete.");
  return config;
}

export function readChangedFiles(changedFilesPath) {
  if (!changedFilesPath) return null;
  return fs.readFileSync(changedFilesPath, "utf8").split(/\r?\n/u).map(normalizeChangedFile).filter(Boolean);
}

export function scanRepository({ repositoryRoot = DEFAULT_ROOT, configPath = DEFAULT_CONFIG, config, changedFiles } = {}) {
  const root = path.resolve(repositoryRoot);
  const resolvedConfig = config ?? readConfig(configPath);
  const normalizedChangedFiles = Array.isArray(changedFiles)
    ? [...new Set(changedFiles.map(normalizeChangedFile).filter(Boolean))].sort()
    : null;
  const files = collectFiles(root, resolvedConfig, normalizedChangedFiles);
  const findings = files
    .flatMap((file) => scanFile(root, file))
    .sort((left, right) => left.path.localeCompare(right.path) || left.line - right.line || left.rule_id.localeCompare(right.rule_id));
  const active = findings.filter((item) => !item.suppressed);
  const byRule = {};
  const byZone = {};
  for (const item of active) {
    byRule[item.rule_id] = (byRule[item.rule_id] ?? 0) + 1;
    byZone[item.zone] = (byZone[item.zone] ?? 0) + 1;
  }
  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    mode: resolvedConfig.mode ?? "report_only",
    scan_scope: normalizedChangedFiles ? "changed_files" : "repository",
    changed_file_count: normalizedChangedFiles?.length ?? null,
    repository_root: root,
    summary: {
      scanned_files: files.length,
      finding_count: active.length,
      suppressed_count: findings.length - active.length,
      runtime_finding_count: active.filter((item) => item.zone === "runtime").length,
      non_runtime_finding_count: active.filter((item) => item.zone !== "runtime").length,
      by_rule: byRule,
      by_zone: byZone,
    },
    findings,
  };
}

export function formatReport(report, format = "text") {
  if (format === "json") return JSON.stringify(report, null, 2);
  const active = report.findings.filter((item) => !item.suppressed);
  if (format === "github") {
    const annotations = active.map((item) => {
      const command = item.zone === "runtime" ? "warning" : "notice";
      const title = encodeURIComponent(`Context kernel ${report.mode}: ${item.rule_id}`);
      const message = `${item.message} ${item.remediation}`.replace(/[\r\n]+/g, " ");
      return `::${command} file=${item.path},line=${item.line},col=${item.column},title=${title}::${message}`;
    });
    annotations.push(`Context kernel scanner: ${report.summary.finding_count} findings across ${report.summary.scanned_files} files (${report.mode}, ${report.scan_scope}).`);
    return annotations.join("\n");
  }
  return [
    "Context kernel hardcoding scan",
    `Mode: ${report.mode}`,
    `Scope: ${report.scan_scope}`,
    `Files scanned: ${report.summary.scanned_files}`,
    `Unsuppressed findings: ${report.summary.finding_count}`,
    `Runtime findings: ${report.summary.runtime_finding_count}`,
    `Non-runtime findings: ${report.summary.non_runtime_finding_count}`,
    `Suppressed findings: ${report.summary.suppressed_count}`,
    ...active.map((item) => `${item.severity.toUpperCase()} ${item.rule_id} ${item.path}:${item.line}:${item.column} [${item.zone}] ${item.message}`),
  ].join("\n");
}

function parseArgs(argv) {
  const options = {
    repositoryRoot: DEFAULT_ROOT,
    configPath: DEFAULT_CONFIG,
    format: "text",
    outputPath: "",
    changedFilesPath: "",
    reportOnly: false,
    failOn: "",
  };
  for (const argument of argv) {
    if (argument === "--report-only") options.reportOnly = true;
    else if (argument.startsWith("--root=")) options.repositoryRoot = path.resolve(argument.slice(7));
    else if (argument.startsWith("--config=")) options.configPath = path.resolve(argument.slice(9));
    else if (argument.startsWith("--format=")) options.format = argument.slice(9);
    else if (argument.startsWith("--output=")) options.outputPath = path.resolve(argument.slice(9));
    else if (argument.startsWith("--changed-files-from=")) options.changedFilesPath = path.resolve(argument.slice(21));
    else if (argument.startsWith("--fail-on=")) options.failOn = argument.slice(10);
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const changedFiles = readChangedFiles(options.changedFilesPath);
    const report = scanRepository({
      repositoryRoot: options.repositoryRoot,
      configPath: options.configPath,
      changedFiles,
    });
    if (options.outputPath) {
      fs.mkdirSync(path.dirname(options.outputPath), { recursive: true });
      fs.writeFileSync(options.outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    }
    console.log(formatReport(report, options.format));
    process.exitCode = !options.reportOnly && options.failOn === "runtime" && report.summary.runtime_finding_count > 0 ? 1 : 0;
  } catch (error) {
    console.error(`Context kernel hardcoding scan failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
}

const executed = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (executed === import.meta.url) await main();
