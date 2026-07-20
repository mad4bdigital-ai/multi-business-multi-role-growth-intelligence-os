import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const routeSource = readFileSync(new URL("./routes/credentialRoutes.js", import.meta.url), "utf8");
const serviceSource = readFileSync(new URL("./services/platformSecretPromotionService.js", import.meta.url), "utf8");
const routeStart = routeSource.indexOf('router.post("/credentials/intake/promote-platform-secrets"');
const routeEnd = routeSource.indexOf('router.post("/credentials/intake/promote-local-connector-key"', routeStart);
const promotionBlock = routeSource.slice(routeStart, routeEnd);

assert(routeStart >= 0, "dynamic platform secret promotion route must exist");
assert(promotionBlock.includes("normalizePromotionMappings"), "promotion must normalize request and metadata mappings");
assert(promotionBlock.includes("connectionMetadata.platform_secret_mappings"), "promotion must support mappings stored on the encrypted connection metadata");
assert(promotionBlock.includes("requestedMappings.length ? requestedMappings : metadataMappings"), "request mappings must override metadata mappings");
assert(promotionBlock.includes("available_credential_fields: safeCredentialFieldNames(credentials)"), "mapping failures may return safe field names only");
assert(promotionBlock.includes("credentialValueToSecretString"), "dynamic scalar and structured credential values must be normalized before promotion");
assert(promotionBlock.includes("promoteCredentialIntakePlatformSecrets"), "dynamic promotion must use the shared atomic service");
assert(promotionBlock.includes("createMissingReference: true"), "manual dynamic promotion must explicitly opt into reference creation");
assert(!promotionBlock.includes('connection.auth_type !== "ssh_key_pair"'), "promotion must not hard-code one auth type");
assert(!promotionBlock.includes("INSERT INTO platform_secrets"), "dynamic route must not duplicate storage SQL");
assert(!promotionBlock.includes("INSERT INTO secret_references"), "dynamic route must not create references outside the service");
assert(promotionBlock.includes("secrets_included: false"), "dynamic promotion must never return secret values");

assert(serviceSource.includes("referenceTenantId || session?.tenant_id"), "shared service must deterministically scope newly created references");
assert(serviceSource.includes("createdReferenceCount"), "shared service must expose non-secret reference creation evidence");
assert(serviceSource.includes("metadataSource"), "shared service must preserve monitoring source identity");
assert(serviceSource.includes("auditAction"), "shared service must support route-specific governed audit actions");
assert(serviceSource.includes("invariant_readback_passed: true"), "audit evidence must confirm invariant readback");

console.log("dynamic platform secret promotion tests passed");
