import express, { Router } from "express";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { TENANT_GPT_OAUTH_CLIENT_ID, TENANT_GPT_SCOPE } from "./tenantGptOAuthPreset.js";
import {
  TENANT_GPT_AUTHORIZATION_SERVER,
  normalizeTenantGptOAuthResource,
} from "./tenantGptOAuthResourceProfile.js";

const REQUIRED_CODE_BINDING_CLAIMS = Object.freeze([
  "jti",
  "user_id",
  "tenant_id",
  "redirect_uri",
  "client_id",
  "resource",
]);

const BINDING_LIMITS = Object.freeze({
  code: 8192,
  jti: 128,
  user_id: 64,
  tenant_id: 64,
  redirect_uri: 2048,
  client_id: 191,
  resource: 2048,
  jwt_secret: 4096,
});

function text(value, max = 512) {
  return String(value || "").trim().slice(0, max);
}

function invalidCodeClaim(code, message) {
  const error = new Error(message);
  error.name = "JsonWebTokenError";
  error.code = code;
  return error;
}

function requireBoundedClaim(payload, claim) {
  const raw = String(payload?.[claim] || "").trim();
  if (!raw) {
    throw invalidCodeClaim(
      `oauth_code_${claim}_required`,
      `OAuth authorization-code claim ${claim} is required.`,
    );
  }
  const max = BINDING_LIMITS[claim];
  if (raw.length > max) {
    throw invalidCodeClaim(
      `oauth_code_${claim}_too_long`,
      `OAuth authorization-code claim ${claim} exceeds its bounded length.`,
    );
  }
  return raw;
}

function validRedirectUri(value) {
  try {
    const url = new URL(String(value || ""));
    return ["https:", "http:"].includes(url.protocol);
  } catch {
    return false;
  }
}

function requireJwtSecret(env = process.env) {
  const raw = String(env?.JWT_SECRET || "").trim();
  if (!raw || raw.length > BINDING_LIMITS.jwt_secret) {
    const error = new Error("A bounded JWT_SECRET is required for Tenant GPT OAuth token exchange.");
    error.code = "oauth_jwt_secret_unavailable";
    throw error;
  }
  return raw;
}

export function validateTenantGptOAuthAuthorizationCodeBindings(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw invalidCodeClaim("oauth_code_payload_invalid", "OAuth authorization-code payload must be an object.");
  }
  if (payload.purpose !== "custom_gpt_oauth_code") {
    throw invalidCodeClaim("oauth_code_purpose_invalid", "OAuth authorization-code purpose is invalid.");
  }

  const claims = Object.fromEntries(
    REQUIRED_CODE_BINDING_CLAIMS.map((claim) => [claim, requireBoundedClaim(payload, claim)]),
  );
  if (!validRedirectUri(claims.redirect_uri)) {
    throw invalidCodeClaim("oauth_code_redirect_uri_invalid", "OAuth authorization-code redirect_uri is invalid.");
  }
  if (!normalizeTenantGptOAuthResource(claims.resource)) {
    throw invalidCodeClaim("oauth_code_resource_invalid", "OAuth authorization-code resource is invalid.");
  }

  return payload;
}

function issueTenantGptAccessToken(payload, {
  clientId,
  jwtid,
  resource,
  expiresIn,
  jwtSecret,
} = {}) {
  const userId = text(payload?.user_id, BINDING_LIMITS.user_id);
  const tenantId = text(payload?.tenant_id, BINDING_LIMITS.tenant_id);
  const normalizedClientId = text(clientId || TENANT_GPT_OAUTH_CLIENT_ID, BINDING_LIMITS.client_id);
  const normalizedResource = normalizeTenantGptOAuthResource(resource);
  if (!userId || !tenantId || !normalizedClientId || !normalizedResource || !jwtid) {
    const error = new Error("Tenant GPT access-token subject, client, resource, and JTI are required.");
    error.code = "tenant_gpt_access_token_input_invalid";
    throw error;
  }
  return jwt.sign(
    {
      iss: TENANT_GPT_AUTHORIZATION_SERVER,
      aud: normalizedResource,
      azp: normalizedClientId,
      client_id: normalizedClientId,
      resource: normalizedResource,
      sub: `tenant:${tenantId}:user:${userId}`,
      user_id: userId,
      tenant_id: tenantId,
      scope: TENANT_GPT_SCOPE,
      purpose: "tenant_gpt_access",
    },
    jwtSecret,
    { expiresIn, jwtid },
  );
}

export function buildTenantGptOAuthTokenExchangeDeps(deps = {}, env = deps.env || process.env) {
  const injectedVerifyCode = typeof deps.verifyCode === "function" ? deps.verifyCode : null;
  const injectedIssueAccessToken = typeof deps.issueAccessToken === "function" ? deps.issueAccessToken : null;
  const verifyCode = injectedVerifyCode || ((code) => {
    const rawCode = String(code || "").trim();
    if (!rawCode || rawCode.length > BINDING_LIMITS.code) {
      throw invalidCodeClaim("oauth_code_size_invalid", "OAuth authorization code has an invalid bounded size.");
    }
    return jwt.verify(rawCode, requireJwtSecret(env));
  });
  const issueAccessToken = injectedIssueAccessToken || ((payload, options = {}) => issueTenantGptAccessToken(
    payload,
    { ...options, jwtSecret: requireJwtSecret(env) },
  ));

  return {
    ...deps,
    verifyCode(code) {
      return validateTenantGptOAuthAuthorizationCodeBindings(verifyCode(code));
    },
    issueAccessToken,
  };
}

function requestFailure(res, {
  requestId,
  description,
  code,
  retrySameCode,
} = {}) {
  return res.status(400).json({
    error: "invalid_request",
    error_description: description,
    error_code: code,
    request_id: requestId,
    retry_same_code: retrySameCode === true,
    restart_authorization: false,
    outcome_unknown: false,
    operator_reconciliation_required: false,
    secrets_included: false,
  });
}

export function buildTenantGptOAuthTokenRequestBindingGuard(options = {}) {
  const router = Router();
  const createId = typeof options.randomUUID === "function" ? options.randomUUID : randomUUID;

  router.post("/auth/oauth/token", express.urlencoded({ extended: false }), (req, res, next) => {
    const grantType = String(req.body?.grant_type || "").trim();
    const code = String(req.body?.code || "").trim();
    if (grantType !== "authorization_code" || !code) return next();

    const redirectUri = String(req.body?.redirect_uri || "").trim();
    const fail = (input) => {
      const requestId = createId();
      delete req.headers.cookie;
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("x-request-id", requestId);
      return requestFailure(res, { requestId, ...input });
    };

    if (code.length > BINDING_LIMITS.code) {
      return fail({
        description: "code exceeds its bounded length.",
        code: "oauth_code_too_long",
        retrySameCode: false,
      });
    }
    if (!redirectUri) {
      return fail({
        description: "redirect_uri is required for this authorization code.",
        code: "oauth_redirect_uri_required",
        retrySameCode: true,
      });
    }
    if (redirectUri.length > BINDING_LIMITS.redirect_uri || !validRedirectUri(redirectUri)) {
      return fail({
        description: "redirect_uri is invalid or exceeds its bounded length.",
        code: "oauth_redirect_uri_invalid",
        retrySameCode: true,
      });
    }
    return next();
  });

  return router;
}

export { BINDING_LIMITS, REQUIRED_CODE_BINDING_CLAIMS };
