import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";

const TARGET_BRANCH = "gpt/tenant-request-inbox-chunk-store-hardening-20260801";
const HELPER = "scripts/pr-4395-bounded-candidate-window-one-shot.mjs";
const TRANSFORM = "scripts/pr-4395-bounded-candidate-window-fix.py";
const REPORT = "pr-4395-bounded-candidate-window-diagnostic.json";
const PACKAGE = "package.json";
const MARKER_SCRIPT = "pr4395:bounded-candidate-window";
const MARKER_COMMAND = "node --check scripts/pr-4395-bounded-candidate-window-one-shot.mjs";
const CANONICAL_DISPATCH = "node scripts/frontend-operation-governance-generator.mjs --write && node scripts/frontend-surface-dispatch.mjs --write";
const HOOKED_DISPATCH = `node ${HELPER} && ${CANONICAL_DISPATCH}`;

function raw(command, args = [], options = {}) {
  return spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    ...options,
  });
}

function tail(value = "", max = 12000) {
  const text = String(value || "");
  return text.length <= max ? text : text.slice(-max);
}

function publishFailure(label, command, args, result) {
  const sourceHeadSha = String(raw("git", ["rev-parse", "HEAD"]).stdout || "").trim();
  raw("git", ["reset", "--hard", "HEAD"], { stdio: "inherit" });
  writeFileSync(REPORT, `${JSON.stringify({
    contract: "mad4b.pr-4395-bounded-candidate-window-diagnostic.v1",
    source_head_sha: sourceHeadSha,
    outcome: "failed",
    first_failure: {
      label,
      command: [command, ...args].join(" "),
      status: result.status,
      signal: result.signal || null,
      stdout_tail: tail(result.stdout),
      stderr_tail: tail(result.stderr),
    },
    secrets_included: false,
  }, null, 2)}\n`);
  raw("git", ["config", "user.name", "github-actions[bot]"], { stdio: "inherit" });
  raw("git", ["config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"], { stdio: "inherit" });
  raw("git", ["add", "--", REPORT], { stdio: "inherit" });
  raw("git", ["commit", "-m", "test(ci): publish bounded candidate-window diagnostic"], { stdio: "inherit" });
  raw("git", ["push", "origin", `HEAD:${TARGET_BRANCH}`], { stdio: "inherit" });
  throw new Error(`${label} failed with status ${result.status}`);
}

function run(label, command, args = []) {
  const result = raw(command, args);
  if (result.status !== 0) publishFailure(label, command, args, result);
  return result;
}

const branch = String(process.env.GITHUB_HEAD_REF || raw("git", ["branch", "--show-current"]).stdout || "").trim();
if (branch !== TARGET_BRANCH) throw new Error(`unexpected branch: ${branch}`);
const packageJson = JSON.parse(readFileSync(PACKAGE, "utf8"));
if (packageJson.scripts?.["frontend:dispatch:generate"] !== HOOKED_DISPATCH) throw new Error("candidate-window hook mismatch");
if (packageJson.scripts?.[MARKER_SCRIPT] !== MARKER_COMMAND) throw new Error("candidate-window marker mismatch");
if (existsSync(REPORT)) unlinkSync(REPORT);

run("apply bounded candidate-window transform", "python3", [TRANSFORM]);
run("check tenant inbox syntax", "node", ["--check", "tenantRequestInboxService.js"]);
run("tenant inbox candidate-window regression", "node", ["test-tenant-request-inbox-and-chunk-hardening.mjs"]);
run("platform route regression", "node", ["test-platform-routes.mjs"]);
run("context kernel hardcoding report", "node", ["scripts/context-kernel-hardcoding-report.mjs", "--base-ref=main", "--head-ref=HEAD", "--report-only"]);

packageJson.scripts["frontend:dispatch:generate"] = CANONICAL_DISPATCH;
delete packageJson.scripts[MARKER_SCRIPT];
writeFileSync(PACKAGE, `${JSON.stringify(packageJson, null, 2)}\n`);
unlinkSync(TRANSFORM);
unlinkSync(HELPER);
if (existsSync(REPORT)) unlinkSync(REPORT);
run("validate bounded candidate-window diff", "git", ["diff", "--check"]);
raw("git", ["config", "user.name", "github-actions[bot]"], { stdio: "inherit" });
raw("git", ["config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"], { stdio: "inherit" });
raw("git", ["add", "--", PACKAGE, HELPER, TRANSFORM, REPORT, "tenantRequestInboxService.js", "test-tenant-request-inbox-and-chunk-hardening.mjs", "migrations/1041_sprint69_tenant_request_inbox_and_chunk_store_hardening.sql"], { stdio: "inherit" });
run("commit bounded candidate-window fix", "git", ["commit", "-m", "fix(tenant-requests): bound latest activity candidate work"]);
run("push bounded candidate-window fix", "git", ["push", "origin", `HEAD:${TARGET_BRANCH}`]);
