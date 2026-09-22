import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  connectorAuthTokens,
  fetchLocalConnectorWithCredentialFallback,
} from "./services/localConnectorOrchestrator.js";
import { assertLocalManagerDesktopCommandSchema } from "./localManagerDesktopCommandSchema.js";
import { normalizeActivationSessionAuthorityError } from "./activationSessionLifecycleService.js";

assert.deepEqual(connectorAuthTokens({ connector_secret: "old", connector_local_api_key: "current" }), ["old", "current"]);
const attempted = [];
const result = await fetchLocalConnectorWithCredentialFallback({
  config: { connector_secret: "old", connector_local_api_key: "current" },
  url: "https://connector.invalid/shell",
  body: "{}",
  fetchImpl: async (_url, init) => {
    attempted.push(init.headers.Authorization);
    const accepted = init.headers.Authorization === "Bearer current";
    return {
      ok: accepted,
      status: accepted ? 200 : 401,
      headers: { get: () => "application/json" },
      text: async () => JSON.stringify(accepted ? { ok: true } : { ok: false, error: { message: "Missing or invalid connector credential" } }),
    };
  },
});
assert.equal(result.ok, true);
assert.deepEqual(attempted, ["Bearer old", "Bearer current"]);
assert.equal(result.credential_fallback_used, true);
assert.equal(result.credential_attempt_count, 2);
assert.equal(result.credential_source, "connector_local_api_key");
assert.doesNotMatch(JSON.stringify(result), /old|current/);

const response = (status, payload) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => "application/json" },
  text: async () => JSON.stringify(payload),
});

for (const nonFallbackStatus of [403, 500]) {
  let calls = 0;
  await assert.rejects(
    () => fetchLocalConnectorWithCredentialFallback({
      config: { connector_secret: "primary", connector_local_api_key: "fallback" },
      url: "https://connector.invalid/shell",
      fetchImpl: async () => {
        calls += 1;
        return response(nonFallbackStatus, { ok: false, error: { message: "rejected" } });
      },
    }),
    (error) => Number(error.status) === nonFallbackStatus && error.details.credential_attempt_count === 1,
  );
  assert.equal(calls, 1, `${nonFallbackStatus} must not trigger credential fallback`);
}

await assert.rejects(
  () => fetchLocalConnectorWithCredentialFallback({
    config: { connector_secret: "primary", connector_local_api_key: "fallback" },
    url: "https://connector.invalid/shell",
    fetchImpl: async () => {
      attempted.push("transport-timeout");
      const error = new Error("timed out");
      error.name = "AbortError";
      throw error;
    },
  }),
  (error) => error.name === "AbortError",
);
assert.equal(attempted.filter((entry) => entry === "transport-timeout").length, 1, "transport timeout must not trigger credential fallback");

let bothRejectedCalls = 0;
await assert.rejects(
  () => fetchLocalConnectorWithCredentialFallback({
    config: { connector_secret: "primary", connector_local_api_key: "fallback" },
    url: "https://connector.invalid/shell",
    fetchImpl: async () => {
      bothRejectedCalls += 1;
      return response(401, { ok: false, error: { message: "invalid credential" } });
    },
  }),
  (error) => error.code === "connector_credential_invalid" && error.details.credential_fallback_used === true && error.details.credential_attempt_count === 2,
);
assert.equal(bothRejectedCalls, 2);

let missingCredentialCalls = 0;
await assert.rejects(
  () => fetchLocalConnectorWithCredentialFallback({
    config: {},
    url: "https://connector.invalid/shell",
    fetchImpl: async () => { missingCredentialCalls += 1; },
  }),
  (error) => error.code === "connector_credential_missing",
);
assert.equal(missingCredentialCalls, 0);

const cachedAttempts = [];
const credentialFixture = { config_id: "cfg-cache", connector_secret: "stale", connector_local_api_key: "live" };
const cachedFetch = async (_url, init) => {
  cachedAttempts.push(init.headers.Authorization);
  return init.headers.Authorization === "Bearer live"
    ? response(200, { ok: true })
    : response(401, { ok: false, error: { message: "invalid credential" } });
};
await fetchLocalConnectorWithCredentialFallback({ config: credentialFixture, url: "https://connector.invalid/shell", fetchImpl: cachedFetch });
await fetchLocalConnectorWithCredentialFallback({ config: credentialFixture, url: "https://connector.invalid/shell", fetchImpl: cachedFetch });
assert.deepEqual(cachedAttempts, ["Bearer stale", "Bearer live", "Bearer live"]);

const columns = ["command_id", "tenant_id", "user_id", "device_id", "execution_mode", "action", "status", "priority", "requires_user_confirmation", "payload_json", "result_json", "requested_by", "request_context_json", "error_code", "error_message", "created_at", "claimed_at", "claim_token", "claim_lease_expires_at", "completed_at", "expires_at", "updated_at"];
const readyPool = { query: async (sql) => {
  assert.match(sql, /information_schema\.columns/);
  assert.doesNotMatch(sql, /CREATE|ALTER/);
  return [columns.map((column_name) => ({ column_name }))];
} };
assert.equal((await assertLocalManagerDesktopCommandSchema(readyPool)).ok, true);
await assert.rejects(
  () => assertLocalManagerDesktopCommandSchema({ query: async () => [[{ column_name: "command_id" }]] }),
  (error) => error.code === "local_manager_desktop_command_schema_not_ready" && error.status === 503 && error.details.database_mutation_performed === false,
);

const routeSource = readFileSync("./routes/localManagerDesktopCommandRoutes.js", "utf8");
assert.doesNotMatch(routeSource, /CREATE TABLE IF NOT EXISTS/);
assert.match(routeSource, /assertLocalManagerDesktopCommandSchema/);
assert.match(routeSource, /claim_token = \?/u);
assert.match(routeSource, /claim_lease_expires_at = DATE_ADD\(NOW\(\), INTERVAL \? SECOND\)/u);
assert.match(routeSource, /ORDER BY priority ASC, created_at ASC\s+LIMIT \?/u);
assert.match(routeSource, /\/heartbeat/u);
assert.match(routeSource, /AND status = 'claimed'\s+AND claim_token = \?\s+AND claim_lease_expires_at > NOW\(\)/u);
assert.match(routeSource, /desktop_command_claim_not_owned/u);
assert.doesNotMatch(routeSource, /rows\.map\(\(row\) => sanitizeCommand\(\{ \.\.\.row, status: "claimed"/u);

const denied = normalizeActivationSessionAuthorityError({ code: "ER_TABLEACCESS_DENIED_ERROR", message: "INSERT command denied to user secret-user" });
assert.equal(denied.code, "activation_session_write_authority_not_ready");
assert.equal(denied.status, 503);
assert.equal(denied.details.table, "customer_sessions");
assert.doesNotMatch(denied.message, /secret-user/);

console.log("control plane convergence regression tests passed");

const activationSurface = JSON.parse(readFileSync("./activation-surfaces/local_manager_desktop_commands.json", "utf8"));
assert.deepEqual(
  activationSurface.active_status_values,
  ["queued", "claimed", "completed", "failed", "expired", "cancelled"],
  "desktop command activation status taxonomy must match the DB enum",
);
assert.equal(activationSurface.result_columns.includes("claim_token"), false);
assert.equal(activationSurface.result_columns.includes("claim_lease_expires_at"), false);

const desktopCommandRoutesSource = readFileSync("./routes/localManagerDesktopCommandRoutes.js", "utf8");
assert.match(desktopCommandRoutesSource, /desktop_target_identity_authority_not_ready/u);
assert.match(desktopCommandRoutesSource, /local_connector_device_aliases/u);
assert.match(desktopCommandRoutesSource, /local_connector_user_configs/u);
assert.doesNotMatch(
  desktopCommandRoutesSource,
  /catch\s*\{\s*return\s+\[\]\s*;\s*\}/u,
  "desktop identity authority failures must not collapse silently into an empty mapping",
);

const authConnectorControlPlaneDeclaration = ".changes/e2e/auth-connector-control-plane-convergence-20260922.json";
const repositoryGovernanceConstitution = JSON.parse(readFileSync("./config/repository-governance-constitution.json", "utf8"));
const derivedStateGovernance = JSON.parse(readFileSync("../.github/derived-state-governance.json", "utf8"));
assert.ok(repositoryGovernanceConstitution.control_plane_paths.includes(authConnectorControlPlaneDeclaration));
assert.ok(derivedStateGovernance.convergence.automation_control_paths.includes(authConnectorControlPlaneDeclaration));

const e2eGovernanceWorkflowSource = readFileSync("../.github/workflows/e2e-phase-governance.yml", "utf8");
assert.match(e2eGovernanceWorkflowSource, /local_manager_mariadb_certification:/u);
assert.match(e2eGovernanceWorkflowSource, /local_manager_mariadb_required:/u);
assert.match(e2eGovernanceWorkflowSource, /id: local_manager_mariadb/u);
assert.match(e2eGovernanceWorkflowSource, /needs\.evaluate\.outputs\.local_manager_mariadb_required == 'true'/u);
assert.match(e2eGovernanceWorkflowSource, /20260922_local_manager_desktop_commands\.sql/u);
assert.match(e2eGovernanceWorkflowSource, /scripts\/local-manager-desktop-command-mariadb-certification\.mjs/u);
assert.match(e2eGovernanceWorkflowSource, /mariadb:11\.4/u);
assert.match(e2eGovernanceWorkflowSource, /privilege_denials\.every\(\(item\) => item\.denied === true\)/u);

const activationRoutesSource = readFileSync("./routes/activationRoutes.js", "utf8");
assert.match(
  activationRoutesSource,
  /read_only:\s*Object\.prototype\.hasOwnProperty\.call\(req\.query\s*\|\|\s*\{\},\s*"read_only"\)\s*\?\s*req\.query\.read_only\s*:\s*"true"/u,
  "getActivationSessionContext diagnostics must be read-only when the caller omits a mutation flag",
);
assert.match(
  activationRoutesSource,
  /read_only:\s*!shouldOpenActivationSession\(diagnosticQuery\)/u,
  "session-context response must state the effective read-only decision",
);

console.log("control-plane convergence regressions passed");

