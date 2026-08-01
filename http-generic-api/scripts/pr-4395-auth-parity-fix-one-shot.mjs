import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";

const TARGET_BRANCH = "gpt/tenant-request-inbox-chunk-store-hardening-20260801";
const HELPER = "scripts/pr-4395-auth-parity-fix-one-shot.mjs";
const PACKAGE = "package.json";
const MARKER = "pr4395:auth-parity-fix";
const CANONICAL = "node scripts/frontend-operation-governance-generator.mjs --write && node scripts/frontend-surface-dispatch.mjs --write";
const HOOKED = `node ${HELPER} && ${CANONICAL}`;

function replaceExact(file, before, after, expected = 1) {
  const source = readFileSync(file, "utf8");
  const count = source.split(before).length - 1;
  if (count !== expected) throw new Error(`${file}: expected ${expected} matches, found ${count}`);
  writeFileSync(file, source.split(before).join(after));
}
function run(command, args = []) {
  const result = spawnSync(command, args, { cwd: process.cwd(), encoding: "utf8", stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed with ${result.status}`);
}

const branch = String(process.env.GITHUB_HEAD_REF || spawnSync("git", ["branch", "--show-current"], { encoding: "utf8" }).stdout || "").trim();
if (branch !== TARGET_BRANCH) throw new Error(`unexpected branch ${branch}`);
const packageJson = JSON.parse(readFileSync(PACKAGE, "utf8"));
if (packageJson.scripts?.["frontend:dispatch:generate"] !== HOOKED) throw new Error("auth parity hook mismatch");
if (packageJson.scripts?.[MARKER] !== "node --check scripts/pr-4395-auth-parity-fix-one-shot.mjs") throw new Error("auth parity marker mismatch");

replaceExact(
  "routes/supportTicketRoutes.js",
  "  const tenantRequestUserJwt = deps.requireTenantRequestUserJwt\n    || createUserJwtMiddleware({ env: deps.env || process.env });",
  "  const requireTenantUserJwt = deps.requireTenantRequestUserJwt\n    || createUserJwtMiddleware({ env: deps.env || process.env });",
);
replaceExact("routes/supportTicketRoutes.js", "tenantRequestUserJwt, async (req, res) => {", "requireTenantUserJwt, async (req, res) => {", 2);
replaceExact("test-tenant-request-inbox-and-chunk-hardening.mjs", "tenantRequestUserJwt/u);", "requireTenantUserJwt/u);", 2);

run("node", ["--check", "routes/supportTicketRoutes.js"]);
run("node", ["test-tenant-request-inbox-and-chunk-hardening.mjs"]);
run("node", ["scripts/frontend-surface-dispatch.mjs", "--write"]);
run("node", ["test-frontend-auth-openapi-parity.mjs"]);

packageJson.scripts["frontend:dispatch:generate"] = CANONICAL;
delete packageJson.scripts[MARKER];
writeFileSync(PACKAGE, `${JSON.stringify(packageJson, null, 2)}\n`);
unlinkSync(HELPER);
run("git", ["diff", "--check"]);
run("git", ["config", "user.name", "github-actions[bot]"]);
run("git", ["config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"]);
run("git", ["add", "--", PACKAGE, HELPER, "routes/supportTicketRoutes.js", "test-tenant-request-inbox-and-chunk-hardening.mjs", "frontend-surface-dispatch.generated.json"]);
run("git", ["commit", "-m", "fix(tenant-requests): expose central JWT guard to auth parity"]);
run("git", ["push", "origin", `HEAD:${TARGET_BRANCH}`]);
