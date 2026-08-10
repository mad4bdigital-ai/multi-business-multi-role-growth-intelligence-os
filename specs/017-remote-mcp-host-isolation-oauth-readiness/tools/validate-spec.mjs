import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const specRoot = normalize(join(dirname(fileURLToPath(import.meta.url)), ".."));

async function readText(relativePath) {
  return readFile(join(specRoot, relativePath), "utf8");
}

async function readJson(relativePath) {
  return JSON.parse(await readText(relativePath));
}

const manifest = await readJson("manifest.json");
const completion = await readJson("completion.json");
const e2e = await readJson("e2e-phases.json");
const workMap = await readJson("work-map-integration.json");

assert.equal(manifest.spec_key, "017-remote-mcp-host-isolation-oauth-readiness");
assert.equal(manifest.specification_only, true);
assert.equal(manifest.delivery_mode, "multi_pr");
assert.equal(manifest.status, "specification_draft_review_pending");
assert.equal(manifest.boundaries.secrets_included, false);
assert.equal(manifest.file_count, manifest.files.length);
assert.equal(new Set(manifest.files).size, manifest.files.length);

for (const relativePath of manifest.files) {
  assert(!relativePath.startsWith("/"), `Manifest path must be relative: ${relativePath}`);
  assert(!relativePath.split("/").includes(".."), `Manifest path escapes spec root: ${relativePath}`);
  const fileStat = await stat(join(specRoot, relativePath));
  assert(fileStat.isFile(), `Manifest entry is not a file: ${relativePath}`);
}

for (const requiredPath of [
  "spec.md",
  "plan.md",
  "tasks.md",
  "completion.json",
  "e2e-phases.json",
  "work-map-integration.json",
  "checklists/requirements.md",
  "implementation-handoff.md",
  "tools/validate-spec.mjs",
]) {
  assert(manifest.files.includes(requiredPath), `Required artifact is missing from manifest: ${requiredPath}`);
}

for (const relativePath of manifest.files.filter((path) => path.endsWith(".json"))) {
  await readJson(relativePath);
}

assert.deepEqual(manifest.canonical_topology, {
  resource: "https://mcp.mad4b.com",
  endpoint: "https://mcp.mad4b.com/mcp",
  issuer: "https://auth.mad4b.com/auth/mcp",
  authorization_endpoint: "https://auth.mad4b.com/auth/mcp/oauth/authorize",
  token_endpoint: "https://auth.mad4b.com/auth/mcp/oauth/token",
  registration_endpoint: "https://auth.mad4b.com/auth/mcp/oauth/register",
  revocation_endpoint: "https://auth.mad4b.com/auth/mcp/oauth/revoke",
});
assert.equal(manifest.target_surface.resource_host_must_be_canonical, true);
assert.equal(manifest.target_surface.wrong_host_fails_closed, true);
assert.equal(manifest.target_surface.oauth_metadata_cross_resource_fallback_forbidden, true);
assert.equal(manifest.target_surface.trusted_proxy_host_resolution_required, true);
assert.equal(manifest.target_surface.admin_no_secret_readiness_required, true);
assert.equal(manifest.target_surface.dcr_is_separately_gated, true);
assert.equal(manifest.target_surface.live_readiness_is_not_source_readiness, true);

for (const [key, value] of Object.entries(manifest.boundaries)) {
  if (key === "secrets_included") assert.equal(value, false);
  else assert.equal(value, false, `Spec branch boundary must remain false: ${key}`);
}

assert.equal(completion.feature_key, manifest.spec_key);
assert.equal(completion.delivery_mode, "multi_pr");
assert.equal(completion.status, "in_progress");
assert.equal(completion.specification.complete, true);
assert.equal(completion.specification.review_state, "merged");
assert.equal(completion.boundaries.this_spec_branch_authorizes_runtime_mutation, false);
assert.equal(completion.boundaries.this_spec_branch_authorizes_migration_apply, false);
assert.equal(completion.boundaries.this_spec_branch_authorizes_secret_access, false);
assert.equal(completion.boundaries.this_spec_branch_authorizes_provider_mutation, false);
assert.equal(completion.boundaries.this_spec_branch_authorizes_feature_activation, false);
assert.equal(completion.boundaries.this_spec_branch_authorizes_client_registration, false);
assert.equal(completion.boundaries.this_spec_branch_authorizes_production_promotion, false);
assert.equal(completion.boundaries.force_push, false);

assert.equal(workMap.feature_key, manifest.spec_key);
assert.equal(workMap.review_state, "ready_for_implementation");
assert.equal(workMap.registry.map_count, 19);
assert.equal(workMap.registry.domain_count, 16);
assert.equal(workMap.registry.uncategorized_count, 0);
assert.equal(workMap.registry.taxonomy_gap_cluster_count, 0);
assert.deepEqual(workMap.dimension_discovery.unresolved, []);
assert.equal(workMap.implementation_readiness.status, "ready");
assert.deepEqual(workMap.implementation_readiness.blocking_dimensions, []);
assert.equal(workMap.implementation_readiness.reviewed_by, "platform-team");
assert.equal(workMap.secrets_included, false);

assert.equal(e2e.$schema, "../../.specify/schemas/e2e-phases.schema.json");
assert.equal(e2e.feature_key, manifest.spec_key);
assert.equal(e2e.delivery_mode, "multi_pr");
assert.equal(e2e.merge_contract?.minimum_phase, "mvp");
assert.equal(e2e.current_phase, "mvp");
const mvp = e2e.phases.find((phase) => phase.id === "mvp");
assert.equal(mvp?.status, "implemented");
const journey = mvp?.e2e_journeys?.find((row) => row.id === "remote-mcp-host-isolation-spec-to-implementation-handoff");
assert(journey, "Spec 017 MVP journey must exist");
assert(journey.tests?.some((test) => test.id === "spec-017-contract-validator"), "Spec 017 MVP journey must execute the canonical validator");

const forbiddenSecretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  /\bsk-[A-Za-z0-9_-]{20,}\b/u,
  /\bgh[opusr]_[A-Za-z0-9]{30,}\b/u,
  /\b(?:access_token|refresh_token|client_secret|backend_api_key)\s*[:=]\s*["']?[A-Za-z0-9._~-]{16,}/iu,
];

for (const relativePath of manifest.files) {
  const text = await readText(relativePath);
  for (const pattern of forbiddenSecretPatterns) {
    assert(!pattern.test(text), `Secret-like value detected in ${relativePath}`);
  }
}

console.log(JSON.stringify({
  ok: true,
  feature_key: manifest.spec_key,
  file_count: manifest.file_count,
  canonical_resource: manifest.canonical_topology.resource,
  canonical_issuer: manifest.canonical_topology.issuer,
  current_phase: e2e.current_phase,
  minimum_merge_phase: e2e.merge_contract.minimum_phase,
  implementation_authorized: false,
  live_mutation_authorized: false,
  secrets_included: false,
}));