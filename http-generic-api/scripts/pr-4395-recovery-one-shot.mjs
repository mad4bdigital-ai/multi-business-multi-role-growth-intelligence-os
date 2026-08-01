import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";

const SOURCE_BRANCH = "gpt/tenant-request-inbox-chunk-store-hardening-20260801";
const HELPER = "scripts/pr-4395-recovery-one-shot.mjs";
const PACKAGE = "package.json";
const CANONICAL_DISPATCH = "node scripts/frontend-operation-governance-generator.mjs --write && node scripts/frontend-surface-dispatch.mjs --write";
const HOOKED_DISPATCH = `node ${HELPER}`;
const PERMANENT_PATHS = [
  ".changes/e2e/tenant-request-inbox-chunk-hardening.json",
  "http-generic-api/governedToolResponseChunkStore.js",
  "http-generic-api/migrations/1041_sprint69_tenant_request_inbox_and_chunk_store_hardening.sql",
  "http-generic-api/openapi/tenant-requests.openapi.yaml",
  "http-generic-api/routes/gptToolsRoutes.js",
  "http-generic-api/routes/supportTicketRoutes.js",
  "http-generic-api/routes/systemLayerRoutes.js",
  "http-generic-api/supportTicketResolutionService.js",
  "http-generic-api/tenantRequestInboxService.js",
  "http-generic-api/test-governed-response-chunk-durable-recovery-smoke.mjs",
  "http-generic-api/test-governed-tool-response-chunk-store.mjs",
  "http-generic-api/test-gpt-tools-response-chunking.mjs",
  "http-generic-api/test-platform-routes.mjs",
  "http-generic-api/test-tenant-request-inbox-and-chunk-hardening.mjs",
];

function run(command, args = [], options = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    stdio: "inherit",
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with status ${result.status}`);
  }
}

const packageJson = JSON.parse(readFileSync(PACKAGE, "utf8"));
if (packageJson.scripts?.["frontend:dispatch:generate"] !== HOOKED_DISPATCH) {
  throw new Error("recovery hook mismatch");
}

// Run Git operations from the repository root so every pathspec is canonical.
run("git", ["-C", "..", "fetch", "origin", SOURCE_BRANCH]);
run("git", ["-C", "..", "checkout", `origin/${SOURCE_BRANCH}`, "--", ...PERMANENT_PATHS]);

// The source branch already contains the reviewed bounded candidate-window implementation.
// A separate transient transform is neither required nor authoritative.
run("node", ["--check", "governedToolResponseChunkStore.js"]);
run("node", ["--check", "routes/supportTicketRoutes.js"]);
run("node", ["--check", "routes/systemLayerRoutes.js"]);
run("node", ["--check", "tenantRequestInboxService.js"]);
run("node", ["test-governed-tool-response-chunk-store.mjs"]);
run("node", ["test-gpt-tools-response-chunking.mjs"]);
run("node", ["test-tenant-request-inbox-and-chunk-hardening.mjs"]);
run("node", ["test-platform-routes.mjs"]);
run("npm", ["run", "openapi:auth:write"]);
run("node", ["scripts/frontend-operation-governance-generator.mjs", "--write"]);
run("node", ["scripts/frontend-surface-dispatch.mjs", "--write"]);

packageJson.scripts["frontend:dispatch:generate"] = CANONICAL_DISPATCH;
writeFileSync(PACKAGE, `${JSON.stringify(packageJson, null, 2)}\n`);
unlinkSync(HELPER);
run("git", ["diff", "--check"]);
