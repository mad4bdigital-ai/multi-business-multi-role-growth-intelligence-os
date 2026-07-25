#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = path.resolve(__dirname, "..", "..");
const SEVERITY_ORDER = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };

function text(value = "") {
  return String(value ?? "").trim();
}

function normalizedPath(value = "") {
  return text(value).replaceAll("\\", "/").replace(/^\.\/+/, "");
}

function stableId(code, subjects = []) {
  return createHash("sha256")
    .update(JSON.stringify([code, [...subjects].sort()]))
    .digest("hex")
    .slice(0, 16);
}

function finding({ code, severity, message, subjects = [], evidence = {}, recommendation = null }) {
  return {
    finding_id: stableId(code, subjects),
    code,
    severity,
    message,
    subjects,
    evidence,
    recommendation,
  };
}

function stripYamlScalar(value = "") {
  const clean = text(value);
  if (
    (clean.startsWith('"') && clean.endsWith('"'))
    || (clean.startsWith("'") && clean.endsWith("'"))
  ) {
    return clean.slice(1, -1);
  }
  return clean;
}

function parseWorkflowMetadata(source = "") {
  const lines = String(source).split(/\r?\n/);
  let concurrencyGroup = null;
  let cancelInProgress = null;

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^(\s*)concurrency:\s*(.*?)\s*$/);
    if (!match) continue;
    const baseIndent = match[1].length;
    if (text(match[2])) {
      concurrencyGroup = stripYamlScalar(match[2]);
      break;
    }
    for (let child = index + 1; child < lines.length; child += 1) {
      const line = lines[child];
      if (!text(line)) continue;
      const indent = line.match(/^\s*/)?.[0]?.length || 0;
      if (indent <= baseIndent) break;
      const groupMatch = line.match(/^\s*group:\s*(.+?)\s*$/);
      if (groupMatch) concurrencyGroup = stripYamlScalar(groupMatch[1]);
      const cancelMatch = line.match(/^\s*cancel-in-progress:\s*(.+?)\s*$/);
      if (cancelMatch) cancelInProgress = stripYamlScalar(cancelMatch[1]);
    }
    break;
  }

  const schedules = [];
  for (const match of String(source).matchAll(/^\s*-\s*cron:\s*["']?([^"'\r\n]+)["']?\s*$/gm)) {
    schedules.push(text(match[1]));
  }

  return {
    concurrency_group: concurrencyGroup,
    cancel_in_progress: cancelInProgress,
    schedules,
  };
}

function extractNodeScriptRefs(command = "") {
  const refs = new Set();
  const regex = /\bnode\s+(?:(?:--[A-Za-z0-9_-]+(?:=[^\s;&|]+)?|--env-file(?:=[^\s;&|]+)?)\s+)*([^\s"';&|]+\.mjs)\b/g;
  for (const match of String(command).matchAll(regex)) refs.add(normalizedPath(match[1]));
  return [...refs];
}

function extractNpmScriptRefs(command = "") {
  const refs = new Set();
  for (const match of String(command).matchAll(/\bnpm\s+run\s+([A-Za-z0-9:_-]+)/g)) {
    refs.add(match[1]);
  }
  return [...refs];
}

function resolveExistingScript(repoRoot, candidate, baseDirectory = repoRoot) {
  const clean = normalizedPath(candidate);
  const attempts = [
    path.resolve(baseDirectory, clean),
    path.resolve(repoRoot, clean),
    path.resolve(repoRoot, "http-generic-api", clean),
    path.resolve(repoRoot, "http-generic-api", "scripts", clean),
  ];
  for (const absolute of attempts) {
    if (existsSync(absolute) && statSync(absolute).isFile()) {
      return normalizedPath(path.relative(repoRoot, absolute));
    }
  }
  return null;
}

function packageScripts(repoRoot) {
  const packagePath = path.join(repoRoot, "http-generic-api", "package.json");
  if (!existsSync(packagePath)) return {};
  return JSON.parse(readFileSync(packagePath, "utf8")).scripts || {};
}

function directWorkflowScripts(repoRoot, workflowSource, scriptsByName) {
  const refs = new Set();
  for (const candidate of extractNodeScriptRefs(workflowSource)) {
    const resolved = resolveExistingScript(repoRoot, candidate);
    if (resolved) refs.add(resolved);
  }
  for (const scriptName of extractNpmScriptRefs(workflowSource)) {
    const command = scriptsByName[scriptName];
    if (!command) continue;
    for (const candidate of extractNodeScriptRefs(command)) {
      const resolved = resolveExistingScript(
        repoRoot,
        candidate,
        path.join(repoRoot, "http-generic-api"),
      );
      if (resolved) refs.add(resolved);
    }
  }
  return [...refs].sort();
}

function referencedChildScripts(repoRoot, scriptPath) {
  const absolute = path.join(repoRoot, scriptPath);
  const source = readFileSync(absolute, "utf8");
  const refs = new Set();
  const regex = /["'`]([A-Za-z0-9_./-]+\.mjs)["'`]/g;
  for (const match of source.matchAll(regex)) {
    const resolved = resolveExistingScript(repoRoot, match[1], path.dirname(absolute));
    if (resolved && resolved !== scriptPath) refs.add(resolved);
  }
  return [...refs];
}

function expandScriptGraph(repoRoot, directScripts, maxDepth = 4) {
  const discovered = new Set(directScripts);
  let frontier = [...directScripts];
  for (let depth = 0; depth < maxDepth && frontier.length; depth += 1) {
    const next = [];
    for (const scriptPath of frontier) {
      for (const child of referencedChildScripts(repoRoot, scriptPath)) {
        if (discovered.has(child)) continue;
        discovered.add(child);
        next.push(child);
      }
    }
    frontier = next;
  }
  return [...discovered].sort();
}

function scriptBehavior(repoRoot, scriptPath) {
  const source = readFileSync(path.join(repoRoot, scriptPath), "utf8");
  const writeTokens = [
    "writeFile(",
    "writeFileSync(",
    "appendFile(",
    "appendFileSync(",
    "rename(",
    "renameSync(",
    "copyFile(",
    "copyFileSync(",
    "createWriteStream(",
  ];
  const databaseMutation = /\b(?:INSERT\s+INTO|UPDATE\s+[A-Za-z0-9_`]+|DELETE\s+FROM|REPLACE\s+INTO)\b/i.test(source);
  const advisoryLocks = [...source.matchAll(/GET_LOCK\s*\(\s*\?\s*,/g)].length;
  return {
    writes_files: writeTokens.some((token) => source.includes(token)),
    mutates_database: databaseMutation,
    advisory_lock_calls: advisoryLocks,
  };
}

function listWorkflowPaths(repoRoot) {
  const directory = path.join(repoRoot, ".github", "workflows");
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((name) => /\.ya?ml$/i.test(name))
    .map((name) => normalizedPath(path.join(".github", "workflows", name)))
    .sort();
}

export function buildAutomationInventory({ repoRoot = DEFAULT_REPO_ROOT } = {}) {
  const scriptsByName = packageScripts(repoRoot);
  const workflowPaths = listWorkflowPaths(repoRoot);
  const workflows = [];
  const behaviorCache = new Map();

  for (const workflowPath of workflowPaths) {
    const source = readFileSync(path.join(repoRoot, workflowPath), "utf8");
    const directScripts = directWorkflowScripts(repoRoot, source, scriptsByName);
    const transitiveScripts = expandScriptGraph(repoRoot, directScripts);
    for (const scriptPath of transitiveScripts) {
      if (!behaviorCache.has(scriptPath)) {
        behaviorCache.set(scriptPath, scriptBehavior(repoRoot, scriptPath));
      }
    }
    workflows.push({
      path: workflowPath,
      ...parseWorkflowMetadata(source),
      direct_scripts: directScripts,
      transitive_scripts: transitiveScripts,
      writer_scripts: transitiveScripts.filter(
        (scriptPath) => behaviorCache.get(scriptPath)?.writes_files,
      ),
      database_writer_scripts: transitiveScripts.filter(
        (scriptPath) => behaviorCache.get(scriptPath)?.mutates_database,
      ),
    });
  }

  return {
    repo_root: repoRoot,
    workflows,
    script_behavior: Object.fromEntries([...behaviorCache.entries()].sort()),
  };
}

function workflowMap(inventory) {
  return new Map(inventory.workflows.map((workflow) => [workflow.path, workflow]));
}

function minuteOfDay(cron = "") {
  const fields = text(cron).split(/\s+/);
  if (fields.length !== 5 || !/^\d+$/.test(fields[0]) || !/^\d+$/.test(fields[1])) return null;
  const minute = Number(fields[0]);
  const hour = Number(fields[1]);
  if (minute > 59 || hour > 23) return null;
  return (hour * 60) + minute;
}

function forwardMinutes(from, to) {
  return (to - from + (24 * 60)) % (24 * 60);
}

function isAllowlisted(policy, code, subjects) {
  const normalizedSubjects = [...subjects].sort().join("|");
  return (policy.behavioral_allowlist || []).some((entry) => (
    entry.code === code
    && [...(entry.subjects || [])].sort().join("|") === normalizedSubjects
  ));
}

export function detectAutomationOverlaps(inventory, policy) {
  const findings = [];
  const workflows = workflowMap(inventory);

  for (const group of policy.resource_groups || []) {
    const members = (group.workflows || []).map((entry) => ({
      ...entry,
      workflow: workflows.get(normalizedPath(entry.path)),
    }));
    for (const member of members) {
      if (!member.workflow) {
        findings.push(finding({
          code: "policy_workflow_missing",
          severity: "critical",
          message: `Policy resource group ${group.key} references a missing workflow.`,
          subjects: [group.key, normalizedPath(member.path)],
          recommendation: "Restore the workflow or update the governed overlap policy.",
        }));
      }
    }
    const existing = members.filter((member) => member.workflow);
    const writeMembers = existing.filter((member) => member.access !== "read");
    for (const member of writeMembers) {
      if (member.workflow.concurrency_group !== group.required_concurrency_group) {
        findings.push(finding({
          code: "resource_group_concurrency_mismatch",
          severity: "critical",
          message: `Workflow ${member.workflow.path} can mutate ${group.key} without the required shared concurrency group.`,
          subjects: [group.key, member.workflow.path],
          evidence: {
            expected: group.required_concurrency_group,
            actual: member.workflow.concurrency_group,
            access: member.access,
            write_patterns: group.write_patterns || [],
          },
          recommendation: "Use the resource group's exact concurrency key and disable in-progress cancellation for mutation workflows.",
        }));
      }
      if (String(member.workflow.cancel_in_progress) !== "false") {
        findings.push(finding({
          code: "resource_group_cancellation_unsafe",
          severity: "critical",
          message: `Workflow ${member.workflow.path} may cancel an in-progress generated-artifact mutation.`,
          subjects: [group.key, member.workflow.path],
          evidence: { actual: member.workflow.cancel_in_progress },
          recommendation: "Set cancel-in-progress to false so later mutation requests queue instead of interrupting writes.",
        }));
      }
    }
  }

  for (const rule of policy.schedule_separation_rules || []) {
    const before = workflows.get(normalizedPath(rule.before_workflow));
    const after = workflows.get(normalizedPath(rule.after_workflow));
    if (!before || !after) continue;
    const beforeTimes = before.schedules.map(minuteOfDay).filter(Number.isInteger);
    const afterTimes = after.schedules.map(minuteOfDay).filter(Number.isInteger);
    if (!beforeTimes.length || !afterTimes.length) continue;
    const closest = Math.min(...beforeTimes.flatMap(
      (left) => afterTimes.map((right) => forwardMinutes(left, right)),
    ));
    if (closest < Number(rule.minimum_minutes || 0)) {
      findings.push(finding({
        code: "schedule_separation_insufficient",
        severity: rule.severity || "critical",
        message: `${after.path} is scheduled too close to ${before.path}.`,
        subjects: [before.path, after.path],
        evidence: {
          before_schedules: before.schedules,
          after_schedules: after.schedules,
          actual_separation_minutes: closest,
          minimum_minutes: Number(rule.minimum_minutes || 0),
        },
        recommendation: "Move the readback schedule after the mutation window and keep an explicit safety margin.",
      }));
    }
  }

  for (const contract of policy.database_lock_contracts || []) {
    const contractPath = normalizedPath(contract.path);
    const absolute = path.join(inventory.repo_root, contractPath);
    if (!existsSync(absolute)) {
      findings.push(finding({
        code: "database_lock_contract_target_missing",
        severity: "critical",
        message: `Database lock contract target ${contractPath} is missing.`,
        subjects: [contractPath, contract.lock_key],
      }));
      continue;
    }
    const source = readFileSync(absolute, "utf8");
    const missingTokens = [
      contract.lock_key,
      ...(contract.required_tokens || ["GET_LOCK", "RELEASE_LOCK"]),
    ].filter((token) => !source.includes(token));
    if (missingTokens.length) {
      findings.push(finding({
        code: "database_lock_contract_incomplete",
        severity: contract.severity || "critical",
        message: `${contractPath} does not satisfy its governed advisory-lock contract.`,
        subjects: [contractPath, contract.lock_key],
        evidence: { missing_tokens: missingTokens },
        recommendation: "Acquire and release the named lock on one dedicated connection, including failure paths.",
      }));
    }
  }

  const scriptConsumers = new Map();
  for (const workflow of inventory.workflows) {
    for (const scriptPath of workflow.writer_scripts) {
      if (!scriptConsumers.has(scriptPath)) scriptConsumers.set(scriptPath, []);
      scriptConsumers.get(scriptPath).push(workflow);
    }
  }
  for (const [scriptPath, consumers] of scriptConsumers.entries()) {
    if (consumers.length < 2) continue;
    const groups = new Set(consumers.map((item) => item.concurrency_group || "<none>"));
    if (groups.size <= 1) continue;
    const subjects = [scriptPath, ...consumers.map((item) => item.path)];
    if (isAllowlisted(policy, "shared_writer_different_concurrency", subjects)) continue;
    findings.push(finding({
      code: "shared_writer_different_concurrency",
      severity: policy.enforcement?.discovered_overlap_default_severity || "high",
      message: "A file-writing script is reachable from multiple workflows that do not share a concurrency group.",
      subjects,
      evidence: {
        consumers: consumers.map((item) => ({
          workflow: item.path,
          concurrency_group: item.concurrency_group,
        })),
      },
      recommendation: "Assign one resource owner or serialize every writer with the same resource-scoped concurrency key.",
    }));
  }

  const scheduled = inventory.workflows.filter((workflow) => workflow.schedules.length);
  for (let leftIndex = 0; leftIndex < scheduled.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < scheduled.length; rightIndex += 1) {
      const left = scheduled[leftIndex];
      const right = scheduled[rightIndex];
      const shared = left.schedules.filter((cron) => right.schedules.includes(cron));
      if (!shared.length || left.concurrency_group === right.concurrency_group) continue;
      const subjects = [left.path, right.path];
      if (isAllowlisted(policy, "identical_schedule_different_concurrency", subjects)) continue;
      findings.push(finding({
        code: "identical_schedule_different_concurrency",
        severity: "medium",
        message: "Two workflows start on the same cron expression without shared concurrency.",
        subjects,
        evidence: { shared_schedules: shared },
        recommendation: "Separate the schedules or document why concurrent execution is safe.",
      }));
    }
  }

  return findings.sort((left, right) => (
    (SEVERITY_ORDER[right.severity] - SEVERITY_ORDER[left.severity])
    || left.code.localeCompare(right.code)
    || left.finding_id.localeCompare(right.finding_id)
  ));
}

export function loadAutomationOverlapPolicy({ repoRoot = DEFAULT_REPO_ROOT, policyPath = null } = {}) {
  const resolved = policyPath
    ? path.resolve(repoRoot, policyPath)
    : path.join(repoRoot, "http-generic-api", "scripts", "taxonomy", "automation-overlap-policy.json");
  return JSON.parse(readFileSync(resolved, "utf8"));
}

export function analyzeAutomationOverlap({ repoRoot = DEFAULT_REPO_ROOT, policyPath = null, policy = null, failSeverity = null } = {}) {
  const effectivePolicy = policy || loadAutomationOverlapPolicy({ repoRoot, policyPath });
  const inventory = buildAutomationInventory({ repoRoot });
  const findings = detectAutomationOverlaps(inventory, effectivePolicy);
  const threshold = failSeverity || effectivePolicy.enforcement?.fail_severity || "critical";
  const thresholdValue = SEVERITY_ORDER[threshold];
  if (!Number.isInteger(thresholdValue)) throw new Error(`Unsupported fail severity: ${threshold}`);
  const blockingFindings = findings.filter((item) => SEVERITY_ORDER[item.severity] >= thresholdValue);
  const findingsBySeverity = Object.fromEntries(
    Object.keys(SEVERITY_ORDER).map((severity) => [severity, findings.filter((item) => item.severity === severity).length]),
  );

  return {
    ok: blockingFindings.length === 0,
    generated_at: new Date().toISOString(),
    policy_version: effectivePolicy.version,
    enforcement: {
      fail_severity: threshold,
      blocking_count: blockingFindings.length,
      ratchet_strategy: effectivePolicy.enforcement?.ratchet_strategy || null,
    },
    summary: {
      workflow_count: inventory.workflows.length,
      analyzed_script_count: Object.keys(inventory.script_behavior).length,
      finding_count: findings.length,
      findings_by_severity: findingsBySeverity,
    },
    findings,
    inventory: { workflows: inventory.workflows },
    secrets_included: false,
  };
}

export function renderAutomationOverlapMarkdown(report) {
  const rows = report.findings.length
    ? report.findings.map((item) => (
      `| ${item.severity} | \`${item.code}\` | ${item.message.replaceAll("|", "\\|")} | ${item.subjects.join("<br>").replaceAll("|", "\\|")} |`
    ))
    : ["| — | — | No overlap findings. | — |"];
  return [
    "# Automation Overlap Report",
    "",
    `- Status: **${report.ok ? "pass" : "blocked"}**`,
    `- Policy: \`${report.policy_version}\``,
    `- Enforcement threshold: \`${report.enforcement.fail_severity}\``,
    `- Workflows analyzed: ${report.summary.workflow_count}`,
    `- Scripts analyzed: ${report.summary.analyzed_script_count}`,
    `- Findings: ${report.summary.finding_count}`,
    `- Blocking findings: ${report.enforcement.blocking_count}`,
    "",
    "| Severity | Code | Finding | Subjects |",
    "|---|---|---|---|",
    ...rows,
    "",
    "Behavioral findings below the enforcement threshold are intentionally reported without blocking CI. Promote them into governed resource groups after review.",
    "",
  ].join("\n");
}

function parseArgs(argv) {
  const options = {
    check: false,
    repoRoot: DEFAULT_REPO_ROOT,
    policyPath: null,
    reportFile: null,
    markdownFile: null,
    failSeverity: null,
  };
  for (const arg of argv) {
    if (arg === "--check") options.check = true;
    else if (arg.startsWith("--repo-root=")) options.repoRoot = path.resolve(arg.slice(12));
    else if (arg.startsWith("--policy=")) options.policyPath = arg.slice(9);
    else if (arg.startsWith("--report-file=")) options.reportFile = arg.slice(14);
    else if (arg.startsWith("--markdown-file=")) options.markdownFile = arg.slice(16);
    else if (arg.startsWith("--fail-severity=")) options.failSeverity = arg.slice(16);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function writeOutput(filePath, content) {
  const absolute = path.resolve(filePath);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, content);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = analyzeAutomationOverlap({
    repoRoot: options.repoRoot,
    policyPath: options.policyPath,
    failSeverity: options.failSeverity,
  });
  const json = `${JSON.stringify(report, null, 2)}\n`;
  const markdown = renderAutomationOverlapMarkdown(report);
  if (options.reportFile) writeOutput(options.reportFile, json);
  if (options.markdownFile) writeOutput(options.markdownFile, markdown);
  process.stdout.write(json);
  if (options.check && !report.ok) process.exitCode = 1;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      error: { code: "automation_overlap_analyzer_failed", message: error?.message || String(error) },
      secrets_included: false,
    })}\n`);
    process.exitCode = 1;
  });
}
