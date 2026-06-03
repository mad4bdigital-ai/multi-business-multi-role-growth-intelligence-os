import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync("migrations/189_sprint66_tenant_gpt_operating_guide_tools.sql", "utf8");

assert(migration.includes("tenant_docs_catalog"), "migration must register tenant docs catalog tool");
assert(migration.includes("tenant_gpt_operating_guide_read"), "migration must register operating guide read tool");
assert(migration.includes("tenant_capability_registry_read"), "migration must register capability registry read tool");
assert(migration.includes("/tenant/docs/read"), "guide tools must route through tenant docs read endpoint");
assert(migration.includes("docs/tenant-gpt-operating-guide.md"), "guide tool must pin the guide path");
assert(migration.includes("schemas/http-generic-api/tenant-capability-registry.json"), "registry tool must pin the registry path");
assert(migration.includes("read_only") && migration.includes("no_secrets"), "tenant guide tools must be read-only and no-secrets tagged");
assert(!migration.includes("state_changing"), "tenant guide tools must not be state changing");

console.log("tenant GPT operating guide tool registry tests passed");
