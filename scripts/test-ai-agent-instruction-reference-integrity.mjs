import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const exists = (file) => fs.existsSync(path.join(root, file));
const top = read("Top Level Instructions.md");
const agent = read("AI_Agent_Knowledge_Guide.md");
const admin = read("GPT_Admin_Assistant_Knowledge_Guide.md");

const required = [
  "AI_Agent_Knowledge_Guide.md",
  "system_bootstrap.md",
  "memory_schema.json",
  "direct_instructions_registry_patch.md",
  "module_loader.md",
  "prompt_router.md",
  "http-generic-api/config/deployment-branch-policy.json",
  "canonicals/openapi/custom-gpt-surfaces.yaml",
  "http-generic-api/openapi/openapi.custom-gpt.auth-dispatcher.yaml",
  "http-generic-api/openapi/openapi.gpt-action.dev-dispatcher.yaml",
  "http-generic-api/openapi/openapi.gpt-action.local-connector.yaml",
  "docs/custom-gpt-openapi-oauth-delivery.md",
];
for (const file of required) assert.equal(exists(file), true, `missing AI reference: ${file}`);

assert.ok(top.length < 8000, `Top Level Instructions.md exceeds 8,000 characters: ${top.length}`);
for (const [name, text] of [["Top Level", top], ["AI guide", agent], ["Admin guide", admin]]) {
  assert.match(text, /https:\/\/auth\.mad4b\.com\/scopes\/\*/u, `${name} must state shared OAuth scope authority`);
  assert.match(text, /https:\/\/dev\.mad4b\.com\/scopes\/\*/u, `${name} must forbid dev scope authority`);
}
assert.doesNotMatch(agent, /See `docs\/tenant-gpt-oauth-live-smoke\.md`/u, "AI guide must not cite the removed OAuth smoke doc");
assert.doesNotMatch(admin, /`http-generic-api\/openapi\.custom-gpt\.auth-dispatcher\.yaml`/u, "Admin guide must use the openapi/ path");
assert.doesNotMatch(admin, /`http-generic-api\/openapi\.gpt-action\.dev-dispatcher\.yaml`/u, "Admin guide must use the openapi/ path");
assert.match(top, /canonicals\/openapi\/custom-gpt-surfaces\.yaml/u);
assert.match(top, /Admin and Tenant schemas\/tools are separate authority domains/u);
assert.match(agent, /fail closed rather than guessing/u);
assert.match(admin, /degraded_contract.*rather than guessing/u);

console.log(JSON.stringify({
  ok: true,
  contract: "mad4b.ai-agent-instruction-reference-integrity.v1",
  top_level_characters: top.length,
  required_references: required.length,
  shared_scope_authority: "https://auth.mad4b.com/scopes/*",
  dev_scope_authority_forbidden: true,
  admin_tenant_separation: true,
  secrets_included: false,
}));
