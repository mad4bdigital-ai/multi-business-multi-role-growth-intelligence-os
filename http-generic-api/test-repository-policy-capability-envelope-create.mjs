import assert from "node:assert/strict";
import fs from "node:fs";
import {
  buildBindingContext,
  buildRepositoryPolicyEnvelopeDryRun,
} from "./scripts/capability-resolution-envelope-create.mjs";
import { buildGithubRepositoryPolicyCapabilityBinding } from "./githubRepositoryPolicyController.js";

const mainSha = "a".repeat(40);
const policyFingerprint = "b".repeat(64);
const target = {
  owner: "mad4bdigital-ai",
  repo: "multi-business-multi-role-growth-intelligence-os",
  default_branch: "main",
};
const binding = buildGithubRepositoryPolicyCapabilityBinding({
  target,
  expected_main_sha: mainSha,
  expected_policy_fingerprint: policyFingerprint,
});
assert.ok(binding);
assert.equal(binding.resource_uri, "github://mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os/branch/main");
assert.equal(binding.expected_commit_sha, mainSha);
assert.equal(binding.capability_sha256, policyFingerprint);
assert.match(binding.binding_sha256, /^[0-9a-f]{64}$/);

{
  const context = buildBindingContext([
    "--repository-binding-key=growth_intelligence_platform.github.primary.production",
    `--resource-uri=${binding.resource_uri}`,
    `--expected-commit-sha=${mainSha}`,
    `--binding-sha256=${binding.binding_sha256}`,
    `--capability-sha256=${policyFingerprint}`,
  ]);
  assert.equal(context.repository_binding_key, "growth_intelligence_platform.github.primary.production");
  assert.equal(context.resource_uri, binding.resource_uri);
  assert.equal(context.expected_commit_sha, mainSha);
  assert.equal(context.binding_sha256, binding.binding_sha256);
  assert.equal(context.capability_sha256, policyFingerprint);
}

await assert.rejects(
  () => buildRepositoryPolicyEnvelopeDryRun({
    dryRunArgs: {
      appKey: "github",
      capabilityKey: "repository_policy_controller",
      operationIntent: "github_repository_policy_apply",
      runtimeSurface: "auth_host",
      requestedSourceTier: "platform_managed_fallback",
    },
    bindingContext: {
      resource_uri: binding.resource_uri,
      expected_commit_sha: mainSha,
      binding_sha256: binding.binding_sha256,
      capability_sha256: policyFingerprint,
    },
    pool: {},
  }),
  (error) => error?.code === "repository_policy_capability_surface_mismatch",
);

await assert.rejects(
  () => buildRepositoryPolicyEnvelopeDryRun({
    dryRunArgs: {
      appKey: "github",
      capabilityKey: "repository_policy_controller",
      operationIntent: "github_repository_policy_apply",
      runtimeSurface: "system_layer",
      requestedSourceTier: "platform_managed_fallback",
    },
    bindingContext: { expected_commit_sha: mainSha },
    pool: {},
  }),
  (error) => error?.code === "repository_policy_capability_exact_binding_required",
);

assert.equal(
  await buildRepositoryPolicyEnvelopeDryRun({
    dryRunArgs: {
      appKey: "github",
      capabilityKey: "unrelated_capability",
      operationIntent: "read",
    },
    bindingContext: {},
    pool: {},
  }),
  null,
  "Non-repository-policy capabilities must remain on the existing generic dry-run path",
);

const source = fs.readFileSync(new URL("./scripts/capability-resolution-envelope-create.mjs", import.meta.url), "utf8");
assert.match(source, /resolveRepositoryCapabilityAuthority/);
assert.match(source, /buildGithubRepositoryPolicyCapabilityBinding/);
assert.match(source, /repository_policy_controller/);
assert.match(source, /github_repository_policy_apply/);
assert.match(source, /platform_managed_fallback/);
assert.match(source, /system_layer/);
assert.match(source, /repository_policy_capability_binding_mismatch/);
assert.match(source, /dispatch_allowed:\s*true/);
assert.match(source, /apply_allowed:\s*false/);
assert.match(source, /approval_required:\s*true/);
assert.match(source, /readback_required:\s*true/);
assert.match(source, /provider_call_executed:\s*false/);
assert.match(source, /external_write_executed:\s*false/);
assert.match(source, /credential_payload_read:\s*false/);

console.log(JSON.stringify({
  ok: true,
  test: "repository_policy_capability_envelope_create",
  exact_head_binding: true,
  generic_path_preserved: true,
  provider_call_executed: false,
  external_write_executed: false,
  secrets_included: false,
}));
