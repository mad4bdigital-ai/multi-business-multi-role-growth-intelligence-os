import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "./test-tenant-gpt-oauth-token-exchange-routes.mjs";
import "./test-tenant-gpt-oauth-token-exchange-outcome-policy.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = relativePath => fs.readFileSync(path.join(root, relativePath), "utf8");

const record = JSON.parse(read(
  "specs/012-tenant-activation-lifecycle/implementation/pr-2m-t031-oauth-token-route-wiring.json",
));
const narrative = read(
  "specs/012-tenant-activation-lifecycle/implementation/pr-2m-t031-oauth-token-route-wiring.md",
);
const tasks = read("specs/012-tenant-activation-lifecycle/tasks.md");
const route = read("http-generic-api/routes/tenantGptOAuthTokenExchangeRoutes.js");
const metadataRoutes = read("http-generic-api/routes/tenantGptOAuthMetadataRoutes.js");
const routeIndex = read("http-generic-api/routes/index.js");
const policy = read("http-generic-api/tenantGptOAuthTokenExchangeOutcomePolicy.js");
const legacyAuthRoutes = read("http-generic-api/routes/authRoutes.js");

assert.equal(record.task_id, "T031");
assert.equal(record.status, "route_wiring_validated_live_readback_required");
assert.equal(record.route_contract.method, "POST");
assert.equal(record.route_contract.path, "/auth/oauth/token");
assert.equal(record.route_contract.mounted_before_legacy_auth_router, true);
assert.equal(record.route_contract.active_user_prevalidated, true);
assert.equal(record.route_contract.active_tenant_membership_prevalidated, true);
assert.equal(record.route_contract.access_token_prepared_before_consumption, true);
assert.equal(record.route_contract.atomic_code_consumption_after_prevalidation, true);
assert.equal(record.route_contract.success_evidence_after_response_finish, true);
assert.equal(record.route_contract.early_response_close_classified_unknown, true);
assert.equal(record.route_contract.terminal_evidence_deduplicated, true);
assert.equal(record.outcome_contract.preconsumption_same_code_retry_allowed, true);
assert.equal(record.outcome_contract.unknown_consumption_same_code_retry_allowed, false);
assert.equal(record.outcome_contract.post_consumption_failure_same_code_retry_allowed, false);
assert.equal(record.validation.route_level_regression_complete, true);
assert.equal(record.validation.api_dependencies_installed_from_lockfile, true);
assert.equal(record.validation.http_integration_complete, true);
assert.equal(record.validation.shared_canary_complete, true);
assert.equal(record.validation.temporary_workflow_change_retired_before_ready, true);
assert.equal(record.completion_gate.route_wiring_complete, true);
assert.equal(record.completion_gate.route_level_regression_complete, true);
assert.equal(record.completion_gate.exact_head_ci_complete, false);
assert.equal(record.completion_gate.production_deployed, false);
assert.equal(record.completion_gate.live_success_exchange_readback_complete, false);
assert.equal(record.completion_gate.task_completion_allowed, false);
assert.equal(record.completion_gate.required_before_completion.length >= 8, true);
assert.match(tasks, /^- \[ \] \*\*T031\*\*/mu,
  "T031 must remain open until deployment and live readback");
assert.match(narrative, /does \*\*not\*\* close T031/u);
assert.match(narrative, /Completion boundary/u);

assert.match(metadataRoutes, /buildTenantGptOAuthTokenExchangeRoutes/u);
assert.match(metadataRoutes, /router\.use\(buildTenantGptOAuthTokenExchangeRoutes\(deps\)\)/u);
const metadataMount = routeIndex.indexOf("app.use(buildTenantGptOAuthMetadataRoutes())");
const legacyAuthMount = routeIndex.indexOf('app.use("/auth", buildAuthRoutes(deps))');
assert.equal(metadataMount >= 0, true, "metadata router mount must exist");
assert.equal(legacyAuthMount > metadataMount, true,
  "governed token exchange router must mount before legacy auth routes");

assert.match(route, /router\.post\("\/auth\/oauth\/token"/u);
assert.match(route, /delete req\.headers\.cookie/u);
assert.match(route, /res\.setHeader\("Cache-Control", "no-store"\)/u);
assert.match(route, /res\.setHeader\("Pragma", "no-cache"\)/u);
assert.match(route, /res\.setHeader\("x-request-id", requestId\)/u);
assert.equal(
  route.includes("JOIN \\`tenants\\` t ON t.tenant_id = m.tenant_id AND t.status = 'active'"),
  true,
  "active membership read must join an active tenant",
);
assert.match(route, /error\?\.oauth_consumption/u);
assert.match(route, /operator_reconciliation_required/u);
assert.match(route, /response_transport_interrupted/u);
assert.match(route, /res\.once\("finish"/u);
assert.match(route, /res\.once\("close"/u);
assert.match(route, /terminalEvidenceRecorded/u);
assert.match(route, /phase: "response_committed"/u);
assert.match(route, /secrets_included: false/u);

const subjectRead = route.indexOf("const subject = await resolveSubject");
const tokenPrepared = route.indexOf("const accessToken = issueAccessToken");
const consumeGate = route.indexOf("const codeConsumption = await consumeCode");
const contextWrite = route.indexOf("const activationContext = await recordActivationContext");
const finishListener = route.indexOf('res.once("finish"');
const responseWrite = route.indexOf("return res.status(200).json(tokenResponse)");
assert.equal(subjectRead >= 0, true);
assert.equal(tokenPrepared > subjectRead, true,
  "active subject validation must precede token preparation");
assert.equal(consumeGate > tokenPrepared, true,
  "access-token preparation must precede atomic code consumption");
assert.equal(contextWrite > consumeGate, true,
  "activation context recording must follow successful code consumption");
assert.equal(finishListener > contextWrite, true,
  "response-commit evidence listener must be registered after post-consumption work");
assert.equal(responseWrite > finishListener, true,
  "success evidence must be bound to finish before the token response is written");

assert.match(policy, /oauth_token_exchange_preconsumption_unavailable/u);
assert.match(policy, /retry_same_code: codeStillAvailable/u);
assert.match(policy, /oauth_token_response_not_committed/u);
assert.match(policy, /oauth_code_consumption_outcome_unknown/u);
assert.match(legacyAuthRoutes, /router\.post\("\/oauth\/token"/u,
  "legacy handler remains present but must be shadowed only for the exact route");
assert.match(route, /client_secret_present: Boolean/u,
  "diagnostics may retain only the presence bit for a client secret");
assert.doesNotMatch(route, /access_token:\s*event/u,
  "diagnostics must not attach an access token");
assert.doesNotMatch(route, /authorization:\s*event/u,
  "diagnostics must not attach an authorization header");
assert.doesNotMatch(route, /cookie:\s*event/u,
  "diagnostics must not attach a cookie");

for (const [key, value] of Object.entries(record.non_effects)) {
  assert.equal(value, false, `${key} must remain false`);
}

console.log("Spec 012 T031 OAuth token-route wiring tests passed");
