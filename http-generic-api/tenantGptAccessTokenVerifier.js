import jwt from "jsonwebtoken";
import { timingSafeEqual } from "node:crypto";
import {
  TENANT_GPT_ACTIVATION_RESOURCE,
  TENANT_GPT_AUTHORIZATION_SERVER,
  TENANT_GPT_LEGACY_AUDIENCE,
  normalizeTenantGptOAuthResource,
  tenantGptLegacyAudienceCutoffMs,
} from "./tenantGptOAuthResourceProfile.js";

const JWT_SECRET = process.env.JWT_SECRET || "development_fallback_secret_only";
const BACKEND_API_KEY = process.env.BACKEND_API_KEY || "";

function safeSecretMatch(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  return Boolean(leftBuffer.length && leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer));
}

function hasPlatformServiceCredential(req) {
  if (!BACKEND_API_KEY) return false;
  const xApiKey = String(req.headers?.["x-api-key"] || "").trim();
  const authorization = String(req.headers?.authorization || "");
  const bearer = authorization.replace(/^Bearer\s+/i, "").trim();
  return safeSecretMatch(xApiKey, BACKEND_API_KEY) || (bearer !== authorization && safeSecretMatch(bearer, BACKEND_API_KEY));
}

function tokenFailure(code, message) {
  const error = new Error(message);
  error.code = code;
  error.status = 401;
  return error;
}

function audienceValues(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  const normalized = String(value || "").trim();
  return normalized ? [normalized] : [];
}

export function verifyTenantGptAccessToken(token, {
  expectedResource = TENANT_GPT_ACTIVATION_RESOURCE,
  nowMs = Date.now(),
  allowLegacyAudience = true,
} = {}) {
  const resource = normalizeTenantGptOAuthResource(expectedResource);
  if (!resource) throw tokenFailure("tenant_gpt_resource_invalid", "Protected resource configuration is invalid.");

  let payload;
  try {
    payload = jwt.verify(String(token || ""), JWT_SECRET, {
      issuer: TENANT_GPT_AUTHORIZATION_SERVER,
    });
  } catch {
    throw tokenFailure("invalid_user_jwt", "User token is invalid or expired.");
  }

  if (payload?.purpose !== "tenant_gpt_access") {
    throw tokenFailure("tenant_gpt_token_purpose_invalid", "User token is not a Tenant GPT access token.");
  }
  if (!payload?.user_id || !payload?.tenant_id) {
    throw tokenFailure("tenant_gpt_token_subject_invalid", "Tenant GPT access token is missing tenant subject claims.");
  }

  const audiences = audienceValues(payload.aud);
  const strictAudienceMatch = audiences.length === 1 && audiences[0] === resource;
  let legacyAudienceAccepted = false;

  if (!strictAudienceMatch && allowLegacyAudience && audiences.length === 1 && audiences[0] === TENANT_GPT_LEGACY_AUDIENCE) {
    const cutoffMs = tenantGptLegacyAudienceCutoffMs();
    const issuedAtMs = Number.isFinite(Number(payload.iat)) ? Number(payload.iat) * 1000 : Number.POSITIVE_INFINITY;
    legacyAudienceAccepted = cutoffMs > 0 && nowMs <= cutoffMs && issuedAtMs <= cutoffMs;
  }

  if (!strictAudienceMatch && !legacyAudienceAccepted) {
    throw tokenFailure("tenant_gpt_token_audience_invalid", "User token is not valid for the Activation protected resource.");
  }

  if (payload.resource && normalizeTenantGptOAuthResource(payload.resource) !== resource) {
    throw tokenFailure("tenant_gpt_token_resource_invalid", "User token resource claim does not match the Activation protected resource.");
  }

  return {
    payload,
    verification: {
      issuer: TENANT_GPT_AUTHORIZATION_SERVER,
      audience: strictAudienceMatch ? resource : TENANT_GPT_LEGACY_AUDIENCE,
      expected_resource: resource,
      legacy_audience_accepted: legacyAudienceAccepted,
      secrets_included: false,
    },
  };
}

export function requireActivationTenantGptAccessToken(req, res, next) {
  const authorization = String(req.headers?.authorization || "");
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  if (!token || token === authorization) {
    return res.status(401).json({
      ok: false,
      error: {
        code: "user_jwt_required",
        message: "A Tenant GPT bearer access token is required.",
        requestId: res.locals?.request_id || null,
      },
      secrets_included: false,
    });
  }

  try {
    const verified = verifyTenantGptAccessToken(token);
    req.auth = {
      mode: "user_jwt",
      user_id: verified.payload.user_id,
      tenant_id: verified.payload.tenant_id,
      is_admin: false,
      token_purpose: verified.payload.purpose,
      token_audience: verified.verification.audience,
      token_resource: verified.verification.expected_resource,
      legacy_audience_accepted: verified.verification.legacy_audience_accepted,
    };
    return next();
  } catch (error) {
    return res.status(error.status || 401).json({
      ok: false,
      error: {
        code: error.code || "invalid_user_jwt",
        message: error.message || "User token is invalid or expired.",
        requestId: res.locals?.request_id || null,
      },
      secrets_included: false,
    });
  }
}
