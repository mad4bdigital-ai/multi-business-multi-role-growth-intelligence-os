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

assert.equal(manifest.spec_key, "016-chatgpt-plugin-mcp-integration");
assert.equal(manifest.specification_only, true);
assert.equal(manifest.delivery_mode, "multi_pr");
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
  "checklists/security.md",
  "checklists/release-readiness.md",
  "contracts/chatgpt-plugin-mcp.openapi.yaml",
  "contracts/mcp-tool.schema.json",
  "contracts/oauth-protected-resource.schema.json",
  "contracts/plugin-package.schema.json",
  "tools/validate-spec.mjs",
]) {
  assert(manifest.files.includes(requiredPath), `Required artifact is missing from manifest: ${requiredPath}`);
}

for (const relativePath of manifest.files.filter((path) => path.endsWith(".json"))) {
  await readJson(relativePath);
}

const openApi = await readText("contracts/chatgpt-plugin-mcp.openapi.yaml");
assert.match(openApi, /^openapi:\s*3\.1\.0\s*$/mu);
assert.match(openApi, /^\s*\/mcp:\s*$/mu);
assert.match(openApi, /^\s*\/\.well-known\/oauth-protected-resource:\s*$/mu);

assert.equal(completion.feature_key, manifest.spec_key);
assert.equal(completion.delivery_mode, "multi_pr");
assert.equal(completion.status, "in_progress");
assert.equal(completion.specification.file_count_expected, manifest.file_count);
assert.equal(completion.specification.file_count_recorded, manifest.file_count);
assert.equal(completion.secrets_included, false);
assert.equal(completion.implementation.production_deployed, false);
assert.equal(completion.implementation.published, false);

assert.equal(e2e.$schema, "../../.specify/schemas/e2e-phases.schema.json");
assert.equal(e2e.feature_key, manifest.spec_key);
assert.equal(e2e.delivery_mode, "multi_pr");
assert.equal(e2e.current_phase, "mvp");
assert(e2e.phases.some((phase) => phase.id === "mvp" && phase.status === "implemented"));

assert.equal(workMap.feature_key, manifest.spec_key);
assert.equal(workMap.review_state, "draft");
assert.equal(workMap.registry.uncategorized_count, 0);
assert.equal(workMap.registry.taxonomy_gap_cluster_count, 0);
assert.equal(workMap.implementation_readiness.status, "blocked");
assert.equal(workMap.secrets_included, false);

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
  json_contracts_validated: manifest.files.filter((path) => path.endsWith(".json")).length,
  openapi_contract_present: true,
  implementation_authorized: false,
  secrets_included: false,
}));
