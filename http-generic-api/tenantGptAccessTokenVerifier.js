import jwt from "jsonwebtoken";
import {
  TENANT_GPT_ACTIVATION_RESOURCE,
  TENANT_GPT_AUTHORIZATION_SERVER,
  TENANT_GPT_LEGACY_AUDIENCE,
  normalizeTenantGptOAuthResource,
  tenantGptLegacyAudienceCutoffMs,
} from "./tenantGptOAuthResourceProfile.js";
import {
  classifyTenantGptAudienceCompatibility,
  recordTenantGptAudienceCompatibilityEvidence,
  rejectTenantGptAudienceCompatibilityForResourceMismatch,
} from "./tenantGptAudienceCompatibilityPolicy.js";

const JWT_SECRET = process.env.JWT_SECRET || "development_fallback_secret_only";

function tokenFailure(code, message) {
  const error = new Error(message);
  error.code = code;
  error.status = 401;
  return error;
}

function emitCompatibilityEvidence(evidence, callback) {
  if (typeof callback !== "function") return;
  try {
    callback(evidence);
  } catch (error) {
    console.warn("tenant_gpt_audience_compatibility_evidence_failed", {
      code: String(error?.code || "compatibility_evidence_failed").slice(0, 64),
      secrets_included: false,
    });
  }
}

export function verifyTenantGptAccessToken(token, {
  expectedResource = TENANT_GPT_ACTIVATION_RESOURCE,
  nowMs = Date.now(),
  allowLegacyAudience = true,
  legacyAudienceCutoffMs = tenantGptLegacyAudienceCutoffMs(),
  compatibilityClockSkewMs,
  onCompatibilityEvidence = recordTenantGptAudienceCompatibilityEvidence,
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

  const compatibility = classifyTenantGptAudienceCompatibility({
    audience: payload.aud,
    expectedResource: resource,
    legacyAudience: TENANT_GPT_LEGACY_AUDIENCE,
    allowLegacyAudience,
    cutoffMs: legacyAudienceCutoffMs,
    nowMs,
    issuedAtSeconds: payload.iat,
    ...(compatibilityClockSkewMs === undefined ? {} : { clockSkewMs: compatibilityClockSkewMs }),
  });

  if (!compatibility.accepted) {
    emitCompatibilityEvidence(compatibility, onCompatibilityEvidence);
    throw tokenFailure("tenant_gpt_token_audience_invalid", "User token is not valid for the Activation protected resource.");
  }

  if (payload.resource && normalizeTenantGptOAuthResource(payload.resource) !== resource) {
    emitCompatibilityEvidence(
      rejectTenantGptAudienceCompatibilityForResourceMismatch(compatibility),
      onCompatibilityEvidence,
    );
    throw tokenFailure("tenant_gpt_token_resource_invalid", "User token resource claim does not match the Activation protected resource.");
  }

  emitCompatibilityEvidence(compatibility, onCompatibilityEvidence);
  return {
    payload,
    verification: {
      issuer: TENANT_GPT_AUTHORIZATION_SERVER,
      audience: compatibility.audience_mode === "strict" ? resource : TENANT_GPT_LEGACY_AUDIENCE,
      expected_resource: resource,
      audience_mode: compatibility.audience_mode,
      audience_compatibility_classification: compatibility.classification,
      legacy_audience_accepted: compatibility.legacy_audience_accepted,
      legacy_audience_cutoff_state: compatibility.cutoff_state,
      legacy_audience_cutoff_at: compatibility.cutoff_at,
      compatibility_metric_name: compatibility.metric.name,
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
      audience_mode: verified.verification.audience_mode,
      audience_compatibility_classification: verified.verification.audience_compatibility_classification,
      legacy_audience_accepted: verified.verification.legacy_audience_accepted,
      legacy_audience_cutoff_state: verified.verification.legacy_audience_cutoff_state,
      legacy_audience_cutoff_at: verified.verification.legacy_audience_cutoff_at,
      compatibility_metric_name: verified.verification.compatibility_metric_name,
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
