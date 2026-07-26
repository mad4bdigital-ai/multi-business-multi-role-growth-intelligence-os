import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const evidenceModule = readFileSync("resourceRecipeApplyEvidence.js", "utf8");
const systemLayerRoutes = readFileSync("routes/systemLayerRoutes.js", "utf8");

for (const expected of [
  "writeResourceRecipeApplyEvidence",
  "writeExecutionEvidence",
  "audit_payload_evidence",
  "execution_log",
  "resource_recipe_apply",
  "resource_recipe_apply_readback",
  "resource_recipe_apply_audit_v1",
  "system_layer_resource_recipe",
  "typed_confirmation_sha256",
  "manifest_content_sha256",
  "graph_write_made",
  "file_content_returned",
  "secrets_included: false",
  "assertNoSecretKeys",
  "resource_recipe_apply_evidence_secret_key_rejected",
]) {
  assert(evidenceModule.includes(expected), `resource recipe evidence module must include ${expected}`);
}

for (const expected of [
  "writeResourceRecipeApplyEvidence",
  "result.audit_evidence",
  "governed_resource_run",
  "String(args?.mode || result?.mode || \"\").trim() === \"apply\"",
  "resource_recipe_apply_evidence_failed",
  "secrets_included: false",
]) {
  assert(systemLayerRoutes.includes(expected), `system layer route must include ${expected}`);
}

assert(!evidenceModule.includes("access_token"), "resource recipe evidence module must not reference access tokens");
assert(!evidenceModule.includes("refresh_token"), "resource recipe evidence module must not reference refresh tokens");
assert(!evidenceModule.includes("client_secret"), "resource recipe evidence module must not reference client secrets");
assert(!evidenceModule.includes("private_key"), "resource recipe evidence module must not reference private keys");

console.log("resource recipe apply evidence contract is wired and no-secret");
