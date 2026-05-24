import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Guards both platform credential bridge and local env fallback paths.
const proxySource = readFileSync("routes/connectorProxyRoutes.js", "utf8");
const connectorSource = readFileSync("../local-connector/server.mjs", "utf8");

assert(proxySource.includes("resolveEffectiveCredential"), "auth-host connector proxy must use the credential resolver");
assert(proxySource.includes("decryptCredentials"), "auth-host connector proxy must read encrypted n8n base URL metadata safely");
assert(proxySource.includes("loadPreferredN8nApiConnection"), "auth-host connector proxy must load the preferred n8n API connection");
assert(proxySource.includes("credentialRole: \"n8n_api_key\""), "auth-host connector proxy must resolve n8n_api_key credentials");
assert(proxySource.includes("includeSecret: true"), "auth-host connector proxy must resolve the secret only server-side");
assert(proxySource.includes("_platform_n8n_api_key"), "auth-host connector proxy must pass a request-scoped n8n API key to the connector");
assert(proxySource.includes("delete forwardedBody.user_id") && proxySource.includes("delete forwardedBody.tenant_id"), "auth-host connector proxy must not forward identity fields to the device");

assert(connectorSource.includes("N8N_LOCAL_BASE"), "local connector must support a local n8n base URL separate from public N8N_BASE_URL");
assert(connectorSource.includes("requestN8nApiKey") && connectorSource.includes("effectiveN8nApiKey"), "local connector must support request-scoped n8n API key bridge");
assert(connectorSource.includes("requestLocalBase") && connectorSource.includes("effectiveN8nBase"), "local connector must prefer local base URL for device execution");
assert(connectorSource.includes("N8N_API_HTTP_ERROR"), "local connector must return structured n8n API errors");
assert(connectorSource.includes("secrets_included: false"), "local connector n8n API error responses must not include secrets");

console.log("n8n credential bridge tests passed");
