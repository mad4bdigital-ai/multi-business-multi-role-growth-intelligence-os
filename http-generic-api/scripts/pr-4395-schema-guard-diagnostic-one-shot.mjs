import fs from "node:fs";
import { spawnSync } from "node:child_process";

const EXPECTED_BRANCH = "gpt/tenant-request-inbox-chunk-store-hardening-20260801";
const HELPER = "scripts/pr-4395-schema-guard-diagnostic-one-shot.mjs";
const REPORT = "pr-4395-schema-guard-diagnostic.json";
const PACKAGE = "package.json";
const ORIGINAL = "npm run schemas:check && npm run openapi:response-objects:guard && npm run schemas:builder-guard && npm run openapi:lint:compat && npm run activation-gateway:bundle:check && node test-openapi-builder-schema-guard.mjs && npm run test:openapi:response-objects && npm run test:openapi:lint:compat && node test-custom-gpt-schemas.mjs && node test-openapi-split-governance.mjs && node test-openapi-split-regeneration-parity.mjs && node test-activation-gateway.mjs && node test-tenant-activation-session-alias.mjs && node test-tenant-tool-manifest-guard.mjs && node test-tenant-blocked-tool-export-registry-cleanup.mjs && node test-tenant-blocked-capability-export-cleanup.mjs && node test-tenant-tool-schema-strictness.mjs && node test-tenant-export-manifest-eligibility.mjs && node test-platform-routes.mjs && node test-platform-degradation-policy.mjs";
const TEMP = `node ${HELPER} && ${ORIGINAL}`;

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  return {
    command: [command, ...args].join(" "),
    status: result.status,
    signal: result.signal || null,
    stdout_tail: String(result.stdout || "").slice(-6000),
    stderr_tail: String(result.stderr || "").slice(-6000),
  };
}

const branch = String(process.env.GITHUB_HEAD_REF || spawnSync("git", ["branch", "--show-current"], { encoding: "utf8" }).stdout || "").trim();
if (branch !== EXPECTED_BRANCH) throw new Error(`refusing branch ${branch || "<detached>"}`);

const checks = [
  ["npm", ["run", "schemas:check"]],
  ["npm", ["run", "openapi:response-objects:guard"]],
  ["npm", ["run", "schemas:builder-guard"]],
  ["npm", ["run", "openapi:lint:compat"]],
  ["npm", ["run", "activation-gateway:bundle:check"]],
  [process.execPath, ["test-openapi-builder-schema-guard.mjs"]],
  ["npm", ["run", "test:openapi:response-objects"]],
  ["npm", ["run", "test:openapi:lint:compat"]],
  [process.execPath, ["test-custom-gpt-schemas.mjs"]],
  [process.execPath, ["test-openapi-split-governance.mjs"]],
  [process.execPath, ["test-openapi-split-regeneration-parity.mjs"]],
  [process.execPath, ["test-activation-gateway.mjs"]],
  [process.execPath, ["test-tenant-activation-session-alias.mjs"]],
  [process.execPath, ["test-tenant-tool-manifest-guard.mjs"]],
  [process.execPath, ["test-tenant-blocked-tool-export-registry-cleanup.mjs"]],
  [process.execPath, ["test-tenant-blocked-capability-export-cleanup.mjs"]],
  [process.execPath, ["test-tenant-tool-schema-strictness.mjs"]],
  [process.execPath, ["test-tenant-export-manifest-eligibility.mjs"]],
  [process.execPath, ["test-platform-routes.mjs"]],
  [process.execPath, ["test-platform-degradation-policy.mjs"]],
];

const results = [];
for (const [command, args] of checks) {
  const result = run(command, args);
  results.push(result);
  if (result.status !== 0) break;
}

const head = String(spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).stdout || "").trim();
const firstFailure = results.find((entry) => entry.status !== 0) || null;
fs.writeFileSync(REPORT, JSON.stringify({
  contract: "mad4b.schema-guard-diagnostic.v1",
  source_head_sha: head,
  outcome: firstFailure ? "failed" : "passed",
  first_failure: firstFailure,
  checks: results,
  secrets_included: false,
}, null, 2) + "\n");

const pkg = JSON.parse(fs.readFileSync(PACKAGE, "utf8"));
if (pkg.scripts["schemas:guard"] !== TEMP) throw new Error("temporary schemas:guard trigger drifted");
pkg.scripts["schemas:guard"] = ORIGINAL;
fs.writeFileSync(PACKAGE, JSON.stringify(pkg, null, 2) + "\n");
fs.unlinkSync(HELPER);

for (const [command, args] of [
  ["git", ["config", "user.name", "github-actions[bot]"]],
  ["git", ["config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"]],
  ["git", ["add", "--", REPORT, PACKAGE, HELPER]],
  ["git", ["diff", "--cached", "--check"]],
  ["git", ["commit", "-m", "chore(ci): publish structured schema guard diagnostic"]],
  ["git", ["push", "origin", `HEAD:${EXPECTED_BRANCH}`]],
]) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed`);
}
