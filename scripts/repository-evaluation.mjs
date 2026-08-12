import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DEFAULT_OUTPUTS = {
  json: "docs/repository-evaluation.json",
  markdown: "docs/repository-evaluation.md",
  summary: "docs/repository-evaluation-summary.json",
};
const EVALUATION_OUTPUT_PATHS = new Set(Object.values(DEFAULT_OUTPUTS));
const CI_SURFACE_POLICY_PATH = "docs/repository-ci-surface-policy.json";
const DEPENDENCY_AUDIT_POLICY_PATH = "docs/repository-dependency-audit-policy.json";
const LARGE_FILE_POLICY_PATH = "docs/repository-large-file-policy.json";
const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
const TEXT_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".json", ".yml", ".yaml", ".md", ".sql", ".cs", ".sh", ".ps1", ".html", ".css"]);

function parseArgs(argv) {
  const options = { check: false, diff: false, enforce: false, skipChecks: false, includeNetwork: false, includeEnvironment: false, baseline: null, outputs: { ...DEFAULT_OUTPUTS } };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--check") options.check = true;
    else if (argument === "--diff") options.diff = true;
    else if (argument === "--enforce") options.enforce = true;
    else if (argument === "--skip-checks") options.skipChecks = true;
    else if (argument === "--include-network") options.includeNetwork = true;
    else if (argument === "--include-environment") options.includeEnvironment = true;
    else if (argument === "--baseline") {
      options.baseline = argv[index + 1];
      index += 1;
    } else if (argument.startsWith("--baseline=")) options.baseline = argument.slice("--baseline=".length);
    else if (argument.startsWith("--json=")) options.outputs.json = argument.slice("--json=".length);
    else if (argument.startsWith("--markdown=")) options.outputs.markdown = argument.slice("--markdown=".length);
    else if (argument.startsWith("--summary=")) options.outputs.summary = argument.slice("--summary=".length);
    else throw new Error(`Unknown argument: ${argument}`);
  }
  options.outputs.json = process.env.EVALUATION_JSON ?? options.outputs.json;
  options.outputs.markdown = process.env.EVALUATION_MARKDOWN ?? options.outputs.markdown;
  options.outputs.summary = process.env.EVALUATION_SUMMARY ?? options.outputs.summary;
  return options;
}

function canonical(value) {
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256").update(typeof value === "string" ? value : canonical(value)).digest("hex");
}

function absolute(relativePath) {
  return relativePath.startsWith("/") ? relativePath : join(ROOT, relativePath);
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(absolute(relativePath), "utf8"));
}

function readOptionalJson(relativePath, fallback) {
  return existsSync(absolute(relativePath)) ? readJson(relativePath) : fallback;
}

function commandName() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function runCheck(id, args, cwd = ROOT, skip = false) {
  const command = commandName();
  if (skip) return { id, command: [command, ...args], status: "not-run", exitCode: null };
  const result = spawnSync(command, args, { cwd, encoding: "utf8", timeout: 180000, maxBuffer: 2 * 1024 * 1024 });
  const timedOut = result.error?.code === "ETIMEDOUT";
  return {
    id,
    command: [command, ...args],
    status: timedOut ? "failed" : result.status === 0 ? "passed" : "failed",
    exitCode: timedOut ? null : result.status,
  };
}

function runNodeCheck(id, args, cwd = ROOT, skip = false) {
  const command = "node";
  if (skip) return { id, command: [command, ...args], status: "not-run", exitCode: null };
  const result = spawnSync(command, args, { cwd, encoding: "utf8", timeout: 180000, maxBuffer: 2 * 1024 * 1024 });
  const timedOut = result.error?.code === "ETIMEDOUT";
  return {
    id,
    command: [command, ...args],
    status: timedOut ? "failed" : result.status === 0 ? "passed" : "failed",
    exitCode: timedOut ? null : result.status,
  };
}

function dotnetSignals(inventory, includeEnvironment) {
  const required = inventory.files.some((file) => /(?:^|\/)[^/]+\.(?:csproj|sln)$/.test(file.path) || /(?:^|\/)global\.json$/.test(file.path));
  if (!required) return { required: false, status: "not-required", available: null, exitCode: null, output: "" };
  const sdkContracted = inventory.files
    .filter((file) => file.category === "ci-workflows")
    .some((file) => /actions\/setup-dotnet@/u.test(readFileSync(absolute(file.path), "utf8")) && /dotnet-version\s*:/u.test(readFileSync(absolute(file.path), "utf8")));
  if (!includeEnvironment) {
    return {
      required: true,
      status: sdkContracted ? "contracted" : "not-evaluated",
      available: null,
      exitCode: null,
      output: sdkContracted
        ? "Repository CI declares an explicit setup-dotnet SDK contract; local binary probe is opt-in."
        : "Environment probe disabled in deterministic mode.",
    };
  }
  return { required: true, ...runBinary("dotnet", ["--version"]) };
}

function runBinary(binary, args, cwd = ROOT) {
  const result = spawnSync(binary, args, { cwd, encoding: "utf8", timeout: 60000, maxBuffer: 512 * 1024 });
  return {
    available: !result.error,
    status: result.error ? "not-available" : result.status === 0 ? "passed" : "failed",
    exitCode: result.error ? null : result.status,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`.slice(0, 2000),
  };
}

function loadInventory() {
  const inventoryPath = absolute("docs/repository-inventory.json");
  if (!existsSync(inventoryPath)) throw new Error("Repository inventory is missing; run npm run inventory:write first");
  const inventory = JSON.parse(readFileSync(inventoryPath, "utf8"));
  if (!inventory.deterministic || !Array.isArray(inventory.files)) throw new Error("Repository inventory contract is invalid");
  return inventory;
}

function workflowSignals(inventory) {
  const workflows = inventory.files.filter((file) => file.category === "ci-workflows");
  let explicitPermissions = 0;
  let broadWrite = 0;
  let unpinnedActions = 0;
  for (const file of workflows) {
    const content = readFileSync(absolute(file.path), "utf8");
    if (/^\s*permissions\s*:/m.test(content)) explicitPermissions += 1;
    if (/^\s*permissions\s*:\s*(?:write-all|write)\s*$/m.test(content)) broadWrite += 1;
    for (const match of content.matchAll(/uses:\s*[^\s@]+@([^\s]+)/g)) {
      if (!/^[0-9a-f]{40}$/i.test(match[1])) unpinnedActions += 1;
    }
  }
  return { workflowCount: workflows.length, explicitPermissions, missingExplicitPermissions: workflows.length - explicitPermissions, broadWrite, unpinnedActions };
}

function isPlaceholderToken(token) {
  const normalized = token.toLowerCase();
  return /(?:should[_-]?never|never[_-]?be|example|sample|dummy|placeholder|test|fake|redacted|abcdefghijklmnop|x{8,})/.test(normalized);
}

function extractSecretMatches(content) {
  const patterns = [/\b(?:ghp_|github_pat_)[A-Za-z0-9_]{20,}\b/g, /\bsk-[A-Za-z0-9_-]{20,}\b/g, /\bAKIA[0-9A-Z]{16}\b/g];
  const matches = [];
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      const token = match[0];
      matches.push({ token, placeholder: isPlaceholderToken(token) });
    }
  }
  return matches;
}

function secretSignals(inventory) {
  const suspected = [];
  const placeholders = [];
  let scanned = 0;
  for (const file of inventory.files) {
    const extension = file.extension?.toLowerCase();
    if (!TEXT_EXTENSIONS.has(extension) || file.bytes > 2 * 1024 * 1024) continue;
    scanned += 1;
    const content = readFileSync(absolute(file.path), "utf8");
    const matches = extractSecretMatches(content);
    if (matches.some((match) => !match.placeholder)) suspected.push(file.path);
    if (matches.some((match) => match.placeholder)) placeholders.push(file.path);
  }
  return { trackedTextFilesScanned: scanned, suspectedSecretFiles: [...new Set(suspected)].sort(), placeholderOnlyFiles: [...new Set(placeholders)].sort() };
}

function auditSignals(inventory, includeNetwork) {
  const lockfiles = inventory.files.filter((file) => file.path.endsWith("package-lock.json"));
  if (!includeNetwork) return { mode: "not-run", packages: lockfiles.map((file) => file.path), vulnerabilities: null };
  const results = [];
  for (const lockfile of lockfiles) {
    const result = spawnSync(commandName(), ["audit", "--json", "--omit=dev"], { cwd: dirname(absolute(lockfile.path)), encoding: "utf8", timeout: 180000, maxBuffer: 2 * 1024 * 1024 });
    let parsed = {};
    try { parsed = JSON.parse(result.stdout || "{}"); } catch { parsed = {}; }
    const vulnerabilities = parsed.metadata?.vulnerabilities ?? {};
    results.push({ package: lockfile.path, status: result.status === 0 && (vulnerabilities.total ?? 0) === 0 ? "passed" : "findings", vulnerabilities });
  }
  return { mode: "network", packages: results };
}

function addGap(gaps, gap) {
  gaps.push({
    gapId: gap.gapId,
    domain: gap.domain,
    severity: gap.severity,
    status: gap.status,
    blocking: Boolean(gap.blocking),
    evidence: gap.evidence,
    impact: gap.impact,
    recommendation: gap.recommendation,
  });
}

function collectGaps({ inventory, checks, workflow, secrets, audit, dotnet, ciSurfacePolicy, dependencyAuditPolicy, largeFileSignals }) {
  const gaps = [];
  const overlapCheck = checks.find((check) => check.id === "automation-overlap");
  const failedChecks = checks.filter((check) => check.status === "failed");
  for (const check of failedChecks) {
    addGap(gaps, { gapId: `QUALITY-${check.id.toUpperCase()}`, domain: "quality", severity: "high", status: "open", blocking: true, evidence: check, impact: `${check.id} is not passing`, recommendation: `Repair ${check.id} and rerun the evaluation loop.` });
  }
  if (workflow.missingExplicitPermissions > 0) addGap(gaps, { gapId: "SEC-CI-EXPLICIT-PERMISSIONS", domain: "security", severity: "medium", status: "open", blocking: false, evidence: workflow, impact: "Some workflows do not declare an explicit permission boundary.", recommendation: "Review each workflow and declare the minimum required permissions." });
  if (workflow.broadWrite > 0) addGap(gaps, { gapId: "SEC-CI-BROAD-WRITE", domain: "security", severity: "medium", status: "open", blocking: false, evidence: { broadWrite: workflow.broadWrite }, impact: "Some workflows request write-level authority.", recommendation: "Replace broad write permissions with least-privilege scopes." });
  const workflowBudgetExceeded = workflow.workflowCount > Number(ciSurfacePolicy.maxWorkflowCount ?? 100);
  const overlapCheckMissingOrFailed = ciSurfacePolicy.requireOverlapCheck === true && overlapCheck?.status !== "passed";
  if (workflowBudgetExceeded || overlapCheckMissingOrFailed) {
    addGap(gaps, {
      gapId: "AUTO-CI-SURFACE-SIZE",
      domain: "maintainability",
      severity: "low",
      status: "open",
      blocking: false,
      evidence: {
        workflowCount: workflow.workflowCount,
        maxWorkflowCount: Number(ciSurfacePolicy.maxWorkflowCount ?? 100),
        overlapCheck: overlapCheck?.status ?? "not-run",
      },
      impact: "The CI surface exceeds its declared budget or lacks a passing overlap-control check.",
      recommendation: "Keep the workflow count within the declared budget and maintain a passing automation overlap check.",
    });
  }
  if (largeFileSignals.unapproved.length > 0) addGap(gaps, {
    gapId: "MAINT-LARGE-TRACKED-FILES",
    domain: "maintainability",
    severity: "low",
    status: "open",
    blocking: false,
    evidence: {
      totalLargeFiles: largeFileSignals.all.length,
      approved: largeFileSignals.approved,
      unapproved: largeFileSignals.unapproved.slice(0, 10),
    },
    impact: "Large files without an explicit ownership and rationale policy increase review and change costs.",
    recommendation: "Split or generate the file, or add a bounded rationale to the large-file policy.",
  });
  if (secrets.suspectedSecretFiles.length > 0) addGap(gaps, { gapId: "SEC-TRACKED-SECRET-SUSPECT", domain: "security", severity: "critical", status: "open", blocking: true, evidence: secrets, impact: "A tracked file matches a high-risk credential pattern.", recommendation: "Remove the credential, rotate it, and add a suitable secret-scanning rule." });
  if (audit.mode === "not-run" && dependencyAuditPolicy.ciNetworkAuditRequired !== true) addGap(gaps, { gapId: "DEP-AUDIT-NOT-EVALUATED", domain: "dependencies", severity: "medium", status: "not-evaluated", blocking: false, evidence: { ...audit, policy: dependencyAuditPolicy }, impact: "Dependency advisories were not queried in this offline-safe run and no CI audit contract is declared.", recommendation: "Declare and run a network-enabled dependency audit in CI." });
  else {
    const findings = audit.packages.filter((item) => item.status === "findings");
    if (findings.length > 0) addGap(gaps, { gapId: "DEP-AUDIT-FINDINGS", domain: "dependencies", severity: "medium", status: "open", blocking: false, evidence: findings, impact: "One or more package manifests report dependency advisories or audit errors.", recommendation: "Review the audit metadata and update dependencies through a controlled PR." });
  }
  if (dotnet.status === "not-evaluated") addGap(gaps, { gapId: "ENV-DOTNET-NOT-EVALUATED", domain: "environment", severity: "medium", status: "not-evaluated", blocking: false, evidence: dotnet, impact: "Some .NET-dependent validation was not probed in deterministic mode.", recommendation: "Run node scripts/repository-evaluation.mjs --include-environment in an environment with the repository-supported .NET SDK." });
  else if (dotnet.status === "not-available") addGap(gaps, { gapId: "ENV-DOTNET-NOT-AVAILABLE", domain: "environment", severity: "medium", status: "not-evaluated", blocking: false, evidence: dotnet, impact: "Some .NET-dependent validation cannot run in the current environment.", recommendation: "Install the repository-supported .NET SDK in CI or explicitly mark the check as environment-gated." });
  gaps.sort((a, b) => a.gapId.localeCompare(b.gapId) || SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  return gaps;
}

function largeFileSignals(inventory, policy) {
  const all = inventory.files
    .filter((file) => file.bytes >= 1024 * 1024)
    .map((file) => ({ path: file.path, bytes: file.bytes }))
    .sort((a, b) => b.bytes - a.bytes);
  const approvedPaths = new Set((policy.files ?? []).map((item) => item.path));
  return {
    all,
    approved: all.filter((file) => approvedPaths.has(file.path)),
    unapproved: all.filter((file) => !approvedPaths.has(file.path)),
  };
}

function comparableGap(gap) {
  return JSON.stringify({ gapId: gap.gapId, domain: gap.domain, severity: gap.severity, status: gap.status, blocking: gap.blocking, evidence: gap.evidence, impact: gap.impact, recommendation: gap.recommendation });
}

function compareBaseline(current, baseline) {
  if (!baseline) return { available: false, newGapIds: [], persistingGapIds: [], unchangedGapIds: [], resolvedGapIds: [] };
  const currentById = new Map(current.gaps.map((gap) => [gap.gapId, gap]));
  const baselineById = new Map((baseline.gaps ?? []).filter((gap) => gap.status !== "resolved").map((gap) => [gap.gapId, gap]));
  const currentIds = [...currentById.keys()];
  const baselineIds = [...baselineById.keys()];
  const sharedIds = currentIds.filter((id) => baselineById.has(id));
  return {
    available: true,
    newGapIds: currentIds.filter((id) => !baselineById.has(id)).sort(),
    persistingGapIds: sharedIds.filter((id) => comparableGap(currentById.get(id)) !== comparableGap(baselineById.get(id))).sort(),
    unchangedGapIds: sharedIds.filter((id) => comparableGap(currentById.get(id)) === comparableGap(baselineById.get(id))).sort(),
    resolvedGapIds: baselineIds.filter((id) => !currentById.has(id)).sort(),
  };
}

function buildEvaluation({ root = ROOT, skipChecks = false, includeNetwork = false, includeEnvironment = false, baseline = null } = {}) {
  const inventory = loadInventory();
  // The inventory remains complete, but generated evaluation files are excluded from
  // evaluator inputs to avoid a self-referential fingerprint/write cycle.
  const evaluationInventory = { ...inventory, files: inventory.files.filter((file) => !EVALUATION_OUTPUT_PATHS.has(file.path)) };
  const ciSurfacePolicy = readOptionalJson(CI_SURFACE_POLICY_PATH, { maxWorkflowCount: 100, requireOverlapCheck: false });
  const dependencyAuditPolicy = readOptionalJson(DEPENDENCY_AUDIT_POLICY_PATH, { ciNetworkAuditRequired: false });
  const largeFilePolicy = readOptionalJson(LARGE_FILE_POLICY_PATH, { files: [] });
  const workflow = workflowSignals(evaluationInventory);
  const secrets = secretSignals(evaluationInventory);
  const audit = auditSignals(evaluationInventory, includeNetwork);
  const evaluatedBytes = evaluationInventory.files.reduce((total, file) => total + file.bytes, 0);
  const dotnet = dotnetSignals(evaluationInventory, includeEnvironment);
  const checks = [
    runCheck("inventory-check", ["run", "inventory:check"], root, skipChecks),
    runCheck("inventory-selftest", ["run", "inventory:test"], root, skipChecks),
    runCheck("typecheck", ["run", "typecheck"], root, skipChecks),
    runCheck("root-tests", ["test", "--", "--runInBand"], root, skipChecks),
    runNodeCheck("automation-overlap", ["http-generic-api/scripts/automation-overlap-analyzer.mjs", "--check"], root, skipChecks),
  ];
  const largeFiles = largeFileSignals(evaluationInventory, largeFilePolicy);
  const inputFingerprint = sha256({ inventoryFiles: evaluationInventory.files, workflow, secrets, audit, dotnet, ciSurfacePolicy, dependencyAuditPolicy, largeFilePolicy, largeFiles, checks: checks.map(({ id, status, exitCode }) => ({ id, status, exitCode })) });
  const gaps = collectGaps({ inventory: evaluationInventory, checks, workflow, secrets, audit, dotnet, ciSurfacePolicy, dependencyAuditPolicy, largeFileSignals: largeFiles });
  const baselineDiff = compareBaseline({ gaps }, baseline);
  for (const gap of gaps) {
    gap.lifecycle = !baselineDiff.available ? "new" : baselineDiff.newGapIds.includes(gap.gapId) ? "new" : baselineDiff.unchangedGapIds.includes(gap.gapId) ? "unchanged" : "persisting";
  }
  const blockingGapIds = gaps.filter((gap) => gap.blocking && gap.status === "open").map((gap) => gap.gapId);
  const warningGapIds = gaps.filter((gap) => !gap.blocking && gap.status !== "resolved").map((gap) => gap.gapId);
  const gate = { decision: blockingGapIds.length > 0 ? "fail" : warningGapIds.length > 0 ? "warn" : "pass", blockingGapIds, warningGapIds };
  const evaluation = {
    schemaVersion: 1,
    generatedFrom: "repository-inventory",
    deterministic: !includeNetwork && !includeEnvironment,
    inputFingerprint,
    inventory: { files: evaluationInventory.files.length, bytes: evaluatedBytes, directories: inventory.totals.directories, categories: inventory.totals.categories },
    signals: {
      workflow,
      secrets,
      audit,
      dotnet,
      maintainability: {
        workflowBudget: Number(ciSurfacePolicy.maxWorkflowCount ?? 100),
        totalLargeFiles: largeFiles.all.length,
        approvedLargeFiles: largeFiles.approved.length,
        unapprovedLargeFiles: largeFiles.unapproved.length,
      },
    },
    policies: { ciSurface: ciSurfacePolicy, dependencyAudit: dependencyAuditPolicy, largeFiles: largeFilePolicy },
    checks,
    gaps,
    gate,
    baselineDiff,
  };
  return evaluation;
}

function renderMarkdown(evaluation) {
  const gapRows = evaluation.gaps.length === 0 ? "| none | — | — | — | — |" : evaluation.gaps.map((gap) => `| \`${gap.gapId}\` | ${gap.domain} | ${gap.severity} | ${gap.status} | ${gap.lifecycle} | ${gap.blocking ? "yes" : "no"} |`).join("\n");
  const checkRows = evaluation.checks.map((check) => `| \`${check.id}\` | ${check.status} | ${check.exitCode ?? "—"} |`).join("\n");
  return `<!-- GENERATED FILE. Run npm run evaluation:write. Do not edit manually. -->
# Repository Evaluation

This report is generated from the dynamic Repository Inventory and deterministic evaluation rules. It classifies evidence-backed gaps; it does not apply code or dependency mutations automatically.

## Gate

| Metric | Value |
|---|---:|
| Decision | **${evaluation.gate.decision}** |
| Blocking gaps | ${evaluation.gate.blockingGapIds.length} |
| Warning or informational gaps | ${evaluation.gate.warningGapIds.length} |
| Input fingerprint | \`${evaluation.inputFingerprint}\` |

## Repository signals

| Signal | Value |
|---|---:|
| Inventory files | ${evaluation.inventory.files.toLocaleString("en-US")} |
| Inventory bytes | ${evaluation.inventory.bytes.toLocaleString("en-US")} |
| Workflows | ${evaluation.signals.workflow.workflowCount} |
| Workflows without explicit permissions | ${evaluation.signals.workflow.missingExplicitPermissions} |
| Broad write permission matches | ${evaluation.signals.workflow.broadWrite} |
| Automation overlap check | ${evaluation.checks.find((check) => check.id === "automation-overlap")?.status ?? "not-run"} |
| Workflow budget | ${evaluation.signals.maintainability.workflowBudget} |
| Unapproved large files | ${evaluation.signals.maintainability.unapprovedLargeFiles} |
| Suspected secret files | ${evaluation.signals.secrets.suspectedSecretFiles.length} |
| Dependency audit mode | ${evaluation.signals.audit.mode} |
| CI dependency audit contract | ${evaluation.policies.dependencyAudit.ciNetworkAuditRequired ? "required" : "missing"} |
| .NET availability | ${evaluation.signals.dotnet.status} |

## Checks

| Check | Status | Exit code |
|---|---|---:|
${checkRows}

## Gaps

| Gap | Domain | Severity | Status | Lifecycle | Blocking |\n|---|---|---|---|---|---|
${gapRows}

## Loop contract

The loop reads the Git index-backed inventory, runs the configured checks, generates stable gap identifiers, optionally compares a baseline, and verifies its outputs with npm run evaluation:check. npm run evaluation:test validates deterministic generation and the report schema.
`;
}

function buildSummary(evaluation) {
  const bySeverity = Object.fromEntries(Object.keys(SEVERITY_ORDER).map((severity) => [severity, evaluation.gaps.filter((gap) => gap.severity === severity).length]));
  const byDomain = Object.fromEntries([...new Set(evaluation.gaps.map((gap) => gap.domain))].sort().map((domain) => [domain, evaluation.gaps.filter((gap) => gap.domain === domain).length]));
  return { schemaVersion: 1, generatedFrom: "repository-evaluation", deterministic: evaluation.deterministic, inputFingerprint: evaluation.inputFingerprint, gate: evaluation.gate, baselineDiff: evaluation.baselineDiff, gapCounts: { total: evaluation.gaps.length, bySeverity, byDomain }, topGaps: evaluation.gaps.slice(0, 20).map(({ gapId, domain, severity, status, lifecycle, blocking }) => ({ gapId, domain, severity, status, lifecycle, blocking })) };
}

function writeOrCheck(outputs, expected) {
  const mismatches = outputs.filter(([path, value]) => {
    try { return readFileSync(absolute(path), "utf8") !== value; } catch { return true; }
  });
  return mismatches;
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const baseline = options.baseline && existsSync(absolute(options.baseline)) ? readJson(options.baseline) : null;
  const evaluation = buildEvaluation({ skipChecks: options.skipChecks, includeNetwork: options.includeNetwork, baseline });
  if (options.diff) {
    process.stdout.write(`${JSON.stringify(evaluation.baselineDiff, null, 2)}\n`);
    return;
  }
  const json = `${JSON.stringify(evaluation, null, 2)}\n`;
  const markdown = renderMarkdown(evaluation);
  const summary = `${JSON.stringify(buildSummary(evaluation), null, 2)}\n`;
  const outputs = [[options.outputs.json, json], [options.outputs.markdown, markdown], [options.outputs.summary, summary]];
  const mismatches = writeOrCheck(outputs, outputs);
  if (options.check) {
    if (mismatches.length > 0) {
      console.error(`Repository evaluation artifacts are stale: ${mismatches.map(([path]) => path).join(", ")}`);
      process.exitCode = 1;
      return;
    }
    console.log(JSON.stringify({ ok: true, checked: outputs.map(([path]) => path), gate: evaluation.gate }, null, 2));
    if (options.enforce && evaluation.gate.decision === "fail") process.exitCode = 1;
    return;
  }
  for (const [path, value] of outputs) writeFileSync(absolute(path), value);
  console.log(JSON.stringify({ ok: true, outputs: outputs.map(([path]) => path), gate: evaluation.gate, gaps: evaluation.gaps.length, inputFingerprint: evaluation.inputFingerprint }, null, 2));
  if (options.enforce && evaluation.gate.decision === "fail") process.exitCode = 1;
}

export { buildEvaluation, compareBaseline, renderMarkdown, buildSummary, extractSecretMatches, isPlaceholderToken };

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
