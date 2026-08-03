import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import express from "express";
import jwt from "jsonwebtoken";

process.env.JWT_SECRET = "spec012_t031_route_test_secret";

const { buildAuthRoutes } = await import("./routes/authRoutes.js");

const CLIENT_ID = "mad4b-tenant-gpt";
const CLIENT_SECRET = "test-client-secret";
const RESOURCE = "https://activation.mad4b.com";
const CALLBACK = "https://chatgpt.com/aip/g-route-test/oauth/callback";
const JWT_SECRET = process.env.JWT_SECRET;

function sha256(value) {
  return createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function createHarness() {
  const codes = new Map();
  const diagnostics = [];
  const contexts = [];
  const state = {
    consume_mode: "normal",
    user_lookup_error: null,
  };

  const pool = {
    async query(sql, params = []) {
      if (sql.includes("FROM `platform_runtime_config`")) {
        return [[{
          config_json: JSON.stringify({
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
          }),
        }]];
      }

      if (sql.includes("FROM `engine_workflow_bindings`")) {
        return [[]];
      }

      if (sql.includes("UPDATE `tenant_gpt_oauth_authorization_codes`")) {
        const row = codes.get(params[0]);
        if (state.consume_mode === "commit_then_disconnect") {
          if (row?.status === "issued") {
            row.status = "consumed";
            row.consumed_at = new Date();
          }
          const error = new Error("connection dropped after commit");
          error.code = "ECONNRESET";
          throw error;
        }
        if (state.consume_mode === "disconnect_before_commit") {
          const error = new Error("connection dropped before commit");
          error.code = "ETIMEDOUT";
          throw error;
        }
        if (state.consume_mode === "store_unavailable") {
          const error = new Error("authorization-code store unavailable");
          error.code = "ECONNREFUSED";
          throw error;
        }
        const eligible = row
          && row.client_id === params[1]
          && row.redirect_uri_hash === params[2]
          && row.status === "issued"
          && !row.consumed_at
          && row.expires_at.getTime() > Date.now();
        if (eligible) {
          row.status = "consumed";
          row.consumed_at = new Date();
        }
        return [{ affectedRows: eligible ? 1 : 0 }];
      }

      if (sql.includes("SELECT status, expires_at, consumed_at")) {
        if (state.consume_mode === "store_unavailable") {
          const error = new Error("authorization-code readback unavailable");
          error.code = "ECONNREFUSED";
          throw error;
        }
        const row = codes.get(params[2]);
        return [[row ? {
          status: row.status,
          expires_at: row.expires_at,
          consumed_at: row.consumed_at,
          client_matches: row.client_id === params[0] ? 1 : 0,
          redirect_matches: row.redirect_uri_hash === params[1] ? 1 : 0,
          expired_by_store: row.expires_at.getTime() <= Date.now() ? 1 : 0,
        } : undefined].filter(Boolean)];
      }

      if (sql.includes("FROM `users`")) {
        if (state.user_lookup_error) throw state.user_lookup_error;
        return [[{
          user_id: "user-1",
          email: "user@example.com",
          display_name: "User One",
          status: "active",
        }]];
      }

      if (sql.includes("FROM `memberships`")) {
        return [[{ tenant_id: "tenant-1" }]];
      }

      if (sql.includes("CREATE TABLE IF NOT EXISTS `tenant_gpt_activation_contexts`")) {
        return [{ affectedRows: 0 }];
      }

      if (sql.includes("INSERT INTO `tenant_gpt_activation_contexts`")) {
        contexts.push({ params });
        return [{ affectedRows: 1 }];
      }

      if (sql.includes("INSERT INTO `execution_log`")) {
        diagnostics.push({
          execution_status: params[4],
          failure_reason: params[5],
          runtime_evidence: JSON.parse(params[10]),
        });
        return [{ affectedRows: 1 }];
      }

      throw new Error(`Unexpected token-route query: ${sql} ${JSON.stringify(params)}`);
    },
  };

  function issueCode(jti) {
    codes.set(sha256(jti), {
      client_id: CLIENT_ID,
      redirect_uri_hash: sha256(CALLBACK),
      status: "issued",
      consumed_at: null,
      expires_at: new Date(Date.now() + 300_000),
    });
    return jwt.sign({
      purpose: "custom_gpt_oauth_code",
      user_id: "user-1",
      tenant_id: "tenant-1",
      email: "user@example.com",
      redirect_uri: CALLBACK,
      client_id: CLIENT_ID,
      resource: RESOURCE,
      scope: "https://auth.mad4b.com/scopes/tenant.activation",
      activation_context: { activation_mode: "managed" },
    }, JWT_SECRET, { expiresIn: 300, jwtid: jti });
  }

  return { pool, state, codes, diagnostics, contexts, issueCode };
}

function startServer(harness) {
  const app = express();
  app.use(express.json());
  app.use("/auth", buildAuthRoutes({ getPool: () => harness.pool }));
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${server.address().port}`,
      });
    });
  });
}

async function exchange(baseUrl, code) {
  const response = await fetch(`${baseUrl}/auth/oauth/token`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-forwarded-host": "activation.mad4b.com",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: CALLBACK,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      resource: RESOURCE,
    }).toString(),
  });
  return {
    status: response.status,
    cacheControl: response.headers.get("cache-control") || "",
    pragma: response.headers.get("pragma") || "",
    body: await response.json(),
  };
}

const harness = createHarness();
const { server, baseUrl } = await startServer(harness);

try {
  const successJti = "route-success-jti";
  const success = await exchange(baseUrl, harness.issueCode(successJti));
  assert.equal(success.status, 200, JSON.stringify(success));
  assert.equal(success.body.token_type, "bearer");
  assert.equal(typeof success.body.access_token, "string");
  assert.equal(success.cacheControl.includes("no-store"), true);
  assert.equal(success.pragma.includes("no-cache"), true);
  assert.equal(harness.codes.get(sha256(successJti)).status, "consumed");

  const replay = await exchange(baseUrl, jwt.sign({
    purpose: "custom_gpt_oauth_code",
    user_id: "user-1",
    tenant_id: "tenant-1",
    redirect_uri: CALLBACK,
    client_id: CLIENT_ID,
    resource: RESOURCE,
  }, JWT_SECRET, { expiresIn: 300, jwtid: successJti }));
  assert.equal(replay.status, 400, JSON.stringify(replay));
  assert.equal(replay.body.error, "invalid_grant");
  assert.equal(replay.body.error_code, "oauth_code_already_consumed");
  assert.equal(replay.body.retry_same_code, false);
  assert.equal(replay.body.restart_authorization, true);
  assert.equal(replay.body.outcome_unknown, false);

  const committedJti = "route-commit-disconnect-jti";
  harness.state.consume_mode = "commit_then_disconnect";
  const committedUnknown = await exchange(baseUrl, harness.issueCode(committedJti));
  assert.equal(committedUnknown.status, 503, JSON.stringify(committedUnknown));
  assert.equal(committedUnknown.body.error, "temporarily_unavailable");
  assert.equal(committedUnknown.body.error_code, "oauth_code_consumption_outcome_unknown");
  assert.equal(committedUnknown.body.retry_same_code, false);
  assert.equal(committedUnknown.body.restart_authorization, false);
  assert.equal(committedUnknown.body.outcome_unknown, true);
  assert.equal(committedUnknown.body.operator_reconciliation_required, true);
  assert.equal(harness.codes.get(sha256(committedJti)).status, "consumed");

  const issuedJti = "route-precommit-disconnect-jti";
  harness.state.consume_mode = "disconnect_before_commit";
  const issuedRetry = await exchange(baseUrl, harness.issueCode(issuedJti));
  assert.equal(issuedRetry.status, 503, JSON.stringify(issuedRetry));
  assert.equal(issuedRetry.body.error, "temporarily_unavailable");
  assert.equal(issuedRetry.body.error_code, "oauth_code_store_temporarily_unavailable");
  assert.equal(issuedRetry.body.retry_same_code, true);
  assert.equal(issuedRetry.body.restart_authorization, false);
  assert.equal(issuedRetry.body.outcome_unknown, false);
  assert.equal(harness.codes.get(sha256(issuedJti)).status, "issued");

  const userFailureJti = "route-user-lookup-failure-jti";
  harness.state.consume_mode = "normal";
  const lookupError = new Error("user store unavailable");
  lookupError.code = "ECONNREFUSED";
  harness.state.user_lookup_error = lookupError;
  const userFailure = await exchange(baseUrl, harness.issueCode(userFailureJti));
  assert.equal(userFailure.status, 503, JSON.stringify(userFailure));
  assert.equal(userFailure.body.error, "temporarily_unavailable");
  assert.equal(userFailure.body.error_code, "oauth_token_exchange_dependency_unavailable");
  assert.equal(userFailure.body.retry_same_code, false);
  assert.equal(userFailure.body.restart_authorization, false);
  assert.equal(harness.codes.get(sha256(userFailureJti)).status, "issued");

  for (const result of [replay, committedUnknown, issuedRetry, userFailure]) {
    const serialized = JSON.stringify(result.body);
    assert.equal(serialized.includes("Bearer "), false);
    assert.equal(serialized.includes(CLIENT_SECRET), false);
    assert.equal(serialized.includes("route-"), false);
    assert.equal(result.body.secrets_included, false);
    assert.equal(result.cacheControl.includes("no-store"), true);
    assert.equal(result.pragma.includes("no-cache"), true);
  }

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(harness.diagnostics.length >= 4, true, JSON.stringify(harness.diagnostics));
  assert.equal(harness.diagnostics.every((item) => item.runtime_evidence?.secrets_included === false), true);

  console.log("PASS tenant-gpt-oauth-token-route-ambiguity");
} finally {
  await new Promise((resolve) => server.close(resolve));
}
