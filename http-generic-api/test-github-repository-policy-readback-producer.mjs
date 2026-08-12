import assert from "node:assert/strict";
import { readGithubRepositoryPolicy } from "./githubRepositoryPolicyController.js";

const OWNER = "mad4bdigital-ai";
const REPO = "growth-os";
const MAIN_SHA = "a".repeat(40);

function response(status, payload = {}) {
  return { ok: status >= 200 && status < 300, status, async json() { return payload; } };
}

function fetchFixture(url, options = {}) {
  assert.equal(options.method || "GET", "GET", "readback must be GET-only");
  const path = new URL(String(url)).pathname;
  if (path === `/repos/${OWNER}/${REPO}`) return response(200, { allow_auto_merge: false });
  if (path === `/repos/${OWNER}/${REPO}/branches/main`) return response(200, { protected: false, commit: { sha: MAIN_SHA } });
  if (path === `/repos/${OWNER}/${REPO}/rules/branches/main`) return response(200, []);
  if (path === `/repos/${OWNER}/${REPO}/rulesets`) return response(200, []);
  if (path === `/repos/${OWNER}/${REPO}/branches/main/protection`) return response(404, { message: "Branch not protected" });
  if (path === `/repos/${OWNER}/${REPO}/collaborators`) return response(200, [{ login: "owner", type: "User" }]);
  if (path === `/repos/${OWNER}/${REPO}/collaborators/owner/permission`) return response(200, { permission: "admin", role_name: "admin" });
  throw new Error(`Unexpected request ${path}`);
}

const result = await readGithubRepositoryPolicy({ owner: OWNER, repo: REPO }, { token: "read-only-token", fetchImpl: fetchFixture });
assert.equal(result.mode, "readback");
assert.equal(result.main_sha, MAIN_SHA);
assert.equal(result.branch_protected, false);
assert.equal(result.proof.server_policy_gate_complete, false);
assert.equal(result.mutation_executed, false);
assert.equal(result.secrets_included, false);
assert.equal(result.findings.includes("required_review_missing"), true);
assert.equal(result.findings.includes("finalizer_app_identity_unresolved"), true);
console.log("github repository policy readback producer contract tests passed");
