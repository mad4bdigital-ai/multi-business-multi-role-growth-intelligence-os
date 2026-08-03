#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const POLICY_CONTRACT = "mad4b.repository-maintenance-tool-governance.v1";
const REPORT_CONTRACT = "mad4b.repository-tool-lifecycle-report.v1";
const TOOL_ROOT = "http-generic-api/scripts/maintenance-tools";
const GUARD_TOOL_KEY = "repository-tool-lifecycle-guard";
const GUARD_ENTRYPOINT = `${TOOL_ROOT}/repository-tool-lifecycle-guard.mjs`;
const FULL_SHA_PATTERN = /^[a-f0-9]{40}$/u;
const WORK_BRANCH_PATTERN = /(?:^|[^A-Za-z0-9_.-])(?:gpt|fix|feat|chore|docs|release)\/[A-Za-z0-9._/-]+/iu;
const REQUIRED_PROTECTED_BRANCHES = Object.freeze(["main", "Production"]);
const REQUIRED_RULE_KEYS = Object.freeze([
  "one_off_automation_must_not_merge",
  "reusable_tools_must_be_registered",
  "branch_specific_workflow_literals_forbidden",
  "pull_request_workflows_must_not_write_contents",
  "workflow_self_deletion_forbidden",
  "force_push_forbidden",
  "expected_head_sha_required_for_mutation",
  "protected_branch_mutation_forbidden",
  "canonical_report_required",
  "job_logs_are_diagnostic_only",
]);
const BASELINE_FORBIDDEN_PATH_PATTERNS = Object.freeze([
  /(^|\/)\.changes\/e2e\/.*trigger$/u,
  /(^|\/).*\.trigger$/u,
  /^\.github\/workflows\/.*(?:temporary|one-off|(?:^|[/_.-])once(?:[/_.-]|$)|patch-trigger|runtime-hardening-v[0-9]+).*$/u,
]);

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

function normalizeChangedEntries(raw) {
  return raw
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const columns = line.split("\t");
      if (columns.length === 1) return { status: "M", path: columns[0] };
      return {
        status: columns[0],
        path: columns.at(-1),
      };
    });
}

function finding(code, path, message) {
  return { code, path, message };
}

function ruleEnabled(policy, key) {
  return policy.rules?.[key] === true;
}

function containsBranchSpecificLiteral(content) {
  const lines = content.split(/\r?\n/u);
  let pathFilterIndent = null;

  for (const line of lines) {
    const trimmed = line.trim();
    const indentation = line.match(/^\s*/u)?.[0].length || 0;

    if (/^(?:paths|paths-ignore):\s*$/u.test(trimmed)) {
      pathFilterIndent = indentation;
      continue;
    }
    if (pathFilterIndent !== null) {
      if (!trimmed || trimmed.startsWith('#')) continue;
      if (indentation > pathFilterIndent) continue;
      pathFilterIndent = null;
    }
    if (WORK_BRANCH_PATTERN.test(line)) return true;
  }
  return false;
}

function hasAnyWritePermission(content) {
  return /(?:^|\n)\s*permissions\s*:\s*write-all\b/iu.test(content)
    || /(?:^|\n)\s*[A-Za-z][A-Za-z-]*\s*:\s*write\b/iu.test(content);
}

function hasPullRequestTrigger(content) {
  return /(?:^|\n)\s*pull_request(?:_target)?\s*:/u.test(content);
}

function hasWorkflowDispatch(content) {
  return /(?:^|\n)\s*workflow_dispatch\s*:/u.test(content);
}

function hasGitPush(content) {
  return /\bgit\s+push\b/iu.test(content);
}

function hasApiWrite(content) {
  const ghApiWrite = /\bgh\s+api\b[\s\S]{0,500}?(?:(?:--method|-X)\s*(?:POST|PUT|PATCH|DELETE)\b|(?:-f|--field|--raw-field)\s+)/iu;
  const curlApiWrite = /\bcurl\b[^\n]*(?:-X|--request)\s*(?:POST|PUT|PATCH|DELETE)\b[^\n]*api\.github\.com/iu;
  const ghMutation = /\bgh\s+(?:pr\s+merge|release\s+(?:create|delete|edit|upload)|workflow\s+(?:run|enable|disable))\b/iu;
  const githubScriptMutation = /github\.rest\.[A-Za-z0-9_.]+\.(?:create|update|delete|merge|dispatch|rerun|cancel|enable|disable)[A-Za-z0-9_]*\s*\(/iu;
  return ghApiWrite.test(content)
    || curlApiWrite.test(content)
    || ghMutation.test(content)
    || githubScriptMutation.test(content);
}

function hasRepositoryMutation(content) {
  return hasGitPush(content) || hasApiWrite(content);
}

function hasForcePush(content) {
  return /\bgit\s+push[^\n]*(?:--force(?:-with-lease)?|\s-f(?:\s|$))/iu.test(content);
}

function hasWorkflowSelfDeletion(content) {
  return /(?:unlink\s*\([^)]*\.github\/workflows|(?:rm|git\s+rm)[^\n]*\.github\/workflows)/iu.test(content);
}

function hasExpectedHeadGuard(content) {
  const expectedHead = /expected[_-]head[_-]sha/iu.test(content);
  const currentHead = /git\s+rev-parse\s+HEAD|current[_-]?head|head[_-]?sha/iu.test(content);
  const rejection = /(?:===|==|!=|!==|\btest\b|\[\[|\bassert\b|\bthrow\b|\breject\b|exit\s+1)/iu.test(content);
  return expectedHead && currentHead && rejection;
}

function hasProtectedBranchGuard(content) {
  return /(?:target[_-]?branch|branch)/iu.test(content)
    && /\bmain\b/u.test(content)
    && /\bProduction\b/u.test(content)
    && /(?:exit\s+1|return\s+1|throw\b|reject\b|forbid\b|deny\b)/iu.test(content);
}

function isMaintenanceLikeScript(path) {
  return /^\.github\/scripts\/(?:apply|patch|repair|migrate|.*trigger)/iu.test(path);
}

function buildRegisteredTools(policy) {
  const byEntrypoint = new Map();
  for (const [key, tool] of Object.entries(policy.tools || {})) {
    if (!tool?.entrypoint) continue;
    byEntrypoint.set(tool.entrypoint, { key, ...tool });
  }
  return byEntrypoint;
}

function compileForbiddenPatterns(policy) {
  const configured = (policy.forbidden_path_patterns || []).map(
    (pattern) => new RegExp(pattern, "u"),
  );
  return [...BASELINE_FORBIDDEN_PATH_PATTERNS, ...configured];
}

export function validateGovernanceInputs({ policy, candidateSha, baseSha }) {
  const findings = [];
  if (policy.contract !== POLICY_CONTRACT) {
    findings.push(finding(
      "INVALID_POLICY_CONTRACT",
      ".github/repository-maintenance-tool-governance.json",
      `Expected policy contract ${POLICY_CONTRACT}.`,
    ));
  }
  if (policy.canonical_report_contract !== REPORT_CONTRACT) {
    findings.push(finding(
      "REPORT_CONTRACT_MISMATCH",
      ".github/repository-maintenance-tool-governance.json",
      `Policy must require canonical report contract ${REPORT_CONTRACT}.`,
    ));
  }
  if (policy.tool_root !== TOOL_ROOT) {
    findings.push(finding(
      "INVALID_TOOL_ROOT",
      ".github/repository-maintenance-tool-governance.json",
      `Governed repository tools must remain under ${TOOL_ROOT}.`,
    ));
  }
  for (const branch of REQUIRED_PROTECTED_BRANCHES) {
    if (!policy.protected_branches?.includes(branch)) {
      findings.push(finding(
        "MISSING_PROTECTED_BRANCH",
        ".github/repository-maintenance-tool-governance.json",
        `Protected branch ${branch} must remain governed.`,
      ));
    }
  }
  for (const key of REQUIRED_RULE_KEYS) {
    if (policy.rules?.[key] !== true) {
      findings.push(finding(
        "MANDATORY_RULE_DISABLED",
        ".github/repository-maintenance-tool-governance.json",
        `Mandatory repository lifecycle rule ${key} must be explicitly true.`,
      ));
    }
  }
  const guard = policy.tools?.[GUARD_TOOL_KEY];
  if (
    guard?.entrypoint !== GUARD_ENTRYPOINT
    || guard?.mode !== "read_only"
    || guard?.report_contract !== REPORT_CONTRACT
  ) {
    findings.push(finding(
      "INVALID_GUARD_REGISTRATION",
      ".github/repository-maintenance-tool-governance.json",
      "The lifecycle guard must remain registered at its canonical entrypoint as a read-only tool with the canonical report contract.",
    ));
  }
  for (const [key, tool] of Object.entries(policy.tools || {})) {
    if (!tool?.entrypoint?.startsWith(`${TOOL_ROOT}/`)) {
      findings.push(finding(
        "INVALID_REGISTERED_TOOL_ENTRYPOINT",
        ".github/repository-maintenance-tool-governance.json",
        `Registered tool ${key} must use the governed tool root.`,
      ));
    }
    if (!new Set(["read_only", "mutating"]).has(tool?.mode)) {
      findings.push(finding(
        "INVALID_REGISTERED_TOOL_MODE",
        ".github/repository-maintenance-tool-governance.json",
        `Registered tool ${key} must declare read_only or mutating mode.`,
      ));
    }
    if (tool?.mode === "mutating" && !tool.allowed_changed_path_patterns?.length) {
      findings.push(finding(
        "MUTATING_TOOL_ALLOWLIST_REQUIRED",
        ".github/repository-maintenance-tool-governance.json",
        `Mutating tool ${key} must declare a non-empty changed-path allowlist.`,
      ));
    }
  }
  if (!FULL_SHA_PATTERN.test(candidateSha || "")) {
    findings.push(finding(
      "INVALID_CANDIDATE_SHA",
      "candidate_sha",
      "Repository lifecycle evaluation requires an exact 40-character candidate SHA.",
    ));
  }
  if (!FULL_SHA_PATTERN.test(baseSha || "")) {
    findings.push(finding(
      "INVALID_BASE_SHA",
      "base_sha",
      "Repository lifecycle evaluation requires an exact 40-character base SHA.",
    ));
  }
  return findings;
}

async function inspectRegisteredToolBodies({ policy, registeredTools, readText }) {
  const findings = [];
  for (const [entrypoint, tool] of registeredTools) {
    let content;
    try {
      content = await readText(entrypoint);
    } catch {
      findings.push(finding(
        "REGISTERED_TOOL_ENTRYPOINT_MISSING",
        entrypoint,
        `Registered tool ${tool.key} must have a readable entrypoint.`,
      ));
      continue;
    }

    const mutatesRepository = hasRepositoryMutation(content);
    if (hasForcePush(content)) {
      findings.push(finding(
        "FORCE_PUSH_AUTOMATION",
        entrypoint,
        "Registered repository tools may not force-push.",
      ));
    }
    if (hasWorkflowSelfDeletion(content)) {
      findings.push(finding(
        "SELF_DELETING_WORKFLOW",
        entrypoint,
        "Registered tools may not delete or rewrite workflow definitions.",
      ));
    }
    if (tool.mode === "read_only" && mutatesRepository) {
      findings.push(finding(
        "READ_ONLY_TOOL_MUTATION",
        entrypoint,
        `Registered read-only tool ${tool.key} contains repository mutation behavior.`,
      ));
    }
    if (mutatesRepository) {
      if (tool.mode !== "mutating") {
        findings.push(finding(
          "MUTATING_TOOL_MODE_REQUIRED",
          entrypoint,
          `Repository-mutating tool ${tool.key} must declare mutating mode.`,
        ));
      }
      if (!hasExpectedHeadGuard(content)) {
        findings.push(finding(
          "MISSING_EXPECTED_HEAD_GUARD",
          entrypoint,
          "Mutating repository tools must verify an explicit expected head SHA before writing.",
        ));
      }
      if (!hasProtectedBranchGuard(content)) {
        findings.push(finding(
          "MISSING_PROTECTED_BRANCH_GUARD",
          entrypoint,
          "Mutating repository tools must reject main and Production before writing.",
        ));
      }
    }
  }
  return findings;
}

export async function evaluateRepositoryToolLifecycle({ policy, entries, readText }) {
  const findings = [];
  const registeredTools = buildRegisteredTools(policy);
  const registeredEntrypoints = new Set(registeredTools.keys());
  const forbiddenPatterns = compileForbiddenPatterns(policy);

  findings.push(...await inspectRegisteredToolBodies({ policy, registeredTools, readText }));

  for (const entry of entries) {
    const path = entry.path;

    // Removing a prohibited temporary artifact is the required remediation.
    // Deleted entries must not be treated as automation that survives the merge diff.
    if (entry.status.startsWith("D")) continue;

    if (ruleEnabled(policy, "one_off_automation_must_not_merge")) {
      for (const pattern of forbiddenPatterns) {
        if (pattern.test(path)) {
          findings.push(finding(
            "TEMPORARY_AUTOMATION_ARTIFACT",
            path,
            "Temporary triggers, branch patch revisions, and one-off automation artifacts must not merge.",
          ));
          break;
        }
      }
    }

    if (
      ruleEnabled(policy, "reusable_tools_must_be_registered")
      && path.startsWith(`${policy.tool_root}/`)
      && !registeredEntrypoints.has(path)
    ) {
      findings.push(finding(
        "UNREGISTERED_MAINTENANCE_TOOL",
        path,
        "Reusable maintenance tools must be declared in the repository maintenance tool registry.",
      ));
    }

    if (
      ruleEnabled(policy, "one_off_automation_must_not_merge")
      && isMaintenanceLikeScript(path)
      && !registeredEntrypoints.has(path)
    ) {
      findings.push(finding(
        "ONE_OFF_MAINTENANCE_SCRIPT",
        path,
        "Maintenance scripts must live under the governed tool root and be registered, or be deleted before Ready for Review.",
      ));
    }

    if (!path.startsWith(".github/workflows/")) continue;
    const content = await readText(path);
    const mutatesRepository = hasRepositoryMutation(content);

    if (
      ruleEnabled(policy, "branch_specific_workflow_literals_forbidden")
      && containsBranchSpecificLiteral(content)
    ) {
      findings.push(finding(
        "BRANCH_SPECIFIC_WORKFLOW",
        path,
        "Permanent workflows must accept governed inputs and may not embed a work-branch name.",
      ));
    }
    if (
      ruleEnabled(policy, "pull_request_workflows_must_not_write_contents")
      && hasPullRequestTrigger(content)
      && hasAnyWritePermission(content)
    ) {
      findings.push(finding(
        "PULL_REQUEST_WRITE_WORKFLOW",
        path,
        "Pull-request workflows must be read-only; mutations belong to an explicitly dispatched governed tool.",
      ));
    }
    if (ruleEnabled(policy, "force_push_forbidden") && hasForcePush(content)) {
      findings.push(finding(
        "FORCE_PUSH_AUTOMATION",
        path,
        "Repository automation may not force-push.",
      ));
    }
    if (
      ruleEnabled(policy, "workflow_self_deletion_forbidden")
      && hasWorkflowSelfDeletion(content)
    ) {
      findings.push(finding(
        "SELF_DELETING_WORKFLOW",
        path,
        "A workflow may not delete or rewrite its own workflow definition.",
      ));
    }
    if (mutatesRepository) {
      if (!hasWorkflowDispatch(content)) {
        findings.push(finding(
          "UNGUARDED_AUTOMATION_MUTATION",
          path,
          "Write workflows must be explicitly dispatched rather than triggered by branch pushes or pull requests.",
        ));
      }
      if (
        ruleEnabled(policy, "expected_head_sha_required_for_mutation")
        && !hasExpectedHeadGuard(content)
      ) {
        findings.push(finding(
          "MISSING_EXPECTED_HEAD_GUARD",
          path,
          "Mutating automation must verify an explicit expected head SHA before writing.",
        ));
      }
      if (
        ruleEnabled(policy, "protected_branch_mutation_forbidden")
        && !hasProtectedBranchGuard(content)
      ) {
        findings.push(finding(
          "MISSING_PROTECTED_BRANCH_GUARD",
          path,
          "Mutating automation must reject main and Production before checkout or mutation.",
        ));
      }
    }
  }

  return findings;
}

function renderMarkdown(report) {
  const rows = report.findings.length
    ? report.findings.map((item) => `| ${item.code} | \`${item.path}\` | ${item.message} |`).join("\n")
    : "| none | — | Repository automation changes satisfy the governed lifecycle. |";
  return `# Repository Tool Lifecycle\n\n- Contract: \`${report.contract}\`\n- Candidate SHA: \`${report.candidate_sha}\`\n- Base SHA: \`${report.base_sha}\`\n- Result: **${report.ok ? "PASS" : "FAIL"}**\n- Changed files: ${report.changed_file_count}\n- Job logs authoritative: no\n- Secrets included: no\n\n| Code | Path | Finding |\n|---|---|---|\n${rows}\n`;
}

async function main() {
  const args = parseArguments(process.argv);
  const policyPath = args.policy || ".github/repository-maintenance-tool-governance.json";
  const changedFilesPath = args["changed-files"];
  const outputDirectory = args["output-dir"] || ".artifacts/repository-tool-lifecycle";
  if (!changedFilesPath) throw new Error("--changed-files is required");

  const policy = JSON.parse(await readFile(policyPath, "utf8"));
  const entries = normalizeChangedEntries(await readFile(changedFilesPath, "utf8"));
  const candidateSha = process.env.CANDIDATE_SHA || null;
  const baseSha = process.env.BASE_SHA || null;
  const findings = [
    ...validateGovernanceInputs({ policy, candidateSha, baseSha }),
    ...await evaluateRepositoryToolLifecycle({
      policy,
      entries,
      readText: (path) => readFile(path, "utf8"),
    }),
  ];
  const report = {
    contract: REPORT_CONTRACT,
    ok: findings.length === 0,
    policy_contract: policy.contract,
    candidate_kind: "head",
    candidate_sha: candidateSha,
    base_sha: baseSha,
    changed_file_count: entries.length,
    findings,
    canonical: true,
    log_access_required: false,
    secrets_included: false,
  };

  await mkdir(outputDirectory, { recursive: true });
  await writeFile(resolve(outputDirectory, "repository-tool-lifecycle-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(resolve(outputDirectory, "repository-tool-lifecycle-report.md"), renderMarkdown(report), "utf8");
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (!report.ok) process.exitCode = 1;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url || basename(fileURLToPath(import.meta.url)) === basename(process.argv[1] || "")) {
  await main();
}
