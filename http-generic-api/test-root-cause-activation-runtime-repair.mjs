import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { assertNoSecretBearingFields } from "./capabilityEnvelopeSecretPolicy.js";
import { redactDangerousKeys } from "./scripts/capability-resolution-envelope-create.mjs";
import {
  generateDeploymentManifest,
  isDirectExecution,
  ROOT_ENTRYPOINT_BRANCH_LOCK_ENV,
} from "./scripts/generate-deployment-manifest.mjs";

const activationSource = readFileSync(new URL("./routes/activationRoutes.js", import.meta.url), "utf8");
assert.match(
  activationSource,
  /if \(!isAdmin && rowsOrEmpty\(grants\)\.length === 0\) authGaps\.push\("no_active_permission_grants"\);/,
  "platform admins must not receive a false missing permission grant gap"
);

const toolsSource = readFileSync(new URL("./routes/gptToolsRoutes.js", import.meta.url), "utf8");
const reservedBlock = toolsSource.match(/const RESERVED_TOOL_KEYS = new Set\(\[([\s\S]*?)\]\);/)?.[1] || "";
assert(reservedBlock, "reserved tool registry block must remain present");
assert.doesNotMatch(reservedBlock, /gpt_session_end|gpt_session_turn/, "registered session archive tools must remain dispatcher-callable");
assert.match(reservedBlock, /gpt_tools_call/, "dispatcher self-call must remain reserved");

const serverSource = readFileSync(new URL("./server.js", import.meta.url), "utf8");
const startupManifestCall = serverSource.indexOf("generateDeploymentManifest();");
const runtimeGuardMarker = serverSource.indexOf("// --- Runtime Guards Initialization ---");
assert(startupManifestCall >= 0, "server startup must generate deployment provenance directly");
assert(runtimeGuardMarker > startupManifestCall, "deployment manifest generation must run before runtime initialization");

const scriptPath = resolve("scripts/generate-deployment-manifest.mjs");
assert.equal(isDirectExecution(pathToFileURL(scriptPath).href, scriptPath), true, "manifest CLI detection must be path-safe");
assert.equal(
  isDirectExecution(pathToFileURL(scriptPath).href, resolve("scripts/not-generate-deployment-manifest.mjs")),
  false,
  "manifest generator must not execute when imported"
);

const dir = mkdtempSync(join(tmpdir(), "mad4b-root-cause-manifest-"));
const manifestPath = join(dir, "deployment-manifest.json");
const lockedManifestPath = join(dir, "deployment-manifest-locked.json");
const explicitManifestPath = join(dir, "deployment-manifest-explicit.json");
const commitSha = "0123456789abcdef0123456789abcdef01234567";
try {
  const result = generateDeploymentManifest({
    env: {
      DEPLOYMENT_BRANCH: "main",
      DEPLOYMENT_COMMIT_SHA: commitSha,
      ACTIVATION_GITHUB_REPOSITORY: "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
    },
    argv: [],
    outputPath: manifestPath,
    deployedAt: "2026-06-14T00:00:00.000Z",
  });
  assert.equal(result.ok, true);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  assert.equal(manifest.branch, "main");
  assert.equal(manifest.branch_source, "env:DEPLOYMENT_BRANCH");
  assert.equal(manifest.commit_sha, commitSha);
  assert.equal(manifest.commit_source, "env:DEPLOYMENT_COMMIT_SHA");
  assert.equal(manifest.deployed_at, "2026-06-14T00:00:00.000Z");

  const lockedResult = generateDeploymentManifest({
    env: {
      [ROOT_ENTRYPOINT_BRANCH_LOCK_ENV]: "Production",
      DEPLOYMENT_BRANCH: "main",
      ACTIVATION_GITHUB_BRANCH: "main",
      DEPLOYMENT_COMMIT_SHA: commitSha,
    },
    argv: [],
    outputPath: lockedManifestPath,
    deployedAt: "2026-08-03T08:52:07.532Z",
  });
  assert.equal(lockedResult.ok, true);
  const lockedManifest = JSON.parse(readFileSync(lockedManifestPath, "utf8"));
  assert.equal(lockedManifest.branch, "Production");
  assert.equal(
    lockedManifest.branch_source,
    `env:${ROOT_ENTRYPOINT_BRANCH_LOCK_ENV}`,
    "nested startup must preserve the authoritative root branch instead of overwriting it with stale main metadata"
  );
  assert.equal(lockedManifest.commit_sha, commitSha);

  const explicitResult = generateDeploymentManifest({
    env: {
      [ROOT_ENTRYPOINT_BRANCH_LOCK_ENV]: "main",
      DEPLOYMENT_BRANCH: "main",
      DEPLOYMENT_COMMIT_SHA: commitSha,
    },
    argv: ["--branch=Production"],
    outputPath: explicitManifestPath,
    deployedAt: "2026-08-03T08:52:08.000Z",
  });
  assert.equal(explicitResult.ok, true);
  const explicitManifest = JSON.parse(readFileSync(explicitManifestPath, "utf8"));
  assert.equal(explicitManifest.branch, "Production");
  assert.equal(explicitManifest.branch_source, "arg:--branch");
} finally {
  rmSync(dir, { recursive: true, force: true });
}

assert.doesNotThrow(() => assertNoSecretBearingFields({
  secrets_included: false,
  secrets_returned_to_agent: false,
  nested: {
    secret_value_included: false,
    raw_secret_values_included: false,
  },
}));
assert.throws(
  () => assertNoSecretBearingFields({ secrets_returned_to_agent: true }),
  /Capability envelope refuses sensitive field/,
  "positive secret metadata must remain blocked"
);
assert.throws(
  () => assertNoSecretBearingFields({ api_key: "not-allowed" }),
  /Capability envelope refuses sensitive field/,
  "secret-bearing values must remain blocked"
);

const redactedEnvelope = redactDangerousKeys({
  secrets_included: false,
  secrets_returned_to_agent: false,
  nested: {
    secret_value_included: false,
    raw_secret_values_included: false,
    api_key: "not-allowed",
    token: "not-allowed",
    secrets_returned_to_agent: true,
  },
});
assert.equal(redactedEnvelope.secrets_included, false);
assert.equal(redactedEnvelope.secrets_returned_to_agent, false);
assert.equal(redactedEnvelope.nested.secret_value_included, false);
assert.equal(redactedEnvelope.nested.raw_secret_values_included, false);
assert.equal(redactedEnvelope.nested.api_key, "[redacted_by_capability_envelope_ledger]");
assert.equal(redactedEnvelope.nested.token, "[redacted_by_capability_envelope_ledger]");
assert.equal(redactedEnvelope.nested.secrets_returned_to_agent, "[redacted_by_capability_envelope_ledger]");

console.log("root cause activation runtime repair tests passed");
