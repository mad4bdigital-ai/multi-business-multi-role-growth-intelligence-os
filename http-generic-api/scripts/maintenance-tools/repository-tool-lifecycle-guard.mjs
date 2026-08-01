#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPORT_CONTRACT = "mad4b.repository-tool-lifecycle-report.v1";

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

function containsBranchSpecificLiteral(content) {
  return /(?:ref\s*:|branches\s*:|git\s+push[^\n]*HEAD:)[^\n]*(?:gpt|fix|feat|chore|docs|release)\/[A-Za-z0-9._/-]+/iu.test(content);
}

function hasContentsWrite(content) {
  return /permissions\s*:[\s\S]{0,500}?contents\s*:\s*write/iu.test(content);
}

function hasPullRequestTrigger(content) {
  return /(?:^|\n)\s*pull_request(?:_target)?\s*:/u.test(content);
}

function hasWorkflowDispatch(content) {
  return /(?:^|\n)\s*workflow_dispatch\s*:/u.test(content);
}

function hasGitPush(content) {
  return /git\s+push\b/iu.test(content);
}

function hasForcePush(content) {
  return /git\s+push[^\n]*(?:--force(?:-with-lease)?|\s-f(?:\s|$))/iu.test(content);
}

function hasWorkflowSelfDeletion(content) {
  return /(?:unlink\s*\([^)]*\.github\/workflows|(?:rm|git\s+rm)[^\n]*\.github\/workflows)/iu.test(content);
}

function hasExpectedHeadGuard(content) {
  return /expected_head_sha/iu.test(content) && /git\s+rev-parse\s+HEAD/iu.test(content);
}

function hasProtectedBranchGuard(content) {
  return /(?:main|Production)/u.test(content) && /(?:reject|forbid|exit\s+1|case\s+)/iu.test(content);
}

function isMaintenanceLikeScript(path) {
  return /^\.github\/scripts\/(?:apply|patch|repair|migrate|.*trigger)/iu.test(path);
}

export async function evaluateRepositoryToolLifecycle({ policy, entries, readText }) {
  const findings = [];
  const registeredEntrypoints = new Set(
    Object.values(policy.tools || {})
      .map((tool) => tool?.entrypoint)
      .filter(Boolean),
  );
  const forbiddenPatterns = (policy.forbidden_path_patterns || []).map(
    (pattern) => new RegExp(pattern, "u"),
  );

  for (const entry of entries) {
    const path = entry.path;
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

    if (entry.status.startsWith("D")) continue;

    if (path.startsWith(`${policy.tool_root}/`) && !registeredEntrypoints.has(path)) {
      findings.push(finding(
        "UNREGISTERED_MAINTENANCE_TOOL",
        path,
        "Reusable maintenance tools must be declared in the repository maintenance tool registry.",
      ));
    }

    if (isMaintenanceLikeScript(path) && !registeredEntrypoints.has(path)) {
      findings.push(finding(
        "ONE_OFF_MAINTENANCE_SCRIPT",
        path,
        "Maintenance scripts must live under the governed tool root and be registered, or be deleted before Ready for Review.",
      ));
    }

    if (!path.startsWith(".github/workflows/")) continue;
    const content = await readText(path);

    if (containsBranchSpecificLiteral(content)) {
      findings.push(finding(
        "BRANCH_SPECIFIC_WORKFLOW",
        path,
        "Permanent workflows must accept governed inputs and may not embed a work-branch name.",
      ));
    }
    if (hasPullRequestTrigger(content) && hasContentsWrite(content)) {
      findings.push(finding(
        "PULL_REQUEST_WRITE_WORKFLOW",
        path,
        "Pull-request workflows must be read-only; mutations belong to an explicitly dispatched governed tool.",
      ));
    }
    if (hasForcePush(content)) {
      findings.push(finding(
        "FORCE_PUSH_AUTOMATION",
        path,
        "Repository automation may not force-push.",
      ));
    }
    if (hasWorkflowSelfDeletion(content)) {
      findings.push(finding(
        "SELF_DELETING_WORKFLOW",
        path,
        "A workflow may not delete or rewrite its own workflow definition.",
      ));
    }
    if (hasGitPush(content) && hasContentsWrite(content)) {
      if (!hasWorkflowDispatch(content)) {
        findings.push(finding(
          "UNGUARDED_AUTOMATION_MUTATION",
          path,
          "Write workflows must be explicitly dispatched rather than triggered by branch pushes or pull requests.",
        ));
      }
      if (!hasExpectedHeadGuard(content)) {
        findings.push(finding(
          "MISSING_EXPECTED_HEAD_GUARD",
          path,
          "Mutating automation must verify an explicit expected head SHA before writing.",
        ));
      }
      if (!hasProtectedBranchGuard(content)) {
        findings.push(finding(
          "MISSING_PROTECTED_BRANCH_GUARD",
          path,
          "Mutating automation must reject main and Production before checkout or push.",
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
  const findings = await evaluateRepositoryToolLifecycle({
    policy,
    entries,
    readText: (path) => readFile(path, "utf8"),
  });
  const report = {
    contract: REPORT_CONTRACT,
    ok: findings.length === 0,
    policy_contract: policy.contract,
    candidate_kind: "head",
    candidate_sha: process.env.CANDIDATE_SHA || null,
    base_sha: process.env.BASE_SHA || null,
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
