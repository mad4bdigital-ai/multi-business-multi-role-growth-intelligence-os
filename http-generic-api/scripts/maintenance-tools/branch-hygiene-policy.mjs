import crypto from "node:crypto";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

export const DEFAULT_POLICY_PATH = ".github/branch-hygiene-policy.json";
export const PRIORITY_ORDER = Object.freeze({ critical: 0, high: 1, medium: 2, low: 3, info: 4 });

export function matchesAny(value, patterns = []) {
  return patterns.some((pattern) => new RegExp(pattern).test(value));
}

export function policySha256(policy) {
  return crypto.createHash("sha256").update(`${JSON.stringify(policy)}\n`).digest("hex");
}

function ageDays(commitAt, nowMs) {
  const timestamp = Date.parse(commitAt);
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, Math.floor((nowMs - timestamp) / 86_400_000));
}

export function namespaceOf(branchName = "") {
  const [namespace] = String(branchName).split("/");
  return namespace || "root";
}

export function ageBandFor(age, policy = {}) {
  if (!Number.isFinite(age)) return "unknown";
  const bands = policy.age_band_days ?? { recent: 7, review: 45, aging: 90, old: 180 };
  if (age <= Number(bands.recent)) return "recent_0_7d";
  if (age <= Number(bands.review)) return "review_8_45d";
  if (age <= Number(bands.aging)) return "aging_46_90d";
  if (age <= Number(bands.old)) return "old_91_180d";
  return "very_old_181d_plus";
}

function triageFor({ category, eligibleForDelete, reviewOnly, openPullRequest, protected: isProtected, excluded }) {
  if (category === "deletion_failed") {
    return { priority: "critical", priorityRank: PRIORITY_ORDER.critical, reasonCode: "delete_attempt_failed", recommendedAction: "investigate_delete_failure", actionOwner: "maintainer" };
  }
  if (isProtected) {
    return { priority: "info", priorityRank: PRIORITY_ORDER.info, reasonCode: "protected_branch", recommendedAction: "retain_protected", actionOwner: "none" };
  }
  if (excluded) {
    return { priority: "info", priorityRank: PRIORITY_ORDER.info, reasonCode: "excluded_namespace", recommendedAction: "retain_excluded_namespace", actionOwner: "none" };
  }
  if (openPullRequest) {
    return { priority: "high", priorityRank: PRIORITY_ORDER.high, reasonCode: "open_pull_request_blocks_cleanup", recommendedAction: "review_open_pr", actionOwner: "maintainer" };
  }
  if (eligibleForDelete) {
    return { priority: "high", priorityRank: PRIORITY_ORDER.high, reasonCode: "merged_old_no_open_pr", recommendedAction: "delete_on_apply", actionOwner: "automation" };
  }
  if (reviewOnly) {
    return { priority: "medium", priorityRank: PRIORITY_ORDER.medium, reasonCode: "old_unmerged_work_requires_decision", recommendedAction: "review_unmerged_or_archive", actionOwner: "maintainer" };
  }
  if (category === "unmerged_recent_or_unclassified") {
    return { priority: "low", priorityRank: PRIORITY_ORDER.low, reasonCode: "unmerged_not_yet_reviewable", recommendedAction: "retain_and_revisit", actionOwner: "maintainer" };
  }
  if (category === "merged_within_grace_period") {
    return { priority: "info", priorityRank: PRIORITY_ORDER.info, reasonCode: "merged_inside_grace_period", recommendedAction: "retain_until_grace_period", actionOwner: "automation" };
  }
  return { priority: "info", priorityRank: PRIORITY_ORDER.info, reasonCode: "recent_or_active_branch", recommendedAction: "retain_active", actionOwner: "none" };
}

export function evaluateBranch(branch, policy, context = {}) {
  const nowMs = context.nowMs ?? Date.now();
  const openPrHeads = context.openPrHeads ?? new Set();
  const openPrInfoByHead = context.openPrInfoByHead ?? new Map();
  const protectedBranches = context.protectedBranches ?? new Set();
  const mergedIntoDefault = Boolean(branch.mergedIntoDefault);
  const protectedByName = matchesAny(branch.name, policy.protected_branch_patterns);
  const protectedByProvider = protectedBranches.has(branch.name);
  const excluded = matchesAny(branch.name, policy.excluded_namespace_patterns);
  const reviewOnlyNamespace = matchesAny(branch.name, policy.review_only_namespace_patterns);
  const openPr = openPrInfoByHead.get(branch.name) ?? null;
  const openPullRequest = openPrHeads.has(branch.name) || Boolean(openPr);
  const age = ageDays(branch.commitAt, nowMs);
  const oldEnoughForDelete = age !== null && age >= Number(policy.grace_period_days);
  const oldEnoughForReview = age !== null && age >= Number(policy.unmerged_review_after_days);
  const isProtected = protectedByName || protectedByProvider;
  const eligibleForDelete = mergedIntoDefault && !openPullRequest && !isProtected && !excluded && oldEnoughForDelete;
  const reviewOnly = !mergedIntoDefault && !openPullRequest && !isProtected && !excluded && oldEnoughForReview;

  let category = "recent_or_active";
  if (isProtected) category = "protected";
  else if (excluded) category = "excluded_namespace";
  else if (openPullRequest) category = "open_pull_request";
  else if (eligibleForDelete) category = "delete_eligible";
  else if (reviewOnly) category = reviewOnlyNamespace ? "review_only_unmerged" : "review_only_unmerged_namespace_unclassified";
  else if (!mergedIntoDefault) category = "unmerged_recent_or_unclassified";
  else if (!oldEnoughForDelete) category = "merged_within_grace_period";

  const triage = triageFor({ category, eligibleForDelete, reviewOnly, openPullRequest, protected: isProtected, excluded });
  const uniqueCommitCount = Number.isFinite(Number(branch.uniqueCommits))
    ? Number(branch.uniqueCommits)
    : (mergedIntoDefault ? 0 : null);

  return {
    ...branch,
    namespace: namespaceOf(branch.name),
    ageDays: age,
    ageBand: ageBandFor(age, policy),
    uniqueCommitCount,
    mergedIntoDefault,
    protected: isProtected,
    protectedByName,
    protectedByProvider,
    excluded,
    openPullRequest,
    openPrNumber: openPr?.number ?? null,
    openPrUrl: openPr?.url ?? null,
    category,
    eligibleForDelete,
    reviewOnly,
    reviewOnlyNamespace,
    priority: triage.priority,
    priorityRank: triage.priorityRank,
    reasonCode: triage.reasonCode,
    recommendedAction: triage.recommendedAction,
    actionOwner: triage.actionOwner,
    actionTaken: branch.actionTaken ?? "none",
  };
}

function countBy(branches, field) {
  return branches.reduce((result, branch) => {
    const key = String(branch[field] ?? "unknown");
    result[key] = (result[key] ?? 0) + 1;
    return result;
  }, {});
}

export function sortBranchesForTriage(branches = []) {
  return [...branches].sort((left, right) => (
    (left.priorityRank ?? PRIORITY_ORDER.info) - (right.priorityRank ?? PRIORITY_ORDER.info)
    || (right.ageDays ?? -1) - (left.ageDays ?? -1)
    || (right.uniqueCommitCount ?? -1) - (left.uniqueCommitCount ?? -1)
    || String(left.name).localeCompare(String(right.name))
  ));
}

export function summarizeBranches(branches) {
  const summary = {
    total: branches.length,
    delete_eligible: 0,
    deleted: 0,
    deletion_failed: 0,
    open_pull_request: 0,
    protected: 0,
    excluded_namespace: 0,
    review_only_unmerged: 0,
    review_only_unmerged_namespace_unclassified: 0,
    unmerged_recent_or_unclassified: 0,
    merged_within_grace_period: 0,
    recent_or_active: 0,
    processable: 0,
    by_priority: {},
    by_recommended_action: {},
    by_namespace: {},
    by_age_band: {},
  };
  for (const branch of branches) {
    if (branch.deleted) summary.deleted += 1;
    if (branch.deletionFailed) summary.deletion_failed += 1;
    summary[branch.category] = (summary[branch.category] ?? 0) + 1;
    summary.by_priority[branch.priority] = (summary.by_priority[branch.priority] ?? 0) + 1;
    summary.by_recommended_action[branch.recommendedAction] = (summary.by_recommended_action[branch.recommendedAction] ?? 0) + 1;
    summary.by_namespace[branch.namespace] = (summary.by_namespace[branch.namespace] ?? 0) + 1;
    summary.by_age_band[branch.ageBand] = (summary.by_age_band[branch.ageBand] ?? 0) + 1;
    if (["delete_eligible", "open_pull_request", "review_only_unmerged", "review_only_unmerged_namespace_unclassified"].includes(branch.category)) summary.processable += 1;
  }
  return summary;
}

function run(command, args, options = {}) {
  const env = { ...process.env, GH_FORCE_TTY: "never", NO_COLOR: "1" };
  return execFileSync(command, args, { encoding: "utf8", env, maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", options.allowFailure ? "pipe" : "inherit"] }).trim();
}

function stripAnsi(value) {
  return String(value).replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
}

function runJson(command, args) {
  const raw = stripAnsi(run(command, args));
  return JSON.parse(raw || "null");
}

function flattenPaginated(value) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => (Array.isArray(item) ? item : [item]));
}

function parseArgs(argv) {
  const args = {
    mode: null,
    policy: DEFAULT_POLICY_PATH,
    output: "branch-hygiene-report.json",
    csvOutput: null,
    markdownOutput: null,
    repo: process.env.GITHUB_REPOSITORY ?? "",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--mode") args.mode = argv[++index];
    else if (token === "--policy") args.policy = argv[++index];
    else if (token === "--output") args.output = argv[++index];
    else if (token === "--csv-output") args.csvOutput = argv[++index];
    else if (token === "--markdown-output") args.markdownOutput = argv[++index];
    else if (token === "--repo") args.repo = argv[++index];
    else if (token === "--confirm") args.confirm = argv[++index];
    else if (token === "--fixture") args.fixture = argv[++index];
    else throw new Error(`Unknown argument: ${token}`);
  }
  return args;
}

function fixtureData(path) {
  const fixture = JSON.parse(fs.readFileSync(path, "utf8"));
  const openPrs = fixture.open_prs ?? (fixture.open_pr_heads ?? []).map((headRefName) => ({ headRefName }));
  return {
    defaultBranch: fixture.default_branch ?? "main",
    defaultSha: fixture.default_sha,
    branches: fixture.branches ?? [],
    openPrHeads: new Set(openPrs.map((pr) => pr.headRefName)),
    openPrInfoByHead: new Map(openPrs.map((pr) => [pr.headRefName, { number: pr.number ?? null, url: pr.url ?? null }])),
    protectedBranches: new Set(fixture.protected_branches ?? []),
  };
}

function liveData(repo, defaultBranch) {
  const branchRefs = run("git", ["for-each-ref", `--format=%(refname:strip=3)%09%(objectname)%09%(committerdate:iso8601-strict)`, "refs/remotes/origin/"])
    .split("\n")
    .filter(Boolean)
    .filter((line) => !line.startsWith("HEAD\t"))
    .map((line) => {
      const [name, sha, commitAt] = line.split("\t");
      return { name, sha, commitAt };
    });
  const defaultSha = run("git", ["rev-parse", `refs/remotes/origin/${defaultBranch}`]);
  const openPrs = runJson("gh", ["pr", "list", "--repo", repo, "--state", "open", "--limit", "1000", "--json", "number,headRefName,url"]);
  const branchPages = runJson("gh", ["api", "--paginate", "--slurp", `repos/${repo}/branches?per_page=100`]);
  const protectedBranches = new Set(flattenPaginated(branchPages).filter((branch) => branch.protected === true).map((branch) => branch.name));
  const openPrHeads = new Set(openPrs.map((pr) => pr.headRefName));
  const openPrInfoByHead = new Map(openPrs.map((pr) => [pr.headRefName, { number: pr.number ?? null, url: pr.url ?? null }]));
  const branches = branchRefs.map((branch) => {
    let mergedIntoDefault = false;
    try {
      execFileSync("git", ["merge-base", "--is-ancestor", branch.sha, defaultSha], { stdio: "ignore" });
      mergedIntoDefault = true;
    } catch {
      mergedIntoDefault = false;
    }
    let uniqueCommits = null;
    if (!mergedIntoDefault) {
      try {
        uniqueCommits = Number(run("git", ["rev-list", "--count", `${defaultSha}..${branch.sha}`]));
      } catch {
        uniqueCommits = null;
      }
    }
    return { ...branch, mergedIntoDefault, uniqueCommits };
  });
  return { defaultBranch, defaultSha, branches, openPrHeads, openPrInfoByHead, protectedBranches };
}

function deleteBranch(repo, branch, expectedSha) {
  const ref = runJson("gh", ["api", `repos/${repo}/git/matching-refs/heads/${branch.name}`]);
  const actualSha = String(ref?.[0]?.object?.sha ?? ref?.object?.sha ?? "");
  if (actualSha !== expectedSha) throw new Error(`head_changed:${branch.name}:${actualSha}`);
  run("gh", ["api", "--method", "DELETE", `repos/${repo}/git/refs/heads/${branch.name}`]);
}

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function renderBranchCsv(branches = []) {
  const fields = [
    "name", "namespace", "sha", "commitAt", "ageDays", "ageBand", "mergedIntoDefault", "uniqueCommitCount",
    "openPullRequest", "openPrNumber", "openPrUrl", "protected", "excluded", "category", "priority", "priorityRank",
    "reasonCode", "recommendedAction", "actionOwner", "eligibleForDelete", "reviewOnly", "actionTaken", "deleted", "deletionFailed",
  ];
  return [
    fields.join(","),
    ...sortBranchesForTriage(branches).map((branch) => fields.map((field) => csvCell(branch[field])).join(",")),
    "",
  ].join("\n");
}

function markdownTable(rows, headers) {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows,
  ];
}

export function renderBranchMarkdown(report, maxRows = 200) {
  const actionableCategories = new Set(report.triage?.actionable_categories ?? ["delete_eligible", "open_pull_request", "review_only_unmerged", "review_only_unmerged_namespace_unclassified"]);
  const actionable = report.branches.filter((branch) => actionableCategories.has(branch.category));
  const rows = actionable.slice(0, maxRows).map((branch) => (
    `| ${branch.priority} | ${branch.category} | \`${branch.name}\` | ${branch.ageDays ?? "?"} | ${branch.uniqueCommitCount ?? "?"} | ${branch.recommendedAction} | ${branch.reasonCode} |`
  ));
  const priorityRows = Object.entries(report.summary.by_priority).sort((left, right) => (PRIORITY_ORDER[left[0]] ?? 99) - (PRIORITY_ORDER[right[0]] ?? 99)).map(([key, value]) => `| ${key} | ${value} |`);
  const actionRows = Object.entries(report.summary.by_recommended_action).sort((left, right) => left[0].localeCompare(right[0])).map(([key, value]) => `| ${key} | ${value} |`);
  return [
    "# Branch Hygiene Triage Report",
    "",
    `- Contract: \`${report.contract}\``,
    `- Mode: **${report.mode}**`,
    `- Default branch: \`${report.default_branch}\``,
    `- Default branch SHA: \`${report.default_branch_sha}\``,
    `- Policy SHA-256: \`${report.policy_sha256}\``,
    `- Total branches: **${report.summary.total}**`,
    `- Processable queue: **${report.summary.processable}**`,
    `- Displayed actionable rows: **${Math.min(actionable.length, maxRows)} / ${actionable.length}**`,
    "",
    "## Priority summary",
    "",
    ...markdownTable(priorityRows.length ? priorityRows : ["| — | 0 |"], ["Priority", "Count"]),
    "",
    "## Recommended action summary",
    "",
    ...markdownTable(actionRows.length ? actionRows : ["| — | 0 |"], ["Recommended action", "Count"]),
    "",
    "## Action queue",
    "",
    ...markdownTable(rows.length ? rows : ["| — | — | No actionable branches. | — | — | — | — |"], ["Priority", "Category", "Branch", "Age days", "Unique commits", "Recommended action", "Reason"]),
    "",
    "The complete sortable inventory is in the JSON and CSV artifacts. Unmerged work remains report-only; no row in this report grants authority to delete it.",
    "",
  ].join("\n");
}

export function buildReport({ policy, policyPath, repo, defaultBranch, defaultSha, mode, branches, generatedAt }) {
  const sortedBranches = sortBranchesForTriage(branches);
  return {
    contract: "mad4b.branch-hygiene-report.v2",
    schema_version: 2,
    generated_at: generatedAt,
    repository: repo || null,
    policy_path: policyPath,
    policy_sha256: policySha256(policy),
    default_branch: defaultBranch,
    default_branch_sha: defaultSha,
    mode,
    triage: {
      sort_order: ["priority_rank_asc", "age_days_desc", "unique_commit_count_desc", "name_asc"],
      actionable_categories: ["delete_eligible", "open_pull_request", "review_only_unmerged", "review_only_unmerged_namespace_unclassified"],
      markdown_actionable_row_limit: 200,
    },
    safety: {
      protected_branch_mutation: false,
      force_push: false,
      production_mutation: false,
      database_mutation: false,
      provider_mutation: false,
      secrets_included: false,
    },
    summary: summarizeBranches(sortedBranches),
    branches: sortedBranches,
  };
}

function writeOutput(filePath, content) {
  if (!filePath) return;
  fs.mkdirSync(requireDirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function requireDirname(filePath) {
  const slash = String(filePath).lastIndexOf("/");
  return slash >= 0 ? String(filePath).slice(0, slash) || "." : ".";
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const policy = JSON.parse(fs.readFileSync(args.policy, "utf8"));
  const mode = args.mode ?? policy.default_mode ?? "dry_run";
  if (!new Set(["dry_run", "apply"]).has(mode)) throw new Error(`Unsupported mode: ${mode}`);
  if (mode === "apply" && args.confirm !== policy.apply_confirmation) throw new Error("apply mode requires the exact policy confirmation token");
  const defaultBranch = "main";
  const data = args.fixture ? fixtureData(args.fixture) : liveData(args.repo, defaultBranch);
  if (data.defaultBranch !== defaultBranch) throw new Error(`default branch must remain main, got ${data.defaultBranch}`);
  const nowMs = Date.now();
  const evaluated = data.branches.map((branch) => evaluateBranch(branch, policy, {
    nowMs,
    openPrHeads: data.openPrHeads,
    openPrInfoByHead: data.openPrInfoByHead,
    protectedBranches: data.protectedBranches,
  }));
  if (mode === "apply") {
    const currentDefaultSha = args.fixture ? data.defaultSha : run("gh", ["api", `repos/${args.repo}/git/ref/heads/${defaultBranch}`, "--jq", ".object.sha"]);
    if (currentDefaultSha !== data.defaultSha) throw new Error(`default branch moved during run: ${data.defaultSha} -> ${currentDefaultSha}`);
    for (const branch of evaluated) {
      if (!branch.eligibleForDelete) continue;
      try {
        deleteBranch(args.repo, branch, branch.sha);
        branch.deleted = true;
        branch.actionTaken = "deleted";
      } catch (error) {
        branch.deletionFailed = true;
        branch.actionTaken = "deletion_failed";
        branch.deletionError = String(error?.message ?? error);
        branch.category = "deletion_failed";
        const triage = triageFor(branch);
        Object.assign(branch, triage);
      }
    }
  }
  const report = buildReport({
    policy,
    policyPath: args.policy,
    repo: args.repo,
    defaultBranch,
    defaultSha: data.defaultSha,
    mode,
    branches: evaluated,
    generatedAt: new Date().toISOString(),
  });
  const json = `${JSON.stringify(report, null, 2)}\n`;
  const csv = renderBranchCsv(report.branches);
  const markdown = renderBranchMarkdown(report);
  writeOutput(args.output, json);
  writeOutput(args.csvOutput, csv);
  writeOutput(args.markdownOutput, markdown);
  process.stdout.write(`${JSON.stringify({ contract: report.contract, mode, policy_sha256: report.policy_sha256, default_branch_sha: report.default_branch_sha, summary: report.summary, outputs: { json: args.output, csv: args.csvOutput, markdown: args.markdownOutput } }, null, 2)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
