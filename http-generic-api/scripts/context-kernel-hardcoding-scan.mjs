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
const DIRECT_SELECTION_RULE = "first_candidate_selection";
const DIRECT_SELECTION = /\b([A-Za-z_$][A-Za-z0-9_$]*)\s*(?:\[\s*0\s*\]|\.at\(\s*0\s*\))/u;

function normalize(value) {
  return String(value || "").split(path.sep).join("/").replace(/^\.\//u, "");
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function addRange(target, file, start, count) {
  if (!file || count <= 0) return;
  const normalizedFile = normalize(file);
  const ranges = target.get(normalizedFile) ?? [];
  ranges.push({ start, end: start + count - 1 });
  target.set(normalizedFile, ranges);
}

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

function tableEntity(tableName) {
  const segments = String(tableName || "").toLowerCase().split("_").filter(Boolean);
  const tail = segments.length > 0 ? segments[segments.length - 1] : "";
  if (tail.endsWith("ies") && tail.length > 3) return `${tail.slice(0, -3)}y`;
  if (tail.endsWith("s") && tail.length > 1) return tail.slice(0, -1);
  return tail;
}

function assignedSelectQueries(context, variableName) {
  const escaped = escapeRegex(variableName);
  const assignment = new RegExp(`(?:const|let)\\s*\\[\\s*${escaped}\\s*\\]\\s*=\\s*await[\\s\\S]*?\\.query\\s*\\(`, "u");
  const assignmentIndex = context.search(assignment);
  if (assignmentIndex < 0) return [];
  const compact = context.slice(assignmentIndex).replace(/\s+/gu, " ");
  return compact.match(/\bSELECT\b[\s\S]*?\bLIMIT\s+(?:1|2)\b/giu) ?? [];
}

function exactKeyQueryVisible(query) {
  const tableName = query.match(/\bFROM\s+`?([A-Za-z0-9_]+)`?/iu)?.[1] ?? "";
  const entity = tableEntity(tableName);
  const whereClause = query.match(/\bWHERE\b([\s\S]*?)\bLIMIT\s+(?:1|2)\b/iu)?.[1]?.trim();
  if (!entity || !whereClause || /\b(?:OR|IN|LIKE|BETWEEN|GROUP\s+BY|ORDER\s+BY)\b/iu.test(whereClause)) return false;
  const predicates = whereClause.split(/\bAND\b/iu).map((value) => value.trim()).filter(Boolean);
  let primaryIdentityBound = false;
  for (const predicate of predicates) {
    const normalized = predicate.replace(/^\(+|\)+$/gu, "").trim();
    const parameterMatch = normalized.match(/^(?:[A-Za-z0-9_]+\.)?([A-Za-z0-9_]+)\s*=\s*\?$/u);
    if (parameterMatch) {
      const column = parameterMatch[1].toLowerCase();
      if (column === "id" || column === `${entity}_id` || column === `${entity}_key`) primaryIdentityBound = true;
      else if (!/(?:_id|_key|_sha256)$/u.test(column)) return false;
      continue;
    }
    if (/^(?:[A-Za-z0-9_]+\.)?status\s*=\s*["'][A-Za-z0-9_-]+["']$/iu.test(normalized)) continue;
    return false;
  }
  return primaryIdentityBound;
}

function hasExactKeyQueryProof(context, variableName) {
  return assignedSelectQueries(context, variableName).some(exactKeyQueryVisible);
}

function hasDeterministicOrderProof(context, variableName) {
  return assignedSelectQueries(context, variableName).some((query) => {
    if (!/\bLIMIT\s+2\b/iu.test(query)) return false;
    const tableName = query.match(/\bFROM\s+`?([A-Za-z0-9_]+)`?/iu)?.[1] ?? "";
    const entity = tableEntity(tableName);
    const ordering = query.match(/\bORDER\s+BY\s+([\s\S]*?)\bLIMIT\s+2\b/iu)?.[1]?.trim();
    if (!entity || !ordering) return false;
    const terms = ordering.split(",").map((value) => value.trim()).filter(Boolean);
    if (terms.length === 0) return false;
    const finalTerm = terms[terms.length - 1].match(/^(?:[A-Za-z0-9_]+\.)?([A-Za-z0-9_]+)(?:\s+(?:ASC|DESC))?$/iu);
    if (!finalTerm) return false;
    const column = finalTerm[1].toLowerCase();
    return column === "id" || column === `${entity}_id` || column === `${entity}_key`;
  });
}

function hasCardinalityGuard(context, variableName) {
  const escaped = escapeRegex(variableName);
  const patterns = [
    new RegExp(`if\\s*\\([^&|)]*\\b${escaped}\\.length\\s*>\\s*1[^&|)]*\\)\\s*throw\\b`, "su"),
    new RegExp(`if\\s*\\([^&|)]*\\b${escaped}\\.length\\s*>=\\s*2[^&|)]*\\)\\s*throw\\b`, "su"),
    new RegExp(`if\\s*\\([^&|)]*\\b${escaped}\\.length\\s*!={1,2}\\s*1[^&|)]*\\)\\s*throw\\b`, "su"),
  ];
  return patterns.some((pattern) => pattern.test(context));
}

export function hasScannerVisibleSelectionProof({ repositoryRoot, finding } = {}) {
  if (!finding || finding.rule_id !== DIRECT_SELECTION_RULE) return false;
  const root = path.resolve(repositoryRoot || ".");
  const absolutePath = path.resolve(root, normalize(finding.path));
  if (absolutePath !== root && !absolutePath.startsWith(`${root}${path.sep}`)) return false;
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) return false;
  const lines = fs.readFileSync(absolutePath, "utf8").split(/\r?\n/u);
  const lineIndex = Number(finding.line) - 1;
  if (!Number.isInteger(lineIndex) || lineIndex < 0 || lineIndex >= lines.length) return false;
  const selection = lines[lineIndex].match(DIRECT_SELECTION);
  if (!selection) return false;
  const context = lines.slice(Math.max(0, lineIndex - 24), Math.min(lines.length, lineIndex + 3)).join("\n");
  return hasCardinalityGuard(context, selection[1])
    || hasExactKeyQueryProof(context, selection[1])
    || hasDeterministicOrderProof(context, selection[1]);
}

function applyProofAwareSuppressions(findings, repositoryRoot) {
  return findings.map((finding) => {
    if (finding.suppressed || !hasScannerVisibleSelectionProof({ repositoryRoot, finding })) return finding;
    return {
      ...finding,
      suppressed: true,
      suppression_reason: "Scanner-visible uniqueness or deterministic authority proof precedes candidate selection.",
    };
  });
}

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

  const changedFindings = report.findings.filter((item) => lineIsChanged(rangesByFile, item));
  const findings = applyProofAwareSuppressions(changedFindings, repositoryRoot);
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
