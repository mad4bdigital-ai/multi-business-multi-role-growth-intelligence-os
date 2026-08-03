import express, { Router } from "express";
import { createHash, randomUUID } from "node:crypto";
import { getPool } from "../db.js";
import { TENANT_GPT_OAUTH_CLIENT_ID } from "../tenantGptOAuthPreset.js";
import {
  normalizeTenantGptOAuthResource,
  resolveTenantGptOAuthResourceProfile,
  tenantGptRequestHostFromHeaders,
} from "../tenantGptOAuthResourceProfile.js";
import { validateTenantGptOAuthClientCredentials } from "../tenantGptOAuthClientConfig.js";
import { consumeTenantGptOAuthAuthorizationCode } from "../tenantGptOAuthAuthorizationCodeStore.js";
import {
  buildTenantGptOAuthTokenErrorResponse,
  classifyTenantGptOAuthTokenExchangeOutcome,
} from "../tenantGptOAuthTokenExchangeOutcomePolicy.js";
import { recordTenantGptActivationContext } from "../tenantGptActivationContextStore.js";

const USER_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
const CHATGPT_CANONICAL_CALLBACK_HOST = "chatgpt.com";
const CHATGPT_LEGACY_CALLBACK_HOST = "chat.openai.com";

function sha256(value) {
  return createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function text(value, max = 128) {
  return String(value || "").trim().slice(0, max) || null;
}

function parseRedirectUri(value) {
  try {
    const url = new URL(String(value || ""));
    if (!["https:", "http:"].includes(url.protocol)) return null;
    return url;
  } catch {
    return null;
  }
}

function isChatGptAipOAuthCallback(url) {
  return /^\/aip\/g-[a-z0-9]+\/oauth\/callback$/i.test(url?.pathname || "");
}

function canonicalizeRedirectUri(value) {
  const url = parseRedirectUri(value);
  if (!url) return "";
  if (
    url.protocol === "https:"
    && url.hostname.toLowerCase() === CHATGPT_LEGACY_CALLBACK_HOST
    && isChatGptAipOAuthCallback(url)
  ) {
    url.hostname = CHATGPT_CANONICAL_CALLBACK_HOST;
  }
  return url.toString();
}

function equivalentRedirectUri(left, right) {
  const canonicalLeft = canonicalizeRedirectUri(left);
  const canonicalRight = canonicalizeRedirectUri(right);
  return Boolean(canonicalLeft && canonicalRight && canonicalLeft === canonicalRight);
}

function oauthClientCredentials(req) {
  const authorization = String(req.headers?.authorization || "");
  if (authorization.toLowerCase().startsWith("basic ")) {
    try {
      const decoded = Buffer.from(authorization.slice(6).trim(), "base64").toString("utf8");
      const splitAt = decoded.indexOf(":");
      if (splitAt >= 0) {
        return {
          client_id: decoded.slice(0, splitAt),
          client_secret: decoded.slice(splitAt + 1),
        };
      }
    } catch {
      // Fall through to form credentials.
    }
  }
  return {
    client_id: req.body?.client_id,
    client_secret: req.body?.client_secret,
  };
}

function safeClientEvidence(credentials = {}) {
  const clientId = String(credentials.client_id || "");
  return {
    client_id_present: Boolean(clientId),
    client_id_sha256_prefix: clientId ? sha256(clientId).slice(0, 12) : null,
    client_secret_present: Boolean(String(credentials.client_secret || "")),
  };
}

function safeRedirectEvidence(value) {
  const url = parseRedirectUri(value);
  if (!url) return { present: Boolean(value), valid: false };
  const canonical = parseRedirectUri(canonicalizeRedirectUri(url.toString()));
  return {
    present: true,
    valid: true,
    host: url.hostname,
    path: url.pathname,
    canonical_host: canonical?.hostname || null,
    canonical_path: canonical?.pathname || null,
  };
}

function safeCodeEvidence(code, nowMs, decodeCode) {
  const raw = String(code || "");
  if (!raw) return { present: false, decoded: false };
  const decoded = typeof decodeCode === "function" ? decodeCode(raw) : null;
  if (!decoded || typeof decoded !== "object") return { present: true, decoded: false };
  const issuedAtMs = Number.isFinite(Number(decoded.iat)) ? Number(decoded.iat) * 1000 : null;
  const expiresAtMs = Number.isFinite(Number(decoded.exp)) ? Number(decoded.exp) * 1000 : null;
  return {
    present: true,
    decoded: true,
    jti_present: Boolean(decoded.jti),
    purpose_present: Boolean(decoded.purpose),
    user_id_present: Boolean(decoded.user_id),
    tenant_id_present: Boolean(decoded.tenant_id),
    age_seconds: issuedAtMs === null ? null : Math.round((nowMs - issuedAtMs) / 1000),
    expires_in_seconds: expiresAtMs === null ? null : Math.round((expiresAtMs - nowMs) / 1000),
    redirect_uri: safeRedirectEvidence(decoded.redirect_uri),
  };
}

async function resolveActiveTokenSubject(pool, { user_id, tenant_id = null } = {}) {
  const userId = text(user_id, 64);
  if (!userId) return { ok: false, outcome: "payload_invalid" };
  const [userRows] = await pool.query(
    `SELECT user_id, email, display_name, status
       FROM \`users\`
      WHERE user_id = ?
      LIMIT 1`,
    [userId],
  );
  const user = userRows?.[0] || null;
  if (!user || user.status !== "active") {
    return { ok: false, outcome: "user_inactive" };
  }

  const requestedTenantId = text(tenant_id, 64);
  const membershipSql = requestedTenantId
    ? `SELECT m.tenant_id
         FROM \`memberships\` m
         JOIN \`tenants\` t ON t.tenant_id = m.tenant_id AND t.status = 'active'
        WHERE m.user_id = ? AND m.tenant_id = ? AND m.status = 'active'
        LIMIT 1`
    : `SELECT m.tenant_id
         FROM \`memberships\` m
         JOIN \`tenants\` t ON t.tenant_id = m.tenant_id AND t.status = 'active'
        WHERE m.user_id = ? AND m.status = 'active'
        ORDER BY m.granted_at ASC
        LIMIT 1`;
  const membershipParams = requestedTenantId ? [userId, requestedTenantId] : [userId];
  const [membershipRows] = await pool.query(membershipSql, membershipParams);
  const membership = membershipRows?.[0] || null;
  if (!membership?.tenant_id) {
    return { ok: false, outcome: "membership_inactive" };
  }
  return {
    ok: true,
    user,
    tenant_id: membership.tenant_id,
    secrets_included: false,
  };
}

async function recordTokenExchangeDiagnostic(query, event = {}) {
  if (typeof query !== "function") return;
  try {
    const now = new Date();
    const startedAt = new Date(event.started_at_ms || now.getTime());
    const durationMs = Math.max(0, now.getTime() - startedAt.getTime());
    const evidence = {
      event: "tenant_gpt_oauth_token_exchange_v2",
      phase: event.phase || null,
      classification: event.classification || null,
      status: event.status || null,
      http_status: event.http_status || null,
      failure_reason: event.failure_reason || null,
      duration_ms: durationMs,
      grant_type: event.grant_type || null,
      code: event.code || null,
      redirect_uri: event.redirect_uri || null,
      client: event.client || null,
      client_validation_source: event.client_validation_source || null,
      resource_profile: event.resource_profile || null,
      subject_prevalidated: event.subject_prevalidated === true,
      access_token_prepared: event.access_token_prepared === true,
      access_token: event.access_token || null,
      requested_scope: event.requested_scope || null,
      code_consumption: event.code_consumption || null,
      activation_context: event.activation_context || null,
      request_id: event.request_id || null,
      secrets_included: false,
    };
    await query(
      `INSERT INTO \`execution_log\`
        (run_date, start_time, end_time, duration_seconds, entry_type, execution_class, source_layer,
         execution_status, failure_reason, output_summary, action_key, endpoint_key, parent_action_key,
         runtime_evidence_json, created_at)
       VALUES (?, ?, ?, ?, 'diagnostic', 'oauth', 'tenant_gpt_oauth_token_exchange_routes', ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [
        startedAt.toISOString().slice(0, 10),
        startedAt.toISOString(),
        now.toISOString(),
        String((durationMs / 1000).toFixed(3)),
        event.status || "unknown",
        event.failure_reason || null,
        JSON.stringify({
          ok: event.status === "success",
          classification: event.classification || null,
          http_status: event.http_status || null,
          duration_ms: durationMs,
        }),
        "tenant_gpt_oauth_token_exchange_v2",
        "auth_oauth_token",
        "tenant_gpt_oauth",
        JSON.stringify(evidence),
      ],
    );
  } catch (error) {
    console.warn("tenant_gpt_oauth_token_exchange_v2_diagnostic_failed", {
      code: text(error?.code, 64),
      secrets_included: false,
    });
  }
}

function directOAuthError({ error, description, code, requestId, retrySameCode = false } = {}) {
  return Object.freeze({
    error,
    error_description: description,
    error_code: code,
    request_id: requestId,
    retry_same_code: retrySameCode,
    restart_authorization: false,
    outcome_unknown: false,
    operator_reconciliation_required: false,
    secrets_included: false,
  });
}

export function buildTenantGptOAuthTokenExchangeRoutes(deps = {}) {
  const router = Router();
  const resolvePool = typeof deps.getPool === "function" ? deps.getPool : getPool;
  const validateClientCredentials = deps.validateClientCredentials || validateTenantGptOAuthClientCredentials;
  const verifyCode = deps.verifyCode;
  const issueAccessToken = deps.issueAccessToken;
  const decodeCode = deps.decodeCode;
  if (typeof verifyCode !== "function" || typeof issueAccessToken !== "function") {
    const error = new Error("Governed OAuth code verification and access-token issuance dependencies are required.");
    error.code = "oauth_token_exchange_crypto_dependencies_required";
    throw error;
  }
  const consumeCode = deps.consumeCode || consumeTenantGptOAuthAuthorizationCode;
  const recordActivationContext = deps.recordActivationContext || recordTenantGptActivationContext;
  const resolveSubject = deps.resolveActiveSubject || resolveActiveTokenSubject;
  const createId = deps.randomUUID || randomUUID;
  const now = deps.now || (() => Date.now());

  router.post("/auth/oauth/token", express.urlencoded({ extended: false }), async (req, res) => {
    const startedAtMs = now();
    const requestId = createId();
    let phase = "before_code_consumption";
    let codeConsumed = false;
    let terminalEvidenceRecorded = false;
    let tokenQuery = null;
    const tokenLogContext = {
      request_id: requestId,
      grant_type: req.body?.grant_type || null,
      code: safeCodeEvidence(req.body?.code, startedAtMs, decodeCode),
      redirect_uri: safeRedirectEvidence(req.body?.redirect_uri),
      client: safeClientEvidence(oauthClientCredentials(req)),
    };

    delete req.headers.cookie;
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("x-request-id", requestId);

    const log = (event) => {
      void recordTokenExchangeDiagnostic(tokenQuery, {
        started_at_ms: startedAtMs,
        phase,
        ...tokenLogContext,
        ...event,
      });
    };
    const recordTerminal = (event) => {
      if (terminalEvidenceRecorded) return;
      terminalEvidenceRecorded = true;
      log(event);
    };
    const sendDecision = (decision) => {
      const body = buildTenantGptOAuthTokenErrorResponse(decision, { request_id: requestId });
      log({
        status: "failed",
        classification: decision.classification,
        failure_reason: decision.error_code,
        http_status: decision.http_status,
        code_consumption: {
          outcome_unknown: decision.outcome_unknown,
          retry_same_code: decision.retry_same_code,
          operator_reconciliation_required: decision.operator_reconciliation_required,
          secrets_included: false,
        },
      });
      return res.status(decision.http_status).json(body);
    };
    const invalidGrant = (outcome, failureReason = null) => sendDecision(
      classifyTenantGptOAuthTokenExchangeOutcome({
        phase: "before_code_consumption",
        consumption: { consumed: false, outcome, replay_allowed: false },
        failure_reason: failureReason || outcome,
      }),
    );

    try {
      const grantType = req.body?.grant_type;
      const code = req.body?.code;
      const redirectUri = req.body?.redirect_uri;
      const credentials = oauthClientCredentials(req);

      if (grantType !== "authorization_code") {
        log({ status: "failed", classification: "unsupported_grant_type", failure_reason: "unsupported_grant_type", http_status: 400 });
        return res.status(400).json(directOAuthError({
          error: "unsupported_grant_type",
          description: "Only authorization_code is supported.",
          code: "oauth_unsupported_grant_type",
          requestId,
        }));
      }
      if (!code) {
        log({ status: "failed", classification: "missing_code", failure_reason: "missing_code", http_status: 400 });
        return res.status(400).json(directOAuthError({
          error: "invalid_request",
          description: "code is required.",
          code: "oauth_code_required",
          requestId,
        }));
      }

      const pool = resolvePool();
      tokenQuery = (sql, params) => pool.query(sql, params);
      const clientValidation = await validateClientCredentials(credentials, { query: tokenQuery });
      tokenLogContext.client_validation_source = clientValidation.source || null;
      if (!clientValidation.ok) {
        log({
          status: "failed",
          classification: clientValidation.error || "invalid_client",
          failure_reason: clientValidation.error || "invalid_client",
          http_status: clientValidation.status || 401,
        });
        return res.status(clientValidation.status || 401).json(directOAuthError({
          error: clientValidation.error || "invalid_client",
          description: clientValidation.message || "Invalid OAuth client credentials.",
          code: `oauth_${text(clientValidation.error || "invalid_client", 64)}`,
          requestId,
          retrySameCode: clientValidation.status === 503,
        }));
      }

      const resourceProfile = resolveTenantGptOAuthResourceProfile({
        clientId: clientValidation.client_id,
        requestHost: tenantGptRequestHostFromHeaders(req.headers),
        requestedResource: req.body?.resource,
      });
      tokenLogContext.resource_profile = resourceProfile.ok
        ? { profile_key: resourceProfile.profile_key, resource: resourceProfile.resource, secrets_included: false }
        : { ok: false, error: resourceProfile.error, secrets_included: false };
      if (!resourceProfile.ok) {
        log({ status: "failed", classification: resourceProfile.error, failure_reason: resourceProfile.error, http_status: 400 });
        return res.status(400).json(directOAuthError({
          error: resourceProfile.error,
          description: resourceProfile.message,
          code: `oauth_${text(resourceProfile.error, 64)}`,
          requestId,
        }));
      }

      const codePayload = verifyCode(code);
      tokenLogContext.code = {
        ...tokenLogContext.code,
        jti_present: Boolean(codePayload?.jti),
        purpose_present: Boolean(codePayload?.purpose),
        user_id_present: Boolean(codePayload?.user_id),
        tenant_id_present: Boolean(codePayload?.tenant_id),
      };
      const codeClientId = text(codePayload?.client_id, 191);
      if (codeClientId && codeClientId !== clientValidation.client_id) {
        return invalidGrant("client_mismatch");
      }
      const codeResource = codePayload?.resource
        ? normalizeTenantGptOAuthResource(codePayload.resource)
        : resourceProfile.resource;
      if (!codeResource) return invalidGrant("resource_invalid");
      if (codeResource !== resourceProfile.resource) {
        log({ status: "failed", classification: "resource_mismatch", failure_reason: "oauth_code_resource_mismatch", http_status: 400 });
        return res.status(400).json(directOAuthError({
          error: "invalid_target",
          description: "OAuth code does not match this protected resource.",
          code: "oauth_code_resource_mismatch",
          requestId,
        }));
      }
      if (
        codePayload?.purpose !== "custom_gpt_oauth_code"
        || !codePayload?.jti
        || !codePayload?.user_id
        || !codePayload?.redirect_uri
      ) {
        return invalidGrant("payload_invalid");
      }
      if (redirectUri && !equivalentRedirectUri(redirectUri, codePayload.redirect_uri)) {
        return invalidGrant("redirect_mismatch");
      }

      const subject = await resolveSubject(pool, {
        user_id: codePayload.user_id,
        tenant_id: codePayload.tenant_id || null,
      });
      if (!subject.ok) return invalidGrant(subject.outcome || "user_inactive");
      tokenLogContext.subject_prevalidated = true;

      const accessJti = createId();
      const accessExpiresAt = new Date(now() + USER_TOKEN_TTL_SECONDS * 1000);
      const accessToken = issueAccessToken(
        { user_id: subject.user.user_id, email: subject.user.email, tenant_id: subject.tenant_id },
        {
          clientId: clientValidation.client_id,
          jwtid: accessJti,
          resource: resourceProfile.resource,
          expiresIn: USER_TOKEN_TTL_SECONDS,
        },
      );
      tokenLogContext.access_token_prepared = true;
      tokenLogContext.access_token = {
        token_type: "bearer",
        length: String(accessToken || "").length,
        secrets_included: false,
      };
      tokenLogContext.requested_scope = {
        count: String(codePayload.scope || "").split(/\s+/u).filter(Boolean).length,
        secrets_included: false,
      };

      phase = "code_consumption";
      const codeConsumption = await consumeCode({
        query: tokenQuery,
        jti: codePayload.jti,
        client_id: clientValidation.client_id,
        redirect_uri: codePayload.redirect_uri,
      });
      if (!codeConsumption.consumed) {
        return sendDecision(classifyTenantGptOAuthTokenExchangeOutcome({
          phase,
          consumption: codeConsumption,
          failure_reason: codeConsumption.outcome,
        }));
      }
      codeConsumed = true;
      phase = "after_code_consumption";
      tokenLogContext.code_consumption = {
        consumed: true,
        outcome: codeConsumption.outcome || "consumed",
        table_recovered: codeConsumption.table_recovered === true,
        secrets_included: false,
      };

      const activationContext = await recordActivationContext({
        query: tokenQuery,
        access_jti: accessJti,
        oauth_code_jti: codePayload.jti,
        user_id: subject.user.user_id,
        tenant_id: subject.tenant_id,
        client_id: clientValidation.client_id,
        activation_context: codePayload.activation_context,
        expires_at: accessExpiresAt,
      });
      tokenLogContext.activation_context = {
        stored: activationContext?.stored === true,
        source: activationContext?.source || null,
        reason: activationContext?.reason || null,
        secrets_included: false,
      };

      const tokenResponse = {
        access_token: accessToken,
        token_type: "bearer",
        expires_in: USER_TOKEN_TTL_SECONDS,
      };
      if (codePayload.scope) tokenResponse.scope = codePayload.scope;

      res.once("finish", () => {
        recordTerminal({
          phase: "response_committed",
          status: "success",
          classification: "token_response_committed",
          failure_reason: null,
          http_status: 200,
        });
      });
      res.once("close", () => {
        if (res.writableFinished) return;
        recordTerminal({
          phase: "after_code_consumption",
          status: "unknown",
          classification: "response_transport_interrupted",
          failure_reason: "oauth_response_transport_interrupted",
          http_status: null,
        });
      });
      return res.status(200).json(tokenResponse);
    } catch (error) {
      if (res.headersSent) {
        recordTerminal({
          phase: "after_code_consumption",
          status: "unknown",
          classification: "response_transport_interrupted",
          failure_reason: "oauth_response_transport_interrupted",
          http_status: null,
        });
        return undefined;
      }
      if (error?.oauth_consumption) {
        phase = "code_consumption";
        return sendDecision(classifyTenantGptOAuthTokenExchangeOutcome({
          phase,
          consumption: error.oauth_consumption,
          failure_reason: text(error?.code, 64) || "oauth_code_store_error",
        }));
      }
      if (error?.name === "TokenExpiredError") return invalidGrant("expired", "oauth_code_expired");
      if (["JsonWebTokenError", "NotBeforeError"].includes(error?.name)) {
        return invalidGrant("invalid", "oauth_code_invalid");
      }
      if (codeConsumed) {
        phase = "after_code_consumption";
        return sendDecision(classifyTenantGptOAuthTokenExchangeOutcome({
          phase,
          consumption: { consumed: true, outcome: "consumed", replay_allowed: false },
          failure_reason: text(error?.code, 64) || "post_consumption_failure",
        }));
      }
      phase = "before_code_consumption";
      return sendDecision(classifyTenantGptOAuthTokenExchangeOutcome({
        phase,
        consumption: null,
        failure_reason: text(error?.code, 64) || "preconsumption_dependency_failure",
      }));
    }
  });

  return router;
}
