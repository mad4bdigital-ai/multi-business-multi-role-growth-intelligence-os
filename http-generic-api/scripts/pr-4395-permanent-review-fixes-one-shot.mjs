import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";

const TARGET_BRANCH = "gpt/tenant-request-inbox-chunk-store-hardening-20260801";
const HELPER = "scripts/pr-4395-permanent-review-fixes-one-shot.mjs";
const TRANSFORM = "scripts/pr-4395-permanent-review-fixes.py";
const SHARED_TRANSFORM = "scripts/pr-4395-shared-system-tools-budget-fix.py";
const REPORT = "pr-4395-permanent-review-fixes-diagnostic.json";
const PACKAGE = "package.json";
const MARKER_SCRIPT = "pr4395:permanent-review-fixes";
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
  const report = {
    contract: "mad4b.pr-4395-permanent-review-fixes-diagnostic.v1",
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
  };
  writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
  raw("git", ["config", "user.name", "github-actions[bot]"], { stdio: "inherit" });
  raw("git", ["config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"], { stdio: "inherit" });
  raw("git", ["add", "--", REPORT], { stdio: "inherit" });
  raw("git", ["commit", "-m", "test(ci): publish PR 4395 permanent-fix diagnostic"], { stdio: "inherit" });
  raw("git", ["push", "origin", `HEAD:${TARGET_BRANCH}`], { stdio: "inherit" });
  throw new Error(`${label} failed with status ${result.status}`);
}

function run(label, command, args = []) {
  const result = raw(command, args);
  if (result.status !== 0) publishFailure(label, command, args, result);
  return result;
}

const branch = String(
  process.env.GITHUB_HEAD_REF
  || raw("git", ["branch", "--show-current"]).stdout
  || "",
).trim();
if (branch !== TARGET_BRANCH) throw new Error(`unexpected branch: ${branch}`);

const packageJson = JSON.parse(readFileSync(PACKAGE, "utf8"));
if (packageJson.scripts?.["frontend:dispatch:generate"] !== HOOKED_DISPATCH) {
  throw new Error("one-shot dispatch hook is not the exact expected contract");
}
if (packageJson.scripts?.[MARKER_SCRIPT] !== "node -e \"process.exit(0)\"") {
  throw new Error("one-shot marker script is not the exact expected contract");
}
if (existsSync(REPORT)) unlinkSync(REPORT);

run("apply permanent review transform", "python3", [TRANSFORM]);
run("apply shared system-tools budget transform", "python3", [SHARED_TRANSFORM]);
run("check governed chunk store syntax", "node", ["--check", "governedToolResponseChunkStore.js"]);
run("check support ticket routes syntax", "node", ["--check", "routes/supportTicketRoutes.js"]);
run("check system layer routes syntax", "node", ["--check", "routes/systemLayerRoutes.js"]);
run("check tenant inbox service syntax", "node", ["--check", "tenantRequestInboxService.js"]);
run("governed chunk store regression", "node", ["test-governed-tool-response-chunk-store.mjs"]);
run("tenant request inbox regression", "node", ["test-tenant-request-inbox-and-chunk-hardening.mjs"]);
run("platform routes regression", "node", ["test-platform-routes.mjs"]);

packageJson.scripts["frontend:dispatch:generate"] = CANONICAL_DISPATCH;
delete packageJson.scripts[MARKER_SCRIPT];
writeFileSync(PACKAGE, `${JSON.stringify(packageJson, null, 2)}\n`);
unlinkSync(TRANSFORM);
unlinkSync(SHARED_TRANSFORM);
unlinkSync(HELPER);
if (existsSync(REPORT)) unlinkSync(REPORT);

run("validate staged diff", "git", ["diff", "--check"]);
raw("git", ["config", "user.name", "github-actions[bot]"], { stdio: "inherit" });
raw("git", ["config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"], { stdio: "inherit" });
raw("git", [
  "add", "--",
  PACKAGE,
  HELPER,
  TRANSFORM,
  SHARED_TRANSFORM,
  REPORT,
  "governedToolResponseChunkStore.js",
  "routes/supportTicketRoutes.js",
  "routes/systemLayerRoutes.js",
  "tenantRequestInboxService.js",
  "test-governed-tool-response-chunk-store.mjs",
  "test-tenant-request-inbox-and-chunk-hardening.mjs",
  "test-platform-routes.mjs",
], { stdio: "inherit" });
run("commit permanent review fixes", "git", ["commit", "-m", "fix(tenant-requests): close review security and fallback gaps"]);
run("push permanent review fixes", "git", ["push", "origin", `HEAD:${TARGET_BRANCH}`]);
