import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const migration = readFileSync("migrations/189_sprint66_tenant_gpt_operating_guide_tools.sql", "utf8");
const guidePath = "../docs/tenant-gpt-operating-guide.md";
const capabilityRegistryPath = "../schemas/http-generic-api/tenant-capability-registry.json";
const lifecycleRoutes = readFileSync("routes/tenantLifecycleRoutes.js", "utf8");

assert(migration.includes("tenant_docs_catalog"), "migration must register tenant docs catalog tool");
assert(migration.includes("tenant_gpt_operating_guide_read"), "migration must register operating guide read tool");
assert(migration.includes("tenant_capability_registry_read"), "migration must register capability registry read tool");
assert(migration.includes("/tenant/docs/read"), "guide tools must route through tenant docs read endpoint");
assert(migration.includes("docs/tenant-gpt-operating-guide.md"), "guide tool must pin the guide path");
assert(migration.includes("schemas/http-generic-api/tenant-capability-registry.json"), "registry tool must pin the registry path");
assert(migration.includes("read_only") && migration.includes("no_secrets"), "tenant guide tools must be read-only and no-secrets tagged");
assert(!migration.includes("state_changing"), "tenant guide tools must not be state changing");

assert(existsSync(guidePath), "tenant operating guide file must exist for tenant docs readback");
assert(existsSync(capabilityRegistryPath), "tenant capability registry file must exist for tenant docs readback");

const guide = readFileSync(guidePath, "utf8");
assert(guide.includes("Predictive guidance model"), "guide must teach proactive guidance");
assert(guide.includes("validation_status"), "guide must explain validation status semantics");
assert(guide.includes("Collation/schema/query errors"), "guide must classify platform validation errors safely");

const capabilityRegistry = JSON.parse(readFileSync(capabilityRegistryPath, "utf8"));
assert.equal(capabilityRegistry.secrets_included, false, "capability registry must not include secrets");
assert(Array.isArray(capabilityRegistry.capabilities), "capability registry must expose a capabilities array");
assert(capabilityRegistry.capabilities.some((item) => item.key === "database_readiness"), "registry must include database readiness guidance");
assert(capabilityRegistry.capabilities.some((item) => item.key === "ssh_readiness"), "registry must include SSH readiness guidance");

assert(lifecycleRoutes.includes("s.connection_id COLLATE utf8mb4_unicode_ci = c.connection_id COLLATE utf8mb4_unicode_ci"), "credential intake status join must normalize mixed collations");
assert(lifecycleRoutes.includes("c.connection_id COLLATE utf8mb4_unicode_ci = ?"), "credential intake status lookup must normalize connection_id comparison");

console.log("tenant GPT operating guide tool registry tests passed");
