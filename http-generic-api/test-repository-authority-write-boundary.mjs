import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createRepositoryAuthorityCheckedFetch,
  REPOSITORY_PATCH_MUTATION_INTENTS,
} from "./githubRepositoryLifecycle.js";

const SHA = "a".repeat(40);
const BRANCH = "fix/authority-write-boundary";
const REPO_URI = "github://mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os";

function envelopeRow(operationIntent = "repo_patch_apply", capabilityKey = "repo_patch_apply") {
  return {
    envelope_id: "envelope-write-boundary",
    tenant_id: "tenant-1",
    user_id: "platform_admin_service",
    workspace_id: "workspace-1",
    workspace_key: "workspace-key",
    brand_key: null,
    app_key: "github",
    capability_key: capabilityKey,
    operation_intent: operationIntent,
    risk_class: "high",
    selected_source_tier: "platform_managed_fallback",
    selected_runtime_surface: "repo_patch_batch_apply",
    authority_status: "passed",
    decision: "ready_for_dispatch",
    envelope_status: "ready_for_dispatch",
    dispatch_allowed: 1,
    apply_allowed: 0,
    approval_required: 0,
    quota_required: 1,
    audit_required: 1,
    readback_required: 1,
    blocking_gap_count: 0,
    execution_status: "referenced",
    expires_at: "2099-01-01T00:00:00.000Z",
    secrets_included: 0,
    envelope_sha256: "d".repeat(64),
    envelope_json: JSON.stringify({
      request_context: {
        resource_type: "github_repo",
        resource_uri: REPO_URI,
        resource_branch: BRANCH,
        expected_commit_sha: SHA,
        recipe_key: "repo_patch_batch_apply",
        operation_mode: "atomic_change_set",
        principal: { principal_type: "service", principal_id: "platform_admin_service" },
      },
      authority: {
        exact_platform_resource_authority_scope: {
          matched: true,
          binding_id: "binding-write-boundary",
          resource_branch: BRANCH,
          expected_commit_sha: SHA,
          secrets_included: false,
        },
      },
    }),
  };
}

function binding(status = "active") {
  return {
    binding_id: "binding-write-boundary",
    tenant_id: "tenant-1",
    workspace_id: "workspace-1",
    user_id: "platform_admin_service",
    resource_type: "github_repo",
    resource_uri: REPO_URI,
    resource_ref_json: JSON.stringify({
      branch: BRANCH,
      expected_commit_sha: SHA,
      principal: { principal_type: "service", principal_id: "platform_admin_service" },
    }),
    recipe_key: "repo_patch_batch_apply",
    permission_level: "patch",
    allowed_modes_json: JSON.stringify(["atomic_change_set"]),
    authority_source: "test",
    status,
    expires_at: null,
    created_at: "2026-08-08T00:00:00.000Z",
  };
}

function boundaryHarness(initialStatus = "active", operationIntent = "repo_patch_apply", capabilityKey = "repo_patch_apply") {
  let liveBinding = binding(initialStatus);
  let envelopeReads = 0;
  let bindingReads = 0;
  const providerCalls = [];
  const pool = {
    async query(sql, params) {
      const statement = String(sql);
      if (/capability_resolution_envelope_ledger/.test(statement)) {
        envelopeReads += 1;
        assert.deepEqual(params, ["envelope-write-boundary"]);
        return [[envelopeRow(operationIntent, capabilityKey)]];
      }
      if (/FROM platform_resource_authority_bindings/.test(statement)) {
        bindingReads += 1;
        assert.deepEqual(params, ["binding-write-boundary"]);
        return [[liveBinding]];
      }
      throw new Error(`Unexpected SQL: ${statement.slice(0, 120)}`);
    },
  };
  const fetchImpl = async (url, init = {}) => {
    providerCalls.push({ url: String(url), method: String(init.method || "GET").toUpperCase() });
    return { ok: true, status: 200, async json() { return {}; } };
  };
  const checkedFetch = createRepositoryAuthorityCheckedFetch({
    pool,
    fetchImpl,
    capability_envelope_id: "envelope-write-boundary",
    branch: BRANCH,
    expected_base_sha: SHA,
  });
  return {
    checkedFetch,
    providerCalls,
    revoke() { liveBinding = binding("revoked"); },
    counts() { return { envelopeReads, bindingReads }; },
  };
}

{
  const harness = boundaryHarness("active");
  await harness.checkedFetch(
    "https://api.github.com/repos/mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os/git/commits/" + SHA,
    { method: "GET" },
  );
  assert.deepEqual(harness.counts(), { envelopeReads: 0, bindingReads: 0 }, "read-only preparation must not consume a write-boundary authority check");

  await harness.checkedFetch(
    "https://api.github.com/repos/mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os/git/blobs",
    { method: "POST", body: "{}" },
  );
  assert.deepEqual(harness.counts(), { envelopeReads: 1, bindingReads: 1 });

  await harness.checkedFetch(
    "https://api.github.com/repos/mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os/git/trees",
    { method: "POST", body: "{}" },
  );
  assert.deepEqual(harness.counts(), { envelopeReads: 1, bindingReads: 1 }, "non-ref provider writes may reuse the first immediate boundary check");

  harness.revoke();
  await assert.rejects(
    () => harness.checkedFetch(
      "https://api.github.com/repos/mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os/git/refs/heads/" + encodeURIComponent(BRANCH),
      { method: "PATCH", body: "{}" },
    ),
    (error) => error.code === "capability_resolution_envelope_resource_authority_binding_inactive"
      && error.details?.write_boundary_phase === "pre_ref_update",
  );
  assert.deepEqual(harness.counts(), { envelopeReads: 2, bindingReads: 2 });
  assert.equal(harness.providerCalls.filter((call) => call.method === "PATCH").length, 0, "revoked authority must block the final ref mutation before transport");
}

{
  const harness = boundaryHarness("revoked");
  await assert.rejects(
    () => harness.checkedFetch(
      "https://api.github.com/repos/mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os/git/trees",
      { method: "POST", body: "{}" },
    ),
    (error) => error.code === "capability_resolution_envelope_resource_authority_binding_inactive"
      && error.details?.write_boundary_phase === "pre_first_provider_write",
  );
  assert.equal(harness.providerCalls.length, 0, "revoked authority before the first write must yield zero provider mutations");
}

{
  const harness = boundaryHarness("active");
  await harness.checkedFetch(
    "https://api.github.com/repos/mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os/git/trees",
    { method: "POST", body: "{}" },
  );
  harness.revoke();
  await assert.rejects(
    () => harness.checkedFetch(
      "https://api.github.com/repos/mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os/git/refs",
      { method: "POST", body: "{}" },
    ),
    (error) => error.code === "capability_resolution_envelope_resource_authority_binding_inactive"
      && error.details?.write_boundary_phase === "pre_ref_update",
  );
  assert.equal(harness.providerCalls.filter((call) => call.url.endsWith("/git/refs")).length, 0, "new-branch ref creation must also revalidate at the final boundary");
}

for (const intent of REPOSITORY_PATCH_MUTATION_INTENTS) {
  const harness = boundaryHarness("active", intent);
  await harness.checkedFetch(
    "https://api.github.com/repos/mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os/git/trees",
    { method: "POST", body: "{}" },
  );
  assert.deepEqual(harness.counts(), { envelopeReads: 1, bindingReads: 1 }, `${intent} must retain live authority revalidation at the first provider write`);
  assert.equal(harness.providerCalls.length, 1, `${intent} must remain dispatchable through the provider write boundary`);
}

{
  const harness = boundaryHarness("active", "unsupported_repo_mutation_intent");
  await assert.rejects(
    () => harness.checkedFetch(
      "https://api.github.com/repos/mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os/git/trees",
      { method: "POST", body: "{}" },
    ),
    (error) => error.code === "capability_resolution_envelope_intent_mismatch"
      && error.details?.write_boundary_phase === "pre_first_provider_write",
  );
  assert.equal(harness.providerCalls.length, 0, "unsupported repository mutation intents must fail before provider transport");
}

{
  const harness = boundaryHarness("active", "repo_patch_apply", "different_capability");
  await assert.rejects(
    () => harness.checkedFetch(
      "https://api.github.com/repos/mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os/git/trees",
      { method: "POST", body: "{}" },
    ),
    (error) => error.code === "capability_resolution_envelope_capability_mismatch"
      && error.details?.write_boundary_phase === "pre_first_provider_write",
  );
  assert.equal(harness.providerCalls.length, 0, "unsupported capability keys must fail before provider transport");
}

const publicLifecycle = readFileSync(new URL("./githubRepositoryLifecycle.js", import.meta.url), "utf8");
const routes = readFileSync(new URL("./routes/gptToolsRoutes.js", import.meta.url), "utf8");
const policyMigration = readFileSync(new URL("./migrations/234_sprint67_repo_patch_capability_envelope_requirement.sql", import.meta.url), "utf8");
assert.match(publicLifecycle, /createRepositoryAuthorityCheckedFetch/);
assert.match(publicLifecycle, /pre_first_provider_write/);
assert.match(publicLifecycle, /pre_ref_update/);
assert.match(publicLifecycle, /resolveCapabilityExecutionEnvelope/);
assert.match(publicLifecycle, /acceptedCapabilityKeys:\s*\["repo_patch_apply"\]/);
assert.match(routes, /from "\.\.\/githubRepositoryLifecycle\.js"/);
assert.doesNotMatch(routes, /githubRepositoryLifecycleCore\.js/, "runtime routes must not bypass the authority-checked public lifecycle module");

const configuredIntentMatch = policyMigration.match(/'accepted_intents',JSON_ARRAY\(([^)]+)\)/);
assert.ok(configuredIntentMatch, "repo patch envelope policy must declare accepted_intents");
const configuredIntents = Array.from(configuredIntentMatch[1].matchAll(/'([^']+)'/g), (match) => match[1]);
assert.deepEqual(
  [...REPOSITORY_PATCH_MUTATION_INTENTS],
  configuredIntents,
  "provider write-boundary accepted intents must match the repository patch envelope policy contract",
);

const repoPatchGuardStart = routes.indexOf("async function requireRepoPatchCapabilityEnvelope");
const repoPatchGuardEnd = routes.indexOf("\nasync function ", repoPatchGuardStart + 1);
assert.ok(repoPatchGuardStart >= 0 && repoPatchGuardEnd > repoPatchGuardStart, "repo patch route envelope guard must remain discoverable");
const repoPatchGuardSource = routes.slice(repoPatchGuardStart, repoPatchGuardEnd);
for (const intent of REPOSITORY_PATCH_MUTATION_INTENTS) {
  assert.ok(repoPatchGuardSource.includes(`"${intent}"`), `repo patch route guard must preserve configured intent ${intent}`);
}

console.log("Repository authority write-boundary regression passed");
