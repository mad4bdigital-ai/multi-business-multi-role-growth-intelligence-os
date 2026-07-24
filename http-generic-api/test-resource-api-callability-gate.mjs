import assert from "node:assert/strict";
import fs from "node:fs/promises";

const routes = await fs.readFile(new URL("./routes/gptToolsRoutes.js", import.meta.url), "utf8");
const preview = await fs.readFile(new URL("./tenantConnectionOperationPreview.js", import.meta.url), "utf8");
const service = await fs.readFile(new URL("./tenantConnectionSelfRepairService.js", import.meta.url), "utf8");

assert.match(preview, /FROM user_app_connections/);
assert.doesNotMatch(preview, /credential_value|encrypted_secret|refresh_token|access_token/);
assert.match(preview, /provider_call_performed:\s*false/);
assert.match(preview, /credential_payload_read:\s*false/);

const registeredTools = [...service.matchAll(/tool_key:\s*"([^"]+)"/g)].map((match) => match[1]);
assert.equal(registeredTools.length, 9);
assert.equal(new Set(registeredTools).size, 9);
assert.match(routes, /name:\s*"tenant_connection_operation_preview"/);
assert.match(routes, /toolKey === "tenant_connection_operation_preview"/);
assert.match(routes, /buildTenantConnectionOperationPreview\(args\)/);

console.log("resource API callability gate registration tests passed");
