import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";

const TARGET_BRANCH = "gpt/tenant-request-inbox-chunk-store-hardening-20260801";
const TRIGGER_SUBJECT = "chore(ci): run PR 4395 permanent review fixes";
const HELPER = "scripts/pr-4395-permanent-review-fixes-one-shot.mjs";
const TRANSFORM = "scripts/pr-4395-permanent-review-fixes.py";
const PACKAGE = "package.json";
const CANONICAL_DISPATCH = "node scripts/frontend-operation-governance-generator.mjs --write && node scripts/frontend-surface-dispatch.mjs --write";
const HOOKED_DISPATCH = `node ${HELPER} && ${CANONICAL_DISPATCH}`;

function run(command, args = [], options = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: "inherit",
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with status ${result.status}`);
  }
}

const branch = spawnSync("git", ["branch", "--show-current"], { encoding: "utf8" }).stdout.trim();
const subject = spawnSync("git", ["log", "-1", "--format=%s"], { encoding: "utf8" }).stdout.trim();
if (branch !== TARGET_BRANCH) throw new Error(`unexpected branch: ${branch}`);
if (subject !== TRIGGER_SUBJECT) throw new Error(`unexpected trigger commit: ${subject}`);

const packageJson = JSON.parse(readFileSync(PACKAGE, "utf8"));
if (packageJson.scripts?.["frontend:dispatch:generate"] !== HOOKED_DISPATCH) {
  throw new Error("one-shot dispatch hook is not the exact expected contract");
}

run("python3", [TRANSFORM]);
run("node", ["--check", "governedToolResponseChunkStore.js"]);
run("node", ["--check", "routes/supportTicketRoutes.js"]);
run("node", ["--check", "routes/systemLayerRoutes.js"]);
run("node", ["--check", "tenantRequestInboxService.js"]);
run("node", ["test-governed-tool-response-chunk-store.mjs"]);
run("node", ["test-tenant-request-inbox-and-chunk-hardening.mjs"]);
run("node", ["test-platform-routes.mjs"]);

packageJson.scripts["frontend:dispatch:generate"] = CANONICAL_DISPATCH;
writeFileSync(PACKAGE, `${JSON.stringify(packageJson, null, 2)}\n`);
unlinkSync(TRANSFORM);
unlinkSync(HELPER);

run("git", ["diff", "--check"]);
run("git", ["config", "user.name", "github-actions[bot]"]);
run("git", ["config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"]);
run("git", [
  "add", "--",
  PACKAGE,
  HELPER,
  TRANSFORM,
  "governedToolResponseChunkStore.js",
  "routes/supportTicketRoutes.js",
  "routes/systemLayerRoutes.js",
  "tenantRequestInboxService.js",
  "test-governed-tool-response-chunk-store.mjs",
  "test-tenant-request-inbox-and-chunk-hardening.mjs",
  "test-platform-routes.mjs",
]);
run("git", ["commit", "-m", "fix(tenant-requests): close review security and fallback gaps"]);
run("git", ["push", "origin", `HEAD:${TARGET_BRANCH}`]);
