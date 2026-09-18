import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// frontend-surface-operation: POST /platform/remote-runtime/targets/catalog
// frontend-surface-operation: GET /platform/remote-runtime/targets/catalog-readonly

const service = readFileSync("remoteRuntime.js", "utf8");
const routes = readFileSync("routes/platformPluginRoutes.js", "utf8");
const readonlyRoutes = readFileSync("routes/operationalConsoleRoutes.js", "utf8");
const migration = readFileSync("migrations/151_sprint65_remote_runtime_catalog_probe_tools.sql", "utf8");
const openapi = readFileSync("openapi.yaml", "utf8");
const readonlyPrecise = readFileSync("openapi/remote-runtime-target-catalog-readonly.yaml", "utf8");
const readonlyRegistry = readFileSync("openapi-route-contracts.d/remote-runtime-target-catalog-readonly.yaml", "utf8");
const stagingAdminBuilder = readFileSync("scripts/build-staging-admin-openapi.mjs", "utf8");
const customGptSurfaces = readFileSync("../canonicals/openapi/custom-gpt-surfaces.yaml", "utf8");

const catalogStart = service.indexOf("export async function listRemoteRuntimeTargets");
const catalogEnd = service.indexOf("\nexport async function ", catalogStart + 1);
assert.notEqual(catalogStart, -1, "catalog function must be exported");
const catalogSource = service.slice(catalogStart, catalogEnd === -1 ? service.length : catalogEnd);
assert.match(catalogSource, /SELECT \* FROM remote_runtime_targets/);
assert.match(catalogSource, /SELECT \* FROM remote_runtime_command_allowlists/);
assert.doesNotMatch(catalogSource, /writeExecutionEvidence|\b(?:INSERT\s+INTO|UPDATE\s+\w|DELETE\s+FROM)\b/i, "catalog must remain SELECT-only");

assert(service.includes("listRemoteRuntimeTargets"), "service must export target catalog function");
assert(service.includes("probeRemoteRuntimeTarget"), "service must export readiness probe function");
assert(service.includes("remote_runtime_targets"), "service must read remote runtime targets");
assert(service.includes("remote_runtime_command_allowlists"), "service must read command allowlists");
assert(service.includes("writeExecutionEvidence"), "probe must write execution evidence");
assert(service.includes("will_execute: false"), "probe must never execute in this phase");
assert(service.includes("dispatch_ready: false"), "probe must not mark dispatch ready");
assert(service.includes("Probe never opens SSH"), "probe response must explain no SSH/local shell/file execution");
assert(service.includes("secrets_included: false"), "service must explicitly exclude secrets");
assert(!service.includes("ssh2"), "catalog/probe service must not import SSH client libraries");
assert(!service.includes("child_process"), "catalog/probe service must not spawn local commands");
assert(!service.includes("exec("), "catalog/probe service must not execute shell commands");
assert(!service.includes("spawn("), "catalog/probe service must not spawn processes");

assert(routes.includes("listRemoteRuntimeTargets"), "routes must import target catalog service");
assert(routes.includes("probeRemoteRuntimeTarget"), "routes must import probe service");
assert(routes.includes("/platform/remote-runtime/targets/catalog"), "routes must expose remote runtime catalog path");
assert(routes.includes("/platform/remote-runtime/probe"), "routes must expose remote runtime probe path");
assert(routes.includes("remote_runtime_catalog_failed"), "catalog route must use structured error code");
assert(routes.includes("remote_runtime_probe_failed"), "probe route must use structured error code");

const readonlyStart = readonlyRoutes.indexOf('router.get("/platform/remote-runtime/targets/catalog-readonly"');
assert.notEqual(readonlyStart, -1, "Staging Admin read-only catalog projection route must exist");
const readonlyEnd = readonlyRoutes.indexOf("\n  router.", readonlyStart + 1);
const readonlySource = readonlyRoutes.slice(readonlyStart, readonlyEnd === -1 ? readonlyRoutes.length : readonlyEnd);
assert.match(readonlyRoutes, /listRemoteRuntimeTargets/);
assert.match(readonlySource, /req\.query/);
assert.doesNotMatch(readonlySource, /req\.body/);
assert.doesNotMatch(readonlySource, /upsertRemoteRuntimeTarget|validateRemoteRuntimeTarget|probeRemoteRuntimeTarget|executeHostingerSshTargetProbe|executeHostingerSshDeployRelease|child_process|spawn\(|exec\(/);
assert.match(readonlySource, /secrets_included:\s*false/);

assert(migration.includes("remote_runtime_target_catalog"), "migration must register target catalog tool");
assert(migration.includes("remote_runtime_probe"), "migration must register probe tool");
assert(migration.includes("/platform/remote-runtime/targets/catalog"), "migration must bind catalog path");
assert(migration.includes("/platform/remote-runtime/probe"), "migration must bind probe path");
assert(migration.includes("no_secrets"), "tools must be tagged no_secrets");
assert(migration.includes("read_only"), "tools must be read-only diagnostics");
assert(!migration.includes("state_changing"), "catalog/probe tools must not be state-changing");
assert(!migration.includes("ssh_private_key"), "catalog/probe tool registration must not reference private key fields");

assert(openapi.includes("/platform/remote-runtime/targets/catalog:"), "OpenAPI must document canonical catalog path");
assert(openapi.includes("/platform/remote-runtime/probe:"), "OpenAPI must document probe path");
assert(openapi.includes("operationId: remoteRuntimeTargetCatalog"), "OpenAPI must expose stable catalog operationId");
assert(openapi.includes("operationId: remoteRuntimeProbe"), "OpenAPI must expose stable probe operationId");
assert(openapi.includes("x-openai-isConsequential: false"), "OpenAPI must mark catalog/probe as non-consequential");
assert(openapi.includes("never opens SSH"), "OpenAPI must document no SSH execution");

assert.match(readonlyPrecise, /operationId:\s*getRemoteRuntimeTargetCatalogReadonly/);
assert.doesNotMatch(readonlyPrecise, /x-custom-gpt-surfaces:\s*\[[^\]]*admin_core/, "Staging-only catalog must not consume shared admin_core operation budget");
assert.match(readonlyPrecise, /x-openai-isConsequential:\s*false/);
assert.match(readonlyPrecise, /tags:[\s\S]*- staging-admin[\s\S]*- admin-control/, "Staging-only operation must be an explicit admin_core candidate-by-tag before policy exclusion"); // admin-control candidate tag
assert.match(readonlyPrecise, /x-runtime-contract-source:\s*routes\/operationalConsoleRoutes\.js/);
assert.match(readonlyPrecise, /never opens SSH/);
assert.match(readonlyPrecise, /never[\s\S]*returns credential values/);
assert.match(readonlyRegistry, /GET \/platform\/remote-runtime\/targets\/catalog-readonly/);
assert.match(readonlyRegistry, /composition_mode:\s*inline/);
assert.match(stagingAdminBuilder, /remote-runtime-target-catalog-readonly\.yaml/, "Staging Admin builder must consume the supplemental precise contract directly");
assert.match(stagingAdminBuilder, /must not be inherited from shared admin_core/, "Staging Admin builder must fail closed if the route leaks into shared admin_core");
assert.match(customGptSurfaces, /operation_id:\s*getRemoteRuntimeTargetCatalogReadonly[\s\S]*Staging-only Remote Runtime target catalog is projected only through/, "shared Admin Core registry must carry an explicit exclusion record for the Staging-only operation");

console.log("remote runtime catalog/probe tests passed");
