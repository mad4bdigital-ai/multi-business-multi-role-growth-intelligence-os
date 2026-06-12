#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const DOCS_AGENT_VERSION = "docs-impact-classifier-v1";

const FAMILY_RULES = [
  {
    key: "runtime_routes",
    risk: "high",
    docs: ["http-generic-api/openapi.yaml", "docs/change-documentation-governance.md", "AI_Agent_Knowledge_Guide.md"],
    match: (file) => /^http-generic-api\/routes\/.*\.(js|mjs)$/.test(file),
    reason: "runtime route changed; update API/tool behavior docs and tests",
  },
  {
    key: "database_migration",
    risk: "high",
    docs: ["Updating Registry Patch Index.md", "docs/change-documentation-governance.md", "deployment_parity_checklist.md"],
    match: (file) => /^http-generic-api\/migrations\/.*\.(sql|js|mjs)$/.test(file),
    reason: "migration changed; record safety class, scope, readback, and patch ledger evidence",
  },
  {
    key: "credential_or_auth",
    risk: "high",
    docs: ["docs/external-endpoint-auth-strategy.md", "connector_contracts.md", "AI_Agent_Knowledge_Guide.md"],
    match: (file) => /(auth|Auth|credential|Credential|oauth|OAuth|jwt|JWT|secret|Secret)/.test(file),
    reason: "auth or credential-adjacent file changed; document secret-safe behavior and scoped auth boundary",
  },
  {
    key: "deployment_runtime",
    risk: "high",
    docs: ["deployment_parity_checklist.md", "docs/hostinger-node-deploy.md", "http-generic-api/docs/hostinger-runtime-sync-runbook.md"],
    match: (file) => /(deployment|deploy|hostinger|runtime-sync|verify-runtime|healthRoutes|deploymentInfo)/i.test(file) || /^\.github\/workflows\//.test(file),
    reason: "deployment/runtime evidence surface changed; keep deployment parity and runtime sync docs aligned",
  },
  {
    key: "tenant_gpt",
    risk: "medium",
    docs: ["GPT_Tenant_Connector_Instructions.md", "GPT_Tenant_Connector_Knowledge.md", "docs/tenant-gpt-operating-guide.md"],
    match: (file) => /tenant.*gpt|GPT_Tenant|tenantLifecycle|tenant.*tool|openapi\.tenant-gpt/i.test(file),
    reason: "tenant GPT or tenant tool behavior changed; update tenant-safe operating guidance",
  },
  {
    key: "admin_gpt",
    risk: "medium",
    docs: ["GPT_Admin_Assistant_Knowledge_Guide.md", "AI_Agent_Knowledge_Guide.md", "Top Level Instructions.md"],
    match: (file) => /admin.*gpt|GPT_Admin|admin_control|adminPlatform|admin-tool/i.test(file),
    reason: "admin GPT/admin tool behavior changed; update admin operating guidance",
  },
  {
    key: "canonical_sources",
    risk: "medium",
    docs: ["direct_instructions_registry_patch.md", "module_loader.md", "prompt_router.md", "system_bootstrap.md", "AI_Agent_Knowledge_Guide.md"],
    match: (file) => /^canonicals\//.test(file) || /build-canonicals|canonical-manifest|validate-canonical/i.test(file),
    reason: "canonical source changed; rebuild/check generated roots and agent guidance",
  },
  {
    key: "openapi_schema",
    risk: "medium",
    docs: ["docs/openapi-split-governance.md", "docs/repo-maintenance-status.md", "http-generic-api/openapi.yaml"],
    match: (file) => /openapi.*\.ya?ml$|schema.*route|split-openapi/i.test(file),
    reason: "OpenAPI/schema surface changed; keep split-schema governance and route coverage aligned",
  },
  {
    key: "docs_agent",
    risk: "low",
    docs: ["docs/ai-docs-agent-governance.md", "docs/auto-docs-agent/README.md"],
    match: (file) => /docs-impact-classifier|docs-agent|ai-docs-agent|auto-docs-agent/i.test(file),
    reason: "documentation automation changed; keep docs-agent governance current",
  },
];

const RISK_ORDER = ["low", "medium", "high"];

export function uniqueSorted(values = []) {
  return [...new Set(values.filter(Boolean))].sort();
}

export function maxRisk(values = []) {
  let idx = 0;
  for (const value of values) idx = Math.max(idx, RISK_ORDER.indexOf(value));
  return RISK_ORDER[idx] || "low";
}

export function isDocsLike(file = "") {
  return /(^docs\/|\.md$|^README\.md$|^canonicals\/|^schemas\/|^deployment_parity_checklist\.md$|^runtime_boundary_map\.md$|^connector_contracts\.md$|^AI_Agent_Knowledge_Guide\.md$|^GPT_.*_Knowledge_Guide\.md$|^GPT_.*_Instructions\.md$|^Top Level Instructions\.md$|^Updating Registry Patch Index\.md$)/.test(file);
}

export function isTestLike(file = "") {
  return /(^tests\/|^http-generic-api\/test-.*\.mjs$|^http-generic-api\/scripts\/test-manifest\.mjs$)/.test(file);
}

export function classifyChangedFiles(files = []) {
  const normalizedFiles = uniqueSorted(files.map((file) => String(file || "").replace(/\\/g, "/").trim()).filter(Boolean));
  const matchedFamilies = [];
  const requiredDocs = [];
  const reasons = [];

  for (const file of normalizedFiles) {
    for (const rule of FAMILY_RULES) {
      if (!rule.match(file)) continue;
      matchedFamilies.push(rule.key);
      requiredDocs.push(...rule.docs);
      reasons.push(`${file}: ${rule.reason}`);
    }
  }

  const docsFilesChanged = normalizedFiles.filter(isDocsLike);
  const testFilesChanged = normalizedFiles.filter(isTestLike);
  const nonDocsFiles = normalizedFiles.filter((file) => !isDocsLike(file));
  const nonDocsNonTestsFiles = normalizedFiles.filter((file) => !isDocsLike(file) && !isTestLike(file));
  const docsOnly = normalizedFiles.length > 0 && nonDocsFiles.length === 0;
  const docsOrTestsOnly = normalizedFiles.length > 0 && nonDocsNonTestsFiles.length === 0;
  const familyRisks = FAMILY_RULES.filter((rule) => matchedFamilies.includes(rule.key)).map((rule) => rule.risk);
  const risk = docsOnly ? "low" : maxRisk(familyRisks.length ? familyRisks : [docsOrTestsOnly ? "low" : "medium"]);
  const required = uniqueSorted(requiredDocs);
  const docsMissing = required.filter((doc) => !docsFilesChanged.includes(doc));

  const shouldGenerate = normalizedFiles.length > 0 && !docsOnly;
  const autoMergeCandidate = docsOnly || (matchedFamilies.length === 1 && matchedFamilies[0] === "docs_agent");

  return {
    version: DOCS_AGENT_VERSION,
    changed_files: normalizedFiles,
    families: uniqueSorted(matchedFamilies),
    risk,
    required_docs: required,
    docs_files_changed: docsFilesChanged,
    test_files_changed: testFilesChanged,
    docs_missing: docsMissing,
    docs_only: docsOnly,
    docs_or_tests_only: docsOrTestsOnly,
    should_generate: shouldGenerate,
    auto_merge_candidate: autoMergeCandidate,
    reasons: uniqueSorted(reasons),
    secrets_included: false,
  };
}

export function runGit(args, { allowFailure = false } = {}) {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (err) {
    if (allowFailure) return "";
    const stderr = err?.stderr?.toString?.() || err?.message || String(err);
    throw new Error(`git ${args.join(" ")} failed: ${stderr}`);
  }
}

function readGithubEvent() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath || !fs.existsSync(eventPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(eventPath, "utf8"));
  } catch {
    return {};
  }
}

function isAllZeroSha(value) {
  return /^0{40}$/.test(String(value || ""));
}

function hasCommit(ref) {
  if (!ref) return false;
  return runGit(["rev-parse", "--verify", `${ref}^{commit}`], { allowFailure: true }) !== "";
}

export function resolveDiffRange({ base, head } = {}) {
  if (base && head) return `${base}...${head}`;
  if (base) return `${base}..${head || "HEAD"}`;

  const eventName = process.env.GITHUB_EVENT_NAME || "";
  const event = readGithubEvent();

  if (eventName === "pull_request" || eventName === "pull_request_target") {
    const baseSha = event?.pull_request?.base?.sha;
    const baseRef = event?.pull_request?.base?.ref || process.env.GITHUB_BASE_REF;
    if (baseSha && hasCommit(baseSha)) return `${baseSha}...HEAD`;
    if (baseRef) {
      runGit(["fetch", "--no-tags", "origin", baseRef], { allowFailure: true });
      if (hasCommit(`origin/${baseRef}`)) return `origin/${baseRef}...HEAD`;
    }
    return null;
  }

  if (eventName === "push") {
    const before = event?.before;
    const after = event?.after || process.env.GITHUB_SHA || "HEAD";
    if (before && !isAllZeroSha(before) && hasCommit(before)) return `${before}..${after}`;
    if (hasCommit("HEAD^")) return "HEAD^..HEAD";
    return null;
  }

  if (hasCommit("HEAD^")) return "HEAD^..HEAD";
  return null;
}

export function changedFilesForRange(range) {
  if (!range) return [];
  const raw = runGit(["diff", "--name-only", "-z", range], { allowFailure: true });
  return raw.split("\0").map((item) => item.trim()).filter(Boolean).sort();
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = { json: false, markdown: false, base: "", head: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === "--json") args.json = true;
    else if (item === "--markdown") args.markdown = true;
    else if (item === "--base") args.base = argv[++i] || "";
    else if (item.startsWith("--base=")) args.base = item.slice("--base=".length);
    else if (item === "--head") args.head = argv[++i] || "";
    else if (item.startsWith("--head=")) args.head = item.slice("--head=".length);
  }
  return args;
}

export function renderImpactMarkdown(impact = {}, { title = "Automated Docs Agent Impact" } = {}) {
  const lines = [];
  lines.push(`# ${title}`);
  lines.push("");
  lines.push("This file is generated by the repository documentation agent. It contains no secrets and is intended to make required documentation updates explicit and reviewable.");
  lines.push("");
  lines.push("## Classification");
  lines.push("");
  lines.push(`- Version: \`${impact.version || DOCS_AGENT_VERSION}\``);
  lines.push(`- Risk: \`${impact.risk || "low"}\``);
  lines.push(`- Families: ${(impact.families || []).length ? impact.families.map((item) => `\`${item}\``).join(", ") : "none"}`);
  lines.push(`- Secrets included: \`${impact.secrets_included === false ? "false" : "unknown"}\``);
  lines.push("");
  lines.push("## Changed files");
  lines.push("");
  for (const file of impact.changed_files || []) lines.push(`- \`${file}\``);
  if (!(impact.changed_files || []).length) lines.push("- none");
  lines.push("");
  lines.push("## Required documentation targets");
  lines.push("");
  for (const file of impact.required_docs || []) lines.push(`- \`${file}\``);
  if (!(impact.required_docs || []).length) lines.push("- none detected");
  lines.push("");
  lines.push("## Documentation still missing from this diff");
  lines.push("");
  for (const file of impact.docs_missing || []) lines.push(`- \`${file}\``);
  if (!(impact.docs_missing || []).length) lines.push("- none");
  lines.push("");
  lines.push("## Reasons");
  lines.push("");
  for (const reason of impact.reasons || []) lines.push(`- ${reason}`);
  if (!(impact.reasons || []).length) lines.push("- no guarded runtime family detected");
  lines.push("");
  lines.push("## Agent recommendation");
  lines.push("");
  if (impact.risk === "high") {
    lines.push("High-risk runtime or schema surfaces changed. Keep this generated note, and add targeted human-readable documentation for the exact runtime behavior, safety class, and validation evidence before promotion.");
  } else if (impact.risk === "medium") {
    lines.push("Medium-risk platform guidance changed. Review the required docs list and ensure tenant/admin boundaries, generated schemas, and canonical guidance remain aligned.");
  } else {
    lines.push("Low-risk documentation or automation change. CI guard evidence is usually sufficient unless the diff affects generated canonical output.");
  }
  return `${lines.join("\n")}\n`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs();
  const range = resolveDiffRange({ base: args.base, head: args.head });
  const files = changedFilesForRange(range);
  const impact = classifyChangedFiles(files);
  if (args.markdown) {
    process.stdout.write(renderImpactMarkdown(impact));
  } else {
    process.stdout.write(`${JSON.stringify({ range, ...impact }, null, 2)}\n`);
  }
}
