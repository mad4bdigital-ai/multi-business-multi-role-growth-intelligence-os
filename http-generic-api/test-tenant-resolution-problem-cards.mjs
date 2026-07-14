import assert from "node:assert/strict";
import fs from "node:fs";

const serviceSource = fs.readFileSync(new URL("./tenantResolutionProjectionService.js", import.meta.url), "utf8");
const routeSource = fs.readFileSync(new URL("./routes/activationAwarenessRoutes.js", import.meta.url), "utf8");
const openapiSource = fs.readFileSync(new URL("./openapi/openapi.tenant-gpt.activation.yaml", import.meta.url), "utf8");

for (const token of [
  "readTenantResolutionProblemCards",
  "tenant_resolution_problem_cards",
  "tenant_scoped_operational_alerts_projection",
  "wordpress_site_doctor_v1",
  "tenant_skill_approval_decision_v1",
  "task_source_repair_v1",
  "google_ads_setup_preflight_v1",
  "connector_health_repair_v1",
  "case_creation_deferred_to_next_child_pr: true",
  "provider_call_allowed: false",
  "apply_enabled: false",
  "secrets_included: false",
]) {
  assert.ok(serviceSource.includes(token), `service must include ${token}`);
}

for (const token of [
  "readTenantResolutionProblemCards",
  "tenantProblemCardsResponse",
  "/tenant/resolution/problem-cards",
  "tenant_resolution_problem_cards_read_failed",
]) {
  assert.ok(routeSource.includes(token), `route must include ${token}`);
}

for (const token of [
  "/tenant/resolution/problem-cards:",
  "operationId: readTenantResolutionProblemCards",
  "x-openai-isConsequential: false",
  "TenantResolutionProblemCard",
  "TenantResolutionProblemCardsResponse",
  "tenant_resolution_problem_cards",
  "tenant_scoped_operational_alerts_projection",
]) {
  assert.ok(openapiSource.includes(token), `OpenAPI must include ${token}`);
}

for (const forbidden of [
  "provider_call_allowed: true",
  "apply_enabled: true",
  "child_process",
  "fetch(",
  "axios",
]) {
  assert.ok(!serviceSource.includes(forbidden), `service must not include ${forbidden}`);
}

console.log("tenant resolution problem card projection contract passed");
