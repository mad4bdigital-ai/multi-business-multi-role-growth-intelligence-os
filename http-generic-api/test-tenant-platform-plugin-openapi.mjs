import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const schema = readFileSync("openapi.tenant-gpt.auth.yaml", "utf8");
const mainSchema = readFileSync("openapi.yaml", "utf8");

assert(schema.includes("2.0.2-platform-plugins"), "Tenant GPT schema version must mention platform plugins");
assert(schema.includes("operationId: tenantPlatformPluginCatalog"), "tenant catalog operation must be exposed");
assert(schema.includes("operationId: tenantPlatformPluginInstall"), "tenant install operation must be exposed");
assert(schema.includes("operationId: tenantPlatformPluginResolve"), "tenant resolve operation must be exposed");
assert(schema.includes("operationId: tenantPlatformPluginCredentialIntakeSessionCreate"), "tenant-safe credential intake operation must be exposed");
assert(schema.includes("/tenant/platform/plugins/catalog"), "tenant catalog path must be present");
assert(schema.includes("/tenant/platform/plugins/install"), "tenant install path must be present");
assert(schema.includes("/tenant/platform/plugins/resolve"), "tenant resolve path must be present");
assert(schema.includes("/tenant/platform/plugins/credential-intake-sessions"), "tenant-safe credential intake path must be present");
assert(schema.includes("canonical_capability_id"), "tenant intake response must expose canonical capability identity");
assert(schema.includes("admin_tool_invoked"), "tenant intake response must prove raw admin tooling was not invoked");
assert(schema.includes("redirect_uri"), "tenant intake request must document the bounded redirect field");
assert(mainSchema.includes("redirect_uri"), "main OpenAPI must document the bounded redirect field");
assert(schema.includes("binding_context"), "tenant intake response must document immutable binding evidence");
assert(schema.includes("authority_snapshot_version"), "tenant intake response must document authority snapshot evidence");
assert(schema.includes("Unknown fields, credentials, custom schemas, arbitrary metadata, tenant_id, and user_id are rejected"), "tenant intake must document strict identity and field isolation");
assert(schema.includes("x-openai-isConsequential: true"), "tenant install and intake writes must be marked consequential");
assert(schema.includes("Tenant/user IDs come from auth"), "schema must document auth-derived tenant/user context");
assert(schema.includes("Do not include secrets"), "schema must document no-secret connection metadata");

console.log("tenant platform plugin OpenAPI tests passed");
