import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync(new URL("./routes/credentialRoutes.js", import.meta.url), "utf8");
const migration = readFileSync(new URL("./migrations/215_sprint67_dynamic_platform_secret_promotion.sql", import.meta.url), "utf8");

assert.match(route, /router\.post\("\/credentials\/intake\/promote-platform-secrets"/);
assert.match(route, /normalizePromotionMappings/);
assert.match(route, /requestedMappings\.length \? requestedMappings : metadataMappings/);
assert.match(route, /connection\.account_metadata/);
assert.match(route, /platform_secret_mappings_required/);
assert.match(route, /safeCredentialFieldNames\(credentials\)/);
assert.match(route, /credentialValueToSecretString\(credentials\[mapping\.credential_field\]\)/);
assert.match(route, /INSERT INTO secret_references/);
assert.doesNotMatch(route, /Only ssh_key_pair intake connections can be promoted/);
assert.doesNotMatch(route, /connection\.auth_type !== "ssh_key_pair"/);
assert.doesNotMatch(route, /secret_value\s*:/i);

assert.match(migration, /dynamic_platform_secret_promotion_contract_v1/);
assert.match(migration, /openrouter_api/);
assert.match(migration, /supported_auth_types/);
assert.match(migration, /api_key/);
assert.match(migration, /bearer_token/);
assert.match(migration, /ssh_key_pair/);
assert.match(migration, /remote_database/);
assert.match(migration, /request\.secret_mappings/);
assert.match(migration, /connection\.account_metadata\.platform_secret_mappings/);
assert.match(migration, /default_secret_mapping_allowed',false/);
assert.match(migration, /secrets_included',false/);
assert.doesNotMatch(migration, /OPENROUTER_API_KEY\s*[:=]\s*[A-Za-z0-9_\-]{8,}/i);
assert.doesNotMatch(migration, /DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i);

console.log("Dynamic platform secret promotion guard passed");
