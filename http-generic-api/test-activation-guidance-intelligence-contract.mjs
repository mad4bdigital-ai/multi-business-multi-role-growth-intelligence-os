import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
async function read(relativePath) {
  return fs.readFile(path.join(root, relativePath), "utf8");
}

const [service, routes, routeIndex, openapi, migration] = await Promise.all([
  read("activationGuidanceService.js"),
  read("routes/activationGuidanceRoutes.js"),
  read("routes/index.js"),
  read("openapi.yaml"),
  read("migrations/308_sprint69_activation_guidance_intelligence.sql"),
]);

assert.match(routeIndex, /buildActivationGuidanceRoutes/, "activation guidance routes must be mounted");
assert.match(routes, /\/tenant\/activation\/guidance/, "tenant activation guidance endpoint must exist");
assert.match(routes, /\/admin\/activation\/guidance/, "admin activation guidance endpoint must exist");
assert.match(routes, /requireTenantUserJwt/, "tenant endpoint must be user-JWT scoped");
assert.match(routes, /requireAdminPrincipal/, "admin endpoint must require admin principal");

assert.match(service, /activation_guidance_intelligence/, "service must declare activation guidance layer");
assert.match(service, /recommended_next_actions/, "service must generate next-best actions");
assert.match(service, /assistant_instruction_pack/, "service must return instruction pack");
assert.match(service, /لا تكتفِ بإعلان أن التفعيل active أو healthy/, "instruction pack must force proactive guidance");
assert.match(service, /workspace_brand_platform_management/, "admin guidance must include workspace and brand management mode");
assert.match(service, /tenant_user_workspace_guidance/, "tenant guidance must include tenant workspace guidance mode");
assert.match(service, /raw_binding_is_not_allowed_capability/, "service must prevent raw binding semantics from becoming user-facing capability semantics");
assert.match(service, /connected/, "service must include readiness dimensions");
assert.match(service, /skill_granted/, "service must include skill readiness semantics");
assert.match(service, /smoke_certified/, "service must include smoke certification readiness semantics");
assert.match(service, /can_execute/, "service must include execution readiness semantics");
assert.match(service, /SENSITIVE_KEY_PATTERN/, "service must strip sensitive keys");
assert.match(service, /secrets_included: false/, "service must explicitly declare no secrets");

assert.match(openapi, /operationId: getTenantActivationGuidance/, "OpenAPI must document tenant guidance endpoint");
assert.match(openapi, /operationId: getAdminActivationGuidance/, "OpenAPI must document admin guidance endpoint");
assert.match(openapi, /ActivationGuidanceResponse/, "OpenAPI must include activation guidance schema");

assert.match(migration, /tenant_activation_guidance_read_api/, "migration must seed tenant guidance tool");
assert.match(migration, /admin_activation_guidance_read_api/, "migration must seed admin guidance tool");
assert.match(migration, /tenant_activation_guidance/, "migration must seed tenant operational tile");
assert.match(migration, /admin_activation_guidance/, "migration must seed admin operational tile");
assert.match(migration, /proactive_guidance/, "registry seed must mark guidance as proactive");
assert.doesNotMatch(migration, /POST \/tenant\/activation\/guidance/, "tenant guidance must not be mutating");
assert.doesNotMatch(migration, /connector_secret|raw_token|private_key|password\s*=/i, "migration must not seed raw secret material");

console.log("activation guidance intelligence contract tests passed");
