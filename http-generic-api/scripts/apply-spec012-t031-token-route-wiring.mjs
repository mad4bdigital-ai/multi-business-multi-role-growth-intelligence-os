import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(__dirname, "..");
const authPath = path.join(apiRoot, "routes", "authRoutes.js");
const foundationTestPath = path.join(apiRoot, "test-spec012-t031-oauth-code-consumption-foundation.mjs");

function fail(message) {
  throw new Error(`spec012_t031_patch_failed: ${message}`);
}

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) fail(`${label} marker not found`);
  if (source.indexOf(before, first + before.length) >= 0) fail(`${label} marker is ambiguous`);
  return `${source.slice(0, first)}${after}${source.slice(first + before.length)}`;
}

let auth = fs.readFileSync(authPath, "utf8");

const storeImport = `import {
  consumeTenantGptOAuthAuthorizationCode,
  persistTenantGptOAuthAuthorizationCode,
} from "../tenantGptOAuthAuthorizationCodeStore.js";`;
const wiredImports = `${storeImport}
import {
  buildTenantGptOAuthTokenErrorResponse,
  classifyTenantGptOAuthTokenExchangeOutcome,
} from "../tenantGptOAuthTokenExchangeOutcomePolicy.js";`;
if (!auth.includes("tenantGptOAuthTokenExchangeOutcomePolicy.js")) {
  auth = replaceOnce(auth, storeImport, wiredImports, "OAuth outcome-policy import");
}

const routeStart = `  router.post("/oauth/token", express.urlencoded({ extended: false }), async (req, res) => {
    const startedAtMs = Date.now();
    const requestId = randomUUID();
    const tokenQuery = (sql, params) => resolvePool().query(sql, params);
    let tokenLogContext = {};`;
const wiredRouteStart = `  router.post("/oauth/token", express.urlencoded({ extended: false }), async (req, res) => {
    const startedAtMs = Date.now();
    const requestId = randomUUID();
    const tokenQuery = (sql, params) => resolvePool().query(sql, params);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Pragma", "no-cache");
    let tokenLogContext = {};
    let tokenExchangePhase = "before_code_consumption";
    let codeConsumption = null;`;
if (!auth.includes('let tokenExchangePhase = "before_code_consumption";')) {
  auth = replaceOnce(auth, routeStart, wiredRouteStart, "token-route state");
}

const exchangeStartMarker = `      if (redirectUri && !equivalentTenantGptRedirectUri(redirectUri, codePayload.redirect_uri)) {`;
const exchangeEndMarker = `      const activationContextRecord = await recordTenantGptActivationContext({`;
const exchangeStart = auth.indexOf(exchangeStartMarker);
const exchangeEnd = auth.indexOf(exchangeEndMarker, exchangeStart);
if (exchangeStart < 0 || exchangeEnd < 0 || exchangeEnd <= exchangeStart) {
  fail("token exchange reorder markers are missing");
}

const reorderedExchange = [
  "      if (redirectUri && !equivalentTenantGptRedirectUri(redirectUri, codePayload.redirect_uri)) {",
  "        logTokenExchange(\"failed\", \"redirect_uri_mismatch\", 400);",
  "        return res.status(400).json({ error: \"invalid_grant\", error_description: \"redirect_uri does not match the issued code.\" });",
  "      }",
  "",
  "      // Resolve every reversible dependency before the one-way code-consumption gate.",
  "      const pool = resolvePool();",
  "      const [userRows] = await pool.query(",
  "        `SELECT user_id, email, display_name, status FROM \\`users\\` WHERE user_id = ? LIMIT 1`,",
  "        [codePayload.user_id]",
  "      );",
  "      const tokenUser = userRows[0];",
  "      if (!tokenUser || tokenUser.status !== \"active\") {",
  "        logTokenExchange(\"failed\", \"user_inactive_or_missing\", 400);",
  "        return res.status(400).json({ error: \"invalid_grant\", error_description: \"User account is no longer active.\" });",
  "      }",
  "      const [memRows] = await pool.query(",
  "        `SELECT m.tenant_id FROM \\`memberships\\` m WHERE m.user_id = ? AND m.status = 'active' ORDER BY m.granted_at ASC LIMIT 1`,",
  "        [codePayload.user_id]",
  "      );",
  "      const tenantId = codePayload.tenant_id || memRows[0]?.tenant_id || null;",
  "      const accessJti = randomUUID();",
  "      const accessExpiresAt = new Date(Date.now() + USER_TOKEN_TTL_SECONDS * 1000);",
  "      const accessToken = issueTenantGptAccessToken(",
  "        { user_id: tokenUser.user_id, email: tokenUser.email, tenant_id: tenantId },",
  "        { clientId: clientValidation.client_id, jwtid: accessJti, compact: true, resource: effectiveResource }",
  "      );",
  "",
  "      tokenExchangePhase = \"code_consumption\";",
  "      codeConsumption = await consumeTenantGptOAuthAuthorizationCode({",
  "        query: tokenQuery,",
  "        jti: codePayload.jti,",
  "        client_id: clientValidation.client_id,",
  "        redirect_uri: codePayload.redirect_uri,",
  "      });",
  "      if (!codeConsumption.consumed) {",
  "        const decision = classifyTenantGptOAuthTokenExchangeOutcome({",
  "          phase: tokenExchangePhase,",
  "          consumption: codeConsumption,",
  "          failure_reason: codeConsumption.outcome,",
  "        });",
  "        logTokenExchange(\"failed\", decision.error_code, decision.http_status, {",
  "          code_consumption: {",
  "            outcome: codeConsumption.outcome || null,",
  "            readback_outcome: codeConsumption.readback_outcome || null,",
  "            replay_allowed: codeConsumption.replay_allowed === true,",
  "            store_error_code: codeConsumption.store_error_code || null,",
  "            secrets_included: false,",
  "          },",
  "          outcome_policy: {",
  "            classification: decision.classification,",
  "            outcome_unknown: decision.outcome_unknown,",
  "            operator_reconciliation_required: decision.operator_reconciliation_required,",
  "            secrets_included: false,",
  "          },",
  "        });",
  "        return res.status(decision.http_status).json(",
  "          buildTenantGptOAuthTokenErrorResponse(decision, { request_id: requestId }),",
  "        );",
  "      }",
  "      tokenExchangePhase = \"after_code_consumption\";",
  "",
].join("\n");

auth = `${auth.slice(0, exchangeStart)}${reorderedExchange}${auth.slice(exchangeEnd)}`;

const responseStartMarker = `      if (codePayload.scope) tokenResponse.scope = codePayload.scope;`;
const responseEndMarker = `
  });

  // ── POST /auth/register`;
const responseStart = auth.indexOf(responseStartMarker, exchangeStart);
const responseEnd = auth.indexOf(responseEndMarker, responseStart);
if (responseStart < 0 || responseEnd < 0 || responseEnd <= responseStart) {
  fail("token response/catch markers are missing");
}

const wiredResponseTail = [
  "      if (codePayload.scope) tokenResponse.scope = codePayload.scope;",
  "      const sentResponse = res.status(200).json(tokenResponse);",
  "      tokenExchangePhase = \"response_committed\";",
  "      return sentResponse;",
  "    } catch (err) {",
  "      if (res.headersSent || tokenExchangePhase === \"response_committed\") return undefined;",
  "",
  "      if ([\"TokenExpiredError\", \"JsonWebTokenError\", \"NotBeforeError\"].includes(err?.name)) {",
  "        logTokenExchange(\"failed\", err?.name === \"TokenExpiredError\" ? \"oauth_code_expired\" : \"oauth_code_invalid\", 400, {",
  "          exception_name: err?.name || null,",
  "        });",
  "        return res.status(400).json({",
  "          error: \"invalid_grant\",",
  "          error_description: \"OAuth code is invalid or expired.\",",
  "          error_code: err?.name === \"TokenExpiredError\" ? \"oauth_code_expired\" : \"oauth_code_invalid\",",
  "          retry_same_code: false,",
  "          restart_authorization: true,",
  "          outcome_unknown: false,",
  "          operator_reconciliation_required: false,",
  "          secrets_included: false,",
  "        });",
  "      }",
  "",
  "      const consumption = err?.oauth_consumption || codeConsumption;",
  "      const decision = classifyTenantGptOAuthTokenExchangeOutcome({",
  "        phase: tokenExchangePhase,",
  "        consumption,",
  "        response_committed: false,",
  "        failure_reason: err?.code || err?.name || \"token_exchange_exception\",",
  "      });",
  "      logTokenExchange(\"failed\", decision.error_code, decision.http_status, {",
  "        exception_name: err?.name || null,",
  "        code_consumption: consumption ? {",
  "          outcome: consumption.outcome || null,",
  "          readback_outcome: consumption.readback_outcome || null,",
  "          replay_allowed: consumption.replay_allowed === true,",
  "          store_error_code: consumption.store_error_code || null,",
  "          secrets_included: false,",
  "        } : null,",
  "        outcome_policy: {",
  "          classification: decision.classification,",
  "          outcome_unknown: decision.outcome_unknown,",
  "          operator_reconciliation_required: decision.operator_reconciliation_required,",
  "          secrets_included: false,",
  "        },",
  "      });",
  "      return res.status(decision.http_status).json(",
  "        buildTenantGptOAuthTokenErrorResponse(decision, { request_id: requestId }),",
  "      );",
  "    }",
].join("\n");

auth = `${auth.slice(0, responseStart)}${wiredResponseTail}${auth.slice(responseEnd)}`;

for (const required of [
  'from "../tenantGptOAuthTokenExchangeOutcomePolicy.js"',
  'let tokenExchangePhase = "before_code_consumption";',
  'tokenExchangePhase = "code_consumption";',
  'tokenExchangePhase = "after_code_consumption";',
  'tokenExchangePhase = "response_committed";',
  "classifyTenantGptOAuthTokenExchangeOutcome({",
  "buildTenantGptOAuthTokenErrorResponse(decision",
]) {
  if (!auth.includes(required)) fail(`required route wiring missing: ${required}`);
}
if (auth.includes('"oauth_code_invalid_or_exception"')) {
  fail("legacy catch-all invalid_grant mapping remains");
}

fs.writeFileSync(authPath, auth);

let foundationTest = fs.readFileSync(foundationTestPath, "utf8");
foundationTest = replaceOnce(
  foundationTest,
  `assert.doesNotMatch(authRoutes, /classifyTenantGptOAuthTokenExchangeOutcome/u,
  "the record must not claim route-policy wiring before it exists");
assert.doesNotMatch(authRoutes, /buildTenantGptOAuthTokenErrorResponse/u,
  "the record must not claim live response wiring before it exists");`,
  `assert.match(authRoutes, /classifyTenantGptOAuthTokenExchangeOutcome/u,
  "the live route must consume the foundation policy after follow-up wiring");
assert.match(authRoutes, /buildTenantGptOAuthTokenErrorResponse/u,
  "the live route must use bounded OAuth error responses after follow-up wiring");`,
  "foundation follow-up assertions",
);
fs.writeFileSync(foundationTestPath, foundationTest);

console.log("Applied Spec 012 T031 token-route ambiguity wiring patch");
