#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";

function runGit(args, { allowFailure = false } = {}) {
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
  return Boolean(runGit(["cat-file", "-e", `${ref}^{commit}`], { allowFailure: true }) || true) &&
    runGit(["rev-parse", "--verify", `${ref}^{commit}`], { allowFailure: true }) !== "";
}

function resolveDiffRange() {
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

  return null;
}

function changedFiles(range) {
  if (!range) return [];
  const raw = runGit(["diff", "--name-only", "-z", range], { allowFailure: true });
  return raw.split("\0").map((item) => item.trim()).filter(Boolean).sort();
}

const CRITICAL_PATTERNS = [
  /^http-generic-api\/routes\/.*\.(js|mjs)$/,
  /^http-generic-api\/migrations\/.*\.(sql|js|mjs)$/,
  /^http-generic-api\/scripts\/(schema-import|.*registry.*|.*tool.*|.*openapi.*).*\.(js|mjs)$/i,
  /^http-generic-api\/.*(registry|Registry|tool|Tool|workflow|Workflow|credential|Credential).*\.(js|mjs)$/,
  /^src\/services\/execution\/.*\.(ts|js)$/,
  /^src\/services\/connectors\/.*\.(ts|js)$/,
  /^src\/store\/registries\/.*\.(ts|js)$/,
];

const COVERAGE_PATTERNS = [
  /^http-generic-api\/openapi.*\.ya?ml$/,
  /^http-generic-api\/test-.*\.mjs$/,
  /^tests\/.*\.(ts|js|mjs)$/,
  /^docs\//,
  /^canonicals\//,
  /^schemas\//,
  /^README\.md$/,
  /^AI_Agent_Knowledge_Guide\.md$/,
  /^GPT_Admin_Assistant_Knowledge_Guide\.md$/,
  /^Top Level Instructions\.md$/,
  /^direct_instructions_registry_patch\.md$/,
  /^connector_contracts\.md$/,
  /^runtime_boundary_map\.md$/,
  /^deployment_parity_checklist\.md$/,
  /^canonical_validation_checklist\.md$/,
  /^memory_schema\.json$/,
];

const GUARD_FILE = "http-generic-api/scripts/schema-docs-change-guard.mjs";

function matchesAny(file, patterns) {
  return patterns.some((pattern) => pattern.test(file));
}

const range = resolveDiffRange();
if (!range) {
  console.log("schema-docs-change-guard: no comparable git range; skipping.");
  process.exit(0);
}

const files = changedFiles(range);
const critical = files.filter((file) => matchesAny(file, CRITICAL_PATTERNS));
const coverage = files.filter((file) => matchesAny(file, COVERAGE_PATTERNS));
const guardUpdated = files.includes(GUARD_FILE) || files.includes(".github/workflows/ci.yml");

console.log(`schema-docs-change-guard: range ${range}`);
console.log(`schema-docs-change-guard: changed files ${files.length}`);
for (const file of files) console.log(`  - ${file}`);

if (!critical.length) {
  console.log("schema-docs-change-guard: no guarded runtime/schema-authority files changed.");
  process.exit(0);
}

if (coverage.length || guardUpdated) {
  console.log("schema-docs-change-guard: guarded changes include schema/docs/tests/canonical coverage.");
  process.exit(0);
}

console.error("schema-docs-change-guard: guarded runtime files changed without matching schema/docs/tests/canonical coverage.");
console.error("Guarded files:");
for (const file of critical) console.error(`  - ${file}`);
console.error("\nAdd or update at least one of:");
console.error("  - http-generic-api/openapi*.yaml");
console.error("  - http-generic-api/test-*.mjs or tests/**");
console.error("  - docs/**, canonicals/**, schemas/**");
console.error("  - AI_Agent_Knowledge_Guide.md or another canonical guide");
process.exit(1);
