import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const authRoutes = readFileSync("routes/authRoutes.js", "utf8");

assert(authRoutes.includes('router.post("/platform-jwt/issue"'), "platform JWT issue route must exist");
assert(authRoutes.includes('purpose: "tenant_gpt_access"'), "platform JWT issue must mint tenant-compatible access tokens");
assert(authRoutes.includes('resource = TENANT_GPT_CORE_RESOURCE'), "platform JWT issue must default to the Core protected resource");
assert(authRoutes.includes('const normalizedResource = normalizeTenantGptOAuthResource(resource);'), "platform JWT issue must validate the requested protected resource");
assert(authRoutes.includes('aud: normalizedResource'), "platform JWT issue must use a single protected-resource audience");
assert(authRoutes.includes('azp: TENANT_GPT_OAUTH_CLIENT_ID'), "platform JWT issue must identify the authorized OAuth client");
assert(authRoutes.includes('resource: normalizedResource'), "platform JWT issue must include the protected resource claim");
assert(authRoutes.includes('scope: TENANT_GPT_SCOPE'), "platform JWT issue must include tenant GPT scope");
assert(authRoutes.includes('scope_links: TENANT_GPT_SCOPE_LINKS'), "platform JWT issue must include tenant GPT scope links");
assert(authRoutes.includes('client_id: TENANT_GPT_OAUTH_CLIENT_ID'), "platform JWT issue must include canonical tenant GPT client id");
assert(!authRoutes.match(/purpose:\s*"platform_jwt_client"/), "platform JWT issue must not mint incompatible platform_jwt_client tokens");
assert(authRoutes.includes('reason: cleanText(reason, 120)'), "platform JWT issue should keep a bounded audit reason");

console.log("Platform JWT tenant compatibility guard passed");
