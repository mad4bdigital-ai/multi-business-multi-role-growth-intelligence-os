#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import {
  formatReport,
  readChangedFiles,
  scanRepository as scanRepositoryByFile,
} from "./context-kernel-hardcoding-scan-core.mjs";

export { formatReport, readChangedFiles };

const DIFF_FILE_HEADER = /^\+\+\+ b\/(.+)$/u;
const DIFF_HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/u;

function normalize(value) {
  return String(value || "").split(path.sep).join("/").replace(/^\.\//u, "");
}

function addRange(target, file, start, count) {
  if (!file || count <= 0) return;
  const normalizedFile = normalize(file);
  const ranges = target.get(normalizedFile) ?? [];
  ranges.push({ start, end: start + count - 1 });
  target.set(normalizedFile, ranges);
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

function yamlAncestorKeys(lines, index) {
  const keys = [];
  let ceiling = lines[index].match(/^\s*/u)?.[0].length ?? 0;
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const candidate = lines[cursor];
    const trimmed = candidate.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const indent = candidate.match(/^\s*/u)?.[0].length ?? 0;
    if (indent >= ceiling) continue;
    const key = trimmed.match(/^([A-Za-z0-9_-]+):(?:\s|$)/u)?.[1];
    if (!key) continue;
    keys.push(key.toLowerCase());
    ceiling = indent;
    if (indent === 0) break;
  }
  return keys;
}

function isStructuredExampleValue(relativePath, lines, index) {
  if (!/\.ya?ml$/iu.test(relativePath)) return false;
  if (/^\s*examples?:\s*\S/iu.test(lines[index])) return true;
  return yamlAncestorKeys(lines, index).some((key) => key === "example" || key === "examples");
}

function isScannerVisibleExactKeyLookup(line) {
  const compact = String(line || "").replace(/\s+/gu, " ");
  const where = compact.match(/\bWHERE\b([\s\S]*?)\bLIMIT\s+1\b/iu)?.[1]?.trim();
  if (!where || /\b(?:OR|IN|LIKE|BETWEEN|ORDER\s+BY|GROUP\s+BY)\b/iu.test(where)) return false;
  const predicates = where.split(/\bAND\b/iu).map((value) => value.trim()).filter(Boolean);
  let exactKeyCount = 0;
  for (const predicate of predicates) {
    const parameterMatch = predicate.match(/^(?:[A-Za-z0-9_]+\.)?([A-Za-z0-9_]+)\s*=\s*\?$/u);
    if (parameterMatch) {
      if (/(?:^id$|_id$|_key$)/iu.test(parameterMatch[1])) exactKeyCount += 1;
      else return false;
      continue;
    }
    if (/^(?:[A-Za-z0-9_]+\.)?status\s*=\s*["'][A-Za-z0-9_-]+["']$/iu.test(predicate)) continue;
    return false;
  }
  return exactKeyCount > 0;
}

function suppressionFor(lines, index, ruleId) {
  const candidate = lines.slice(Math.max(0, index - 2), index + 1).join("\n");
  const match = candidate.match(/context-kernel-scan:\s*allow\s+([a-z0-9_-]+)\s+--\s+(.{12,})/i);
  if (!match) return null;
  const requestedRule = match[1].toLowerCase();
  if (requestedRule !== "all" && requestedRule !== ruleId) return null;
  return match[2].trim();
}

function configuredSuppression(item, config) {
  for (const approved of config.approved_findings || []) {
    if (normalizeChangedFile(approved.path) !== item.path) continue;
    if (String(approved.rule_id || "").toLowerCase() !== item.rule_id) continue;
    if (approved.line != null && Number(approved.line) !== item.line) continue;
    const reason = String(approved.reason || "").trim();
    if (reason.length < 12) continue;
    return reason;
  }
  return null;
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
      if (!ZERO_UUID.test(match[0]) && CUSTOMER_CONTEXT.test(context) && !isStructuredExampleValue(relativePath, lines, index)) {
        add(finding({ ruleId: "fixed_customer_identifier", relativePath, lineIndex: index, column: match.index + 1, evidence: line, lines, confidence: "high" }));
      }
    }

    const first = line.match(FIRST_CANDIDATE);
    if (first) {
      add(finding({ ruleId: "first_candidate_selection", relativePath, lineIndex: index, column: first.index + 1, evidence: line, lines, confidence: "high" }));
    }

    if (/\bLIMIT\s+1\b/i.test(line) && QUERY_CONTEXT.test(context) && !isScannerVisibleExactKeyLookup(line)) {
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
export function parseChangedLineRanges(diffText) {
  const rangesByFile = new Map();
  let currentFile = "";
  for (const line of String(diffText || "").split(/\r?\n/u)) {
    const fileMatch = line.match(DIFF_FILE_HEADER);
    if (fileMatch) {
      currentFile = fileMatch[1];
      continue;
    }
    const hunkMatch = line.match(DIFF_HUNK_HEADER);
    if (!hunkMatch || !currentFile) continue;
    addRange(
      rangesByFile,
      currentFile,
      Number(hunkMatch[1]),
      hunkMatch[2] === undefined ? 1 : Number(hunkMatch[2]),
    );
  }
  return rangesByFile;
}

function eventBaseSha() {
  const eventPath = String(process.env.GITHUB_EVENT_PATH || "").trim();
  if (!eventPath || !fs.existsSync(eventPath)) return "";
  try {
    const event = JSON.parse(fs.readFileSync(eventPath, "utf8"));
    const pullRequestBase = String(event?.pull_request?.base?.sha || "").trim();
    if (pullRequestBase) return pullRequestBase;
    const pushBefore = String(event?.before || "").trim();
    if (pushBefore && !/^0+$/u.test(pushBefore)) return pushBefore;
  } catch {
    return "";
  }
  return "";
}

function readConfig(configPath) {
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  if (config.schema_version !== 1) throw new Error("Scanner config must use schema_version 1.");
  if (!Array.isArray(config.scan_roots) || !Array.isArray(config.extensions)) throw new Error("Scanner config is incomplete.");
  if (config.approved_findings != null && !Array.isArray(config.approved_findings)) throw new Error("approved_findings must be an array when provided.");
  return config;
function resolveChangedLineRanges(repositoryRoot, changedFiles) {
  if (!Array.isArray(changedFiles) || changedFiles.length === 0) return null;
  const baseSha = eventBaseSha();
  if (!baseSha) return null;
  try {
    const diffText = execFileSync(
      "git",
      ["diff", "--unified=0", "--no-color", `${baseSha}...HEAD`, "--", ...changedFiles],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 32 * 1024 * 1024,
      },
    );
    return parseChangedLineRanges(diffText);
  } catch {
    return null;
  }
}

function lineIsChanged(rangesByFile, finding) {
  const ranges = rangesByFile.get(normalize(finding.path));
  if (!Array.isArray(ranges)) return false;
  return ranges.some((range) => finding.line >= range.start && finding.line <= range.end);
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
    .map((item) => {
      if (item.suppressed) return item;
      const reason = configuredSuppression(item, resolvedConfig);
      return reason ? { ...item, suppressed: true, suppression_reason: reason } : item;
    })
    .sort((left, right) => left.path.localeCompare(right.path) || left.line - right.line || left.rule_id.localeCompare(right.rule_id));
function summarize(findings) {
  const active = findings.filter((item) => !item.suppressed);
  const byRule = {};
  const byZone = {};
  for (const item of active) {
    byRule[item.rule_id] = (byRule[item.rule_id] ?? 0) + 1;
    byZone[item.zone] = (byZone[item.zone] ?? 0) + 1;
  }
  return {
    finding_count: active.length,
    suppressed_count: findings.length - active.length,
    runtime_finding_count: active.filter((item) => item.zone === "runtime").length,
    non_runtime_finding_count: active.filter((item) => item.zone !== "runtime").length,
    by_rule: byRule,
    by_zone: byZone,
  };
}

export function scanRepository(options = {}) {
  const report = scanRepositoryByFile(options);
  const changedFiles = Array.isArray(options.changedFiles)
    ? [...new Set(options.changedFiles.map(normalize).filter(Boolean))].sort()
    : null;
  if (!changedFiles) return report;

  const repositoryRoot = path.resolve(options.repositoryRoot || report.repository_root);
  const rangesByFile = options.changedLineRanges ?? resolveChangedLineRanges(repositoryRoot, changedFiles);
  if (!rangesByFile) return report;

  const findings = report.findings.filter((item) => lineIsChanged(rangesByFile, item));
  return {
    ...report,
    scan_scope: "changed_lines",
    summary: {
      ...report.summary,
      ...summarize(findings),
    },
    findings,
  };
}

function parseArgs(argv) {
  const options = {
    repositoryRoot: "",
    configPath: "",
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
    const scanOptions = { changedFiles };
    if (options.repositoryRoot) scanOptions.repositoryRoot = options.repositoryRoot;
    if (options.configPath) scanOptions.configPath = options.configPath;
    const report = scanRepository(scanOptions);
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
