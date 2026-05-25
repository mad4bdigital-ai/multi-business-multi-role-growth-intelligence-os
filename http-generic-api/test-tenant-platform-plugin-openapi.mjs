import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const schema = readFileSync("openapi.tenant-gpt.auth.yaml", "utf8");

assert(schema.includes("2.0.2-platform-plugins"), "Tenant GPT schema version must mention platform plugins");
assert(schema.includes("operationId: tenantPlatformPluginCatalog"), "tenant catalog operation must be exposed");
assert(schema.includes("operationId: tenantPlatformPluginInstall"), "tenant install operation must be exposed");
assert(schema.includes("operationId: tenantPlatformPluginResolve"), "tenant resolve operation must be exposed");
assert(schema.includes("/tenant/platform/plugins/catalog"), "tenant catalog path must be present");
assert(schema.includes("/tenant/platform/plugins/install"), "tenant install path must be present");
assert(schema.includes("/tenant/platform/plugins/resolve"), "tenant resolve path must be present");
assert(schema.includes("x-openai-isConsequential: true"), "tenant install must be marked consequential");
assert(schema.includes("The server derives tenant_id and user_id"), "schema must document auth-derived tenant/user context");
assert(schema.includes("Do not include secrets"), "schema must document no-secret connection metadata");

console.log("tenant platform plugin OpenAPI tests passed");
