import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const adminCliRoutes = readFileSync("routes/adminCliRoutes.js", "utf8");
const manifest = readFileSync("scripts/test-manifest.mjs", "utf8");

assert.ok(adminCliRoutes.includes('(method === "POST" && apiTarget === "/pulls")'), "GitHub REST fallback must explicitly allow POST /pulls");
assert.ok(adminCliRoutes.includes('apiTarget === "/merges"'), "Existing repo merge fallback must remain present");
assert.ok(adminCliRoutes.includes('github_rest_api_unsupported_path'), "Unsupported GitHub REST paths must remain blocked");
assert.ok(adminCliRoutes.includes('GitHub REST API fallback only supports repo-scoped compare/pulls/commits reads plus guarded PR close, PR update-branch, PR merge, workflow dispatches, repo merges, guarded branch ref updates, and guarded contents PUT mutations.'), "Unsupported-path error must remain explicit");
assert.ok(!adminCliRoutes.includes('apiTarget.startsWith("/") && ["POST", "PUT", "PATCH"].includes(method)'), "GitHub REST fallback must not allow arbitrary mutating paths");
assert.ok(manifest.includes("node test-github-pr-create-rest-fallback.mjs"), "test manifest must include PR create REST fallback test");

console.log("Guarded GitHub PR create REST fallback contract OK");
