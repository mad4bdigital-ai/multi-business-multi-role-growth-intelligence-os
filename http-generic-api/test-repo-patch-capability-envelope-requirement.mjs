import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const gptTools = readFileSync(new URL("./routes/gptToolsRoutes.js", import.meta.url), "utf8");
const migration = readFileSync(new URL("./migrations/229_sprint67_repo_patch_capability_envelope_requirement.sql", import.meta.url), "utf8");
const runner = readFileSync(new URL("./scripts/governed-migration-runner.mjs", import.meta.url), "utf8");

assert.match(gptTools, /repo_patch_apply/);
assert.match(gptTools, /capability_envelope_id/);
assert.match(gptTools, /requireRepoPatchCapabilityEnvelope/);
assert.match(gptTools, /resolveCapabilityExecutionEnvelope/);
assert.match(gptTools, /acceptedAppKeys: \["github"\]/);
assert.match(gptTools, /markCapabilityEnvelopeReferenced/);
assert.match(gptTools, /getGitHubAppInstallationToken/);
assert.match(gptTools, /evaluateRepoPatchApplyPreflight/);
assert.match(gptTools, /assertRepoPatchBranchPolicy/);
assert.match(gptTools, /secrets_included: false/);

const helperBlock = gptTools.slice(gptTools.indexOf("async function requireRepoPatchCapabilityEnvelope"), gptTools.indexOf("function resolveCallerType"));
assert.match(helperBlock, /requireRepoPatchCapabilityEnvelope/);
assert.doesNotMatch(helperBlock, /value_ciphertext|oauth_token|decryptToken\(/i);

const repoPatchSchemaIndex = gptTools.indexOf('name: "repo_patch_apply"');
const repoInspectSchemaIndex = gptTools.indexOf('name: "repo_inspect"');
assert.ok(repoInspectSchemaIndex > -1 && repoPatchSchemaIndex > repoInspectSchemaIndex, "repo_inspect remains a separate read-only virtual tool.");
const repoPatchBlock = gptTools.slice(repoPatchSchemaIndex, gptTools.indexOf("const REPO_PATCH_MAX_BYTES"));
assert.match(repoPatchBlock, /required: \["action", "path", "commit_message", "capability_envelope_id"\]/);

const tokenIndex = gptTools.indexOf("await getGitHubAppInstallationToken");
const envelopeGateIndex = gptTools.lastIndexOf("await requireRepoPatchCapabilityEnvelope", tokenIndex);
assert.ok(envelopeGateIndex > -1, "capability envelope gate must run before GitHub token resolution.");
assert.ok(tokenIndex > envelopeGateIndex, "GitHub App token must be resolved only after capability envelope gate.");
assert.ok(gptTools.includes("const envelope = await requireRepoPatchCapabilityEnvelope"), "repo patch runtime must assign envelope before token resolution.");

assert.match(migration, /repo_patch_apply_capability_envelope_requirement_v1/);
assert.match(migration, /read_only_repo_inspect_requires_envelope',false/);
assert.match(migration, /repo_patch_apply_requires_envelope',true/);
assert.match(migration, /github_app_token_blocked_without_envelope',true/);
assert.match(migration, /github_content_mutation_blocked_without_envelope',true/);
assert.match(migration, /existing_preflight_still_required',true/);
assert.match(migration, /protected_branch_guard_still_required',true/);
assert.match(migration, /stale_branch_guard_still_required',true/);
assert.match(migration, /secrets_included',false/);
assert.doesNotMatch(migration, /DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i);
assert.doesNotMatch(migration, /GITHUB_TOKEN\s*[:=]|OPENAI_API_KEY\s*[:=]|OPENROUTER_API_KEY\s*[:=]|sk-[A-Za-z0-9_\-]{12,}/i);
assert.match(runner, /229_sprint67_repo_patch_capability_envelope_requirement\.sql/);

console.log("repo_patch_apply capability envelope requirement guard passed");
