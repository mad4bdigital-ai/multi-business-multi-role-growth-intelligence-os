#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);
const CONTRACT = "mad4b.repository-tool-discovery.v1";
const POLICY_CONTRACT = "mad4b.repository-maintenance-tool-governance.v1";
const DEFAULT_INVENTORY = "docs/repository-inventory.json";
const DEFAULT_ROOTS = Object.freeze([
  { path: "http-generic-api/scripts/maintenance-tools", registration: "explicit_registry_required" },
  { path: ".github/scripts", registration: "auto_catalog_read_only" },
]);
const DEFAULT_EXTENSIONS = Object.freeze([".mjs", ".cjs", ".js", ".py", ".sh"]);

function parseArguments(argv) {
  const result = {};
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    result[token.slice(2)] = argv[index + 1];
    index += 1;
  }
  return result;
}

function normalizePath(value) {
  return String(value || "").replaceAll("\\", "/").replace(/^\.\//u, "");
}

function parseChangedEntries(raw) {
  return String(raw || "")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const columns = line.split("\t");
      return { status: columns.length === 1 ? "M" : columns[0], path: normalizePath(columns.at(-1)) };
    });
}

function registrationMap(policy) {
  return new Map(Object.entries(policy.tools || {})
    .filter(([, tool]) => typeof tool?.entrypoint === "string")
    .map(([key, tool]) => [normalizePath(tool.entrypoint), { key, ...tool }]));
}

function discoveryConfig(policy) {
  const configured = policy.discovery || {};
  return {
    contract: configured.contract || CONTRACT,
    central_inventory_path: normalizePath(configured.central_inventory_path || DEFAULT_INVENTORY),
    roots: Array.isArray(configured.roots) && configured.roots.length ? configured.roots : DEFAULT_ROOTS,
    extensions: Array.isArray(configured.extensions) && configured.extensions.length ? configured.extensions : DEFAULT_EXTENSIONS,
    mutating_unregistered_changed_fails: configured.mutating_unregistered_changed_fails !== false,
    orphaned_registry_fails: configured.orphaned_registry_fails !== false,
    read_only_auto_catalog: configured.read_only_auto_catalog !== false,
  };
}

function mutationSignals(content) {
  const source = String(content || "");
  const signals = [];
  if (/\bgit\s+push\b/iu.test(source)) signals.push("git_push");
  if (/\bgh\s+api\b[\s\S]{0,500}?(?:(?:--method|-X)\s*(?:POST|PUT|PATCH|DELETE)\b|(?:-f|--field|--raw-field)\s+)/iu.test(source)) signals.push("gh_api_write");
  if (/\bgh\s+(?:pr\s+merge|workflow\s+(?:run|enable|disable))\b/iu.test(source)) signals.push("gh_mutation");
  if (/github\.rest\.[A-Za-z0-9_.]+\.(?:create|update|delete|merge|dispatch|rerun|cancel|enable|disable)[A-Za-z0-9_]*\s*\(/iu.test(source)) signals.push("github_rest_mutation");
  if (/\bcurl\b[^\n]*(?:-X|--request)\s*(?:POST|PUT|PATCH|DELETE)\b[^\n]*api\.github\.com/iu.test(source)) signals.push("github_api_curl_write");
  return [...new Set(signals)];
}

function rootForPath(path, roots) {
  return roots.find((root) => path === root.path || path.startsWith(`${root.path}/`)) || null;
}

function isCandidate(path, roots, extensions) {
  const root = rootForPath(path, roots);
  return Boolean(root && extensions.includes(extname(path).toLowerCase()));
}

function finding(code, path, message) {
  return { code, path, message };
}

export function validateDiscoveryInputs({ policy, inventory }) {
  const findings = [];
  const config = discoveryConfig(policy);
  if (policy.contract !== POLICY_CONTRACT) findings.push(finding("INVALID_POLICY_CONTRACT", ".github/repository-maintenance-tool-governance.json", `Expected ${POLICY_CONTRACT}.`));
  if (config.contract !== CONTRACT) findings.push(finding("INVALID_DISCOVERY_CONTRACT", ".github/repository-maintenance-tool-governance.json", `Discovery contract must be ${CONTRACT}.`));
  if (!Array.isArray(config.roots) || config.roots.length < 2) findings.push(finding("INVALID_DISCOVERY_ROOTS", ".github/repository-maintenance-tool-governance.json", "Discovery must cover the governed maintenance-tool root and the GitHub helper-script root."));
  for (const root of config.roots) {
    if (!root?.path || !["explicit_registry_required", "auto_catalog_read_only"].includes(root.registration)) {
      findings.push(finding("INVALID_DISCOVERY_ROOT", ".github/repository-maintenance-tool-governance.json", "Each discovery root must declare a path and supported registration mode."));
    }
  }
  if (!inventory || inventory.schemaVersion !== 1 || inventory.generatedFrom !== "git-index" || inventory.deterministic !== true || !Array.isArray(inventory.files)) {
    findings.push(finding("INVALID_CENTRAL_INVENTORY", config.central_inventory_path, "Central repository inventory must be deterministic schemaVersion=1 generated from git-index with a files array."));
  }
  return findings;
}

export async function discoverRepositoryTools({
  policy,
  inventory,
  trackedPaths,
  changedEntries = [],
  readText,
  candidateSha = null,
  baseSha = null,
}) {
  const config = discoveryConfig(policy);
  const findings = validateDiscoveryInputs({ policy, inventory });
  const tracked = [...new Set((trackedPaths || []).map(normalizePath).filter(Boolean))].sort();
  const trackedSet = new Set(tracked);
  const changedSet = new Set(changedEntries.filter((entry) => !String(entry.status || "").startsWith("D")).map((entry) => normalizePath(entry.path)));
  const inventorySet = new Set((inventory?.files || []).map((file) => normalizePath(file.path)).filter(Boolean));
  const registered = registrationMap(policy);
  const candidates = tracked.filter((path) => isCandidate(path, config.roots, config.extensions));
  const catalog = [];

  for (const path of candidates) {
    const root = rootForPath(path, config.roots);
    const registration = registered.get(path) || null;
    let content = "";
    try {
      content = await readText(path);
    } catch {
      findings.push(finding("UNREADABLE_DISCOVERED_TOOL", path, "Discovered repository tool must be readable for lifecycle classification."));
      catalog.push({ path, root: root?.path || null, classification: "unreadable", authority_registered: Boolean(registration), changed: changedSet.has(path), central_inventory_status: inventorySet.has(path) ? "indexed" : "pending_refresh", mutation_signals: [] });
      continue;
    }

    const signals = mutationSignals(content);
    const mutating = signals.length > 0;
    let classification = "auto_catalogued_read_only";
    if (registration) classification = registration.mode === "mutating" ? "registered_mutating" : "registered_read_only";
    else if (root?.registration === "explicit_registry_required") classification = "unregistered_governed_tool";
    else if (mutating) classification = changedSet.has(path) ? "unregistered_mutating_changed" : "legacy_unregistered_mutating";

    if (!registration && root?.registration === "explicit_registry_required") {
      findings.push(finding("DISCOVERED_TOOL_REQUIRES_REGISTRY", path, "Every reusable tool under the governed maintenance-tool root must have an explicit authority-registry entry."));
    }
    if (!registration && mutating && root?.registration === "auto_catalog_read_only" && changedSet.has(path) && config.mutating_unregistered_changed_fails) {
      findings.push(finding("MUTATING_TOOL_OUTSIDE_GOVERNED_ROOT", path, "A new or changed repository-mutating helper may not rely on auto-cataloguing; move it under the governed maintenance-tool root and register explicit mutation authority."));
    }
    if (registration?.mode === "read_only" && mutating) {
      findings.push(finding("DISCOVERY_MODE_MISMATCH", path, `Registered read-only tool ${registration.key} exposes repository-mutation signals: ${signals.join(", ")}.`));
    }

    catalog.push({
      path,
      root: root?.path || null,
      classification,
      authority_registered: Boolean(registration),
      authority_key: registration?.key || null,
      authority_mode: registration?.mode || null,
      changed: changedSet.has(path),
      central_inventory_status: inventorySet.has(path) ? "indexed" : "pending_refresh",
      mutation_signals: signals,
    });
  }

  for (const [entrypoint, tool] of registered) {
    if (!trackedSet.has(entrypoint) && config.orphaned_registry_fails) {
      findings.push(finding("ORPHANED_REGISTERED_TOOL", entrypoint, `Authority registry entry ${tool.key} points to a file absent from the live Git index.`));
    }
  }

  const counts = {
    tracked_files: tracked.length,
    central_inventory_files: inventory?.files?.length || 0,
    discovered_tools: catalog.length,
    registered_tools: catalog.filter((item) => item.authority_registered).length,
    auto_catalogued_read_only: catalog.filter((item) => item.classification === "auto_catalogued_read_only").length,
    unregistered_mutating_changed: catalog.filter((item) => item.classification === "unregistered_mutating_changed").length,
    legacy_unregistered_mutating: catalog.filter((item) => item.classification === "legacy_unregistered_mutating").length,
    central_inventory_pending_refresh: catalog.filter((item) => item.central_inventory_status === "pending_refresh").length,
  };

  return {
    contract: CONTRACT,
    ok: findings.length === 0,
    candidate_sha: candidateSha,
    base_sha: baseSha,
    discovery_source: "live_git_index",
    central_inventory: {
      path: config.central_inventory_path,
      schema_version: inventory?.schemaVersion ?? null,
      generated_from: inventory?.generatedFrom ?? null,
      deterministic: inventory?.deterministic === true,
      role: "coverage_reference_not_execution_authority",
    },
    authority_source: ".github/repository-maintenance-tool-governance.json",
    authority_rule: "read_only_helpers_auto_catalogued; mutating_or_governed_maintenance_tools_require_explicit_registry",
    counts,
    catalog,
    findings,
    canonical: true,
    repository_mutation_executed: false,
    protected_ref_mutation_executed: false,
    secrets_included: false,
  };
}

function renderMarkdown(report) {
  const rows = report.findings.length
    ? report.findings.map((item) => `| ${item.code} | \`${item.path}\` | ${item.message} |`).join("\n")
    : "| none | — | Live discovery and central-inventory coverage satisfy the lifecycle contract. |";
  return `# Repository Tool Discovery\n\n- Contract: \`${report.contract}\`\n- Candidate SHA: \`${report.candidate_sha || "n/a"}\`\n- Result: **${report.ok ? "PASS" : "FAIL"}**\n- Discovery source: live Git index\n- Central inventory role: coverage reference, not execution authority\n- Discovered tools: ${report.counts.discovered_tools}\n- Explicitly registered: ${report.counts.registered_tools}\n- Auto-catalogued read-only: ${report.counts.auto_catalogued_read_only}\n- Changed unregistered mutating: ${report.counts.unregistered_mutating_changed}\n- Central inventory pending refresh: ${report.counts.central_inventory_pending_refresh}\n- Repository mutation executed: no\n- Secrets included: no\n\n| Code | Path | Finding |\n|---|---|---|\n${rows}\n`;
}

async function liveTrackedPaths() {
  const { stdout } = await execFileAsync("git", ["ls-files", "-z"], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  return stdout.split("\0").filter(Boolean).map(normalizePath);
}

async function main() {
  const args = parseArguments(process.argv);
  const policyPath = args.policy || ".github/repository-maintenance-tool-governance.json";
  const inventoryPath = args.inventory || DEFAULT_INVENTORY;
  const changedFilesPath = args["changed-files"];
  const outputDirectory = args["output-dir"] || ".artifacts/repository-tool-lifecycle";
  if (!changedFilesPath) throw new Error("--changed-files is required");

  const [policy, inventory, changedRaw, trackedPaths] = await Promise.all([
    readFile(policyPath, "utf8").then(JSON.parse),
    readFile(inventoryPath, "utf8").then(JSON.parse),
    readFile(changedFilesPath, "utf8"),
    liveTrackedPaths(),
  ]);
  const report = await discoverRepositoryTools({
    policy,
    inventory,
    trackedPaths,
    changedEntries: parseChangedEntries(changedRaw),
    readText: (path) => readFile(path, "utf8"),
    candidateSha: process.env.CANDIDATE_SHA || null,
    baseSha: process.env.BASE_SHA || null,
  });

  await mkdir(outputDirectory, { recursive: true });
  await writeFile(resolve(outputDirectory, "repository-tool-discovery.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(resolve(outputDirectory, "repository-tool-discovery.md"), renderMarkdown(report), "utf8");
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (!report.ok) process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
