import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const service = readFileSync("remoteRuntime.js", "utf8");
const routes = readFileSync("routes/platformPluginRoutes.js", "utf8");
const migration = readFileSync("migrations/152_sprint65_remote_runtime_target_management_tools.sql", "utf8");
const openapi = readFileSync("openapi.yaml", "utf8");

assert(service.includes("upsertRemoteRuntimeTarget"), "service must export target upsert");
assert(service.includes("validateRemoteRuntimeTarget"), "service must export target validate");
assert(service.includes("rejectSecretLikePayload"), "service must reject secret-like metadata");
assert(service.includes("remote_runtime_secret_like_metadata_rejected"), "service must use stable secret rejection code");
assert(service.includes("hosting_account targets require system_id or connection_id"), "hosting target must require system/connection reference");
assert(service.includes("local_path targets require local_path_id"), "local path target must require local path reference");
assert(service.includes("metadata_registered_no_ssh_execution"), "hosting upsert must remain metadata-only");
assert(service.includes("credential_metadata_validated_ssh_not_probed"), "hosting validation must not claim SSH connectivity");
assert(service.includes("local_path_registry_checked"), "local validation must use local path registry");
assert(service.includes("will_execute: false"), "target management must not execute commands");
assert(service.includes("dispatch_ready: false"), "target management must not mark execution dispatch-ready");
assert(service.includes("secrets_included: false"), "target management responses must exclude secrets");
assert(!service.includes("ssh2"), "target management must not import SSH client libraries");
assert(!service.includes("child_process"), "target management must not spawn local commands");
assert(!service.includes("exec("), "target management must not execute shell commands");
assert(!service.includes("spawn("), "target management must not spawn processes");

assert(routes.includes("upsertRemoteRuntimeTarget"), "routes must import target upsert service");
assert(routes.includes("validateRemoteRuntimeTarget"), "routes must import target validate service");
assert(routes.includes("/platform/remote-runtime/targets/upsert"), "routes must expose target upsert path");
assert(routes.includes("/platform/remote-runtime/targets/validate"), "routes must expose target validate path");
assert(routes.includes("remote_runtime_target_upsert_failed"), "upsert route must use structured error code");
assert(routes.includes("remote_runtime_target_validate_failed"), "validate route must use structured error code");

assert(migration.includes("remote_runtime_target_upsert"), "migration must register target upsert tool");
assert(migration.includes("remote_runtime_target_validate"), "migration must register target validate tool");
assert(migration.includes("/platform/remote-runtime/targets/upsert"), "migration must bind upsert path");
assert(migration.includes("/platform/remote-runtime/targets/validate"), "migration must bind validate path");
assert(migration.includes("state_changing"), "target management tools must be tagged state_changing");
assert(migration.includes("approval_gate"), "target management tools must be approval-gated");
assert(migration.includes("no_secrets"), "target management tools must be tagged no_secrets");
assert(!migration.includes("ssh_private_key"), "target management tool registration must not reference private key fields");
assert(!migration.includes("password"), "target management tool registration must not request passwords");

const upsertMatches = openapi.match(/\/platform\/remote-runtime\/targets\/upsert:/g) || [];
const validateMatches = openapi.match(/\/platform\/remote-runtime\/targets\/validate:/g) || [];
assert.equal(upsertMatches.length, 1, "OpenAPI must document upsert path exactly once");
assert.equal(validateMatches.length, 1, "OpenAPI must document validate path exactly once");
assert(openapi.includes("operationId: remoteRuntimeTargetUpsert"), "OpenAPI must expose stable upsert operationId");
assert(openapi.includes("operationId: remoteRuntimeTargetValidate"), "OpenAPI must expose stable validate operationId");
assert(openapi.includes("x-openai-isConsequential: true"), "OpenAPI must mark target management as consequential");
assert(openapi.includes("rejects secret-like fields"), "OpenAPI must document secret-like field rejection");
assert(openapi.includes("without opening SSH"), "OpenAPI must document no SSH execution");

console.log("remote runtime target management tests passed");
