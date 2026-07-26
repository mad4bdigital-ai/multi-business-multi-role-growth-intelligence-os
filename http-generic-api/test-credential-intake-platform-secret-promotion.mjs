import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const routeSource = readFileSync(new URL("./routes/credentialRoutes.js", import.meta.url), "utf8");
const serviceSource = readFileSync(new URL("./services/platformSecretPromotionService.js", import.meta.url), "utf8");
const routeStart = routeSource.indexOf('router.post("/credentials/intake/promote-platform-secrets"');
const routeEnd = routeSource.indexOf('router.post("/credentials/intake/promote-local-connector-key"', routeStart);
const promotionBlock = routeSource.slice(routeStart, routeEnd);

assert(routeStart >= 0, "credential routes must expose manual platform secret promotion");
assert(promotionBlock.includes("promotion_approval_required"), "manual promotion must require explicit approval and reason");
assert(promotionBlock.includes("decryptCredentials(connection.encrypted_credentials)"), "manual promotion must decrypt only the selected encrypted connection server-side");
assert(promotionBlock.includes("normalizePromotionMappings"), "manual promotion must use explicit field mappings");
assert(promotionBlock.includes("promoteCredentialIntakePlatformSecrets"), "manual promotion must delegate to the shared atomic service");
assert(promotionBlock.includes("createMissingReference: true"), "manual promotion must explicitly allow transaction-bound missing reference creation");
assert(promotionBlock.includes('metadataSource: "credential_intake_platform_secret_promotion"'), "manual promotion must preserve its monitoring source");
assert(promotionBlock.includes('auditAction: "credential_intake.platform_secrets_promoted"'), "manual promotion must emit a distinct governed audit action");
assert(promotionBlock.includes("promoted_count: promoted.length"), "manual promotion must preserve the existing response contract");
assert(promotionBlock.includes("secrets_included: false"), "manual promotion must never return raw secrets");
assert(!promotionBlock.includes("INSERT INTO platform_secrets"), "manual route must not duplicate platform secret writes");
assert(!promotionBlock.includes("UPDATE secret_references"), "manual route must not duplicate secret reference writes");
assert(!promotionBlock.includes("INSERT INTO secret_references"), "manual route must not create references outside the shared transaction");

assert(serviceSource.includes("beginTransaction"), "shared service must use a transaction");
assert(serviceSource.includes("FOR UPDATE"), "shared service must lock governed references");
assert(serviceSource.includes("createMissingReference = false"), "missing reference creation must remain opt-in");
assert(serviceSource.includes("if (!referenceRows.length && createMissingReference)"), "shared service must create missing references only when explicitly requested");
assert(serviceSource.includes("rotation_status"), "new references must enter a governed rotation state");
assert(serviceSource.includes("provisioned_pending_validation"), "new and updated references must be pending validation");
assert(serviceSource.includes("platform_secret_promotion_invariant_failed"), "shared service must enforce post-write invariants");
assert(serviceSource.includes("rollback()"), "shared service must roll back failures");
assert(serviceSource.includes("connection_id = ? AND user_id = ? AND tenant_id = ?"), "source connection update must be user and tenant scoped");

console.log("credential intake platform secret promotion tests passed");
