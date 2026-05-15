import assert from "node:assert/strict";

process.env.ACTIVATION_GITHUB_PARENT_ACTION_KEY = "github_api_mcp";
process.env.ACTIVATION_GITHUB_ENDPOINT_KEY = "github_get_repository";
process.env.ACTIVATION_GITHUB_REPOSITORY = "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os";
delete process.env.ACTIVATION_GITHUB_OWNER;
delete process.env.ACTIVATION_GITHUB_REPO;
process.env.ACTIVATION_GITHUB_BRANCH = "main";

const {
  readActivationBootstrapFromEnv,
  validateActivationBootstrapConfig,
} = await import("./activationBootstrapConfig.js");

const envConfig = readActivationBootstrapFromEnv();
assert.equal(envConfig.ok, true, "activation bootstrap env fallback resolves from ACTIVATION_GITHUB_REPOSITORY");
assert.equal(envConfig.config.github_owner, "mad4bdigital-ai", "owner parsed from repository env var");
assert.equal(envConfig.config.github_repo, "multi-business-multi-role-growth-intelligence-os", "repo parsed from repository env var");
assert.equal(envConfig.config.github_branch, "main", "branch comes from activation env var");

const explicitConfig = validateActivationBootstrapConfig({
  github_parent_action_key: "github_api_mcp",
  github_endpoint_key: "github_get_repository",
  github_owner: "explicit-owner",
  github_repo: "explicit-repo",
  github_repository: "ignored-owner/ignored-repo",
  github_branch: "main",
});

assert.equal(explicitConfig.ok, true, "explicit owner/repo remains valid");
assert.equal(explicitConfig.config.github_owner, "explicit-owner", "explicit owner wins");
assert.equal(explicitConfig.config.github_repo, "explicit-repo", "explicit repo wins");

console.log("activation bootstrap config test passed");
