import jwt from "jsonwebtoken";
import {
  recordTenantGptAccessTokenProfileEvidence,
  validateTenantGptAccessTokenProfile,
} from "./tenantGptAccessTokenProfile.js";
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

const JWT_SECRET_MAX_LENGTH = 4096;

function tokenFailure(code, message, status = 401) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function requireTenantGptJwtSecret() {
  const secret = String(process.env.JWT_SECRET || "").trim();
  if (!secret || secret.length > JWT_SECRET_MAX_LENGTH) {
    throw tokenFailure(
      "tenant_gpt_verifier_unavailable",
      "Tenant GPT token verification is temporarily unavailable.",
      503,
    );
  }
  return secret;
}

function emitEvidence(evidence, callback, failureCode) {
  if (typeof callback !== "function") return;
  try {
    callback(evidence);
  } catch (error) {
    console.warn(failureCode, {
      code: String(error?.code || "evidence_failed").slice(0, 64),
      secrets_included: false,
    });
  }
}

function profileFailure(profile) {
  if (["user_claim_invalid", "tenant_claim_invalid", "subject_claim_invalid"].includes(profile.classification)) {
    return tokenFailure(
      "tenant_gpt_token_subject_invalid",
      "Tenant GPT access token subject claims are invalid.",
    );
  }
  return tokenFailure(
    "tenant_gpt_token_lifetime_invalid",
    "Tenant GPT access token lifetime or required profile claims are invalid.",
  );
}

export function verifyTenantGptAccessToken(token, {
  expectedResource = TENANT_GPT_ACTIVATION_RESOURCE,
  nowMs = Date.now(),
  allowLegacyAudience = true,
  legacyAudienceCutoffMs = tenantGptLegacyAudienceCutoffMs(),
  compatibilityClockSkewMs,
  onCompatibilityEvidence = recordTenantGptAudienceCompatibilityEvidence,
  onTokenProfileEvidence = recordTenantGptAccessTokenProfileEvidence,
} = {}) {
  const resource = normalizeTenantGptOAuthResource(expectedResource);
  if (!resource) throw tokenFailure("tenant_gpt_resource_invalid", "Protected resource configuration is invalid.");

  const jwtSecret = requireTenantGptJwtSecret();
  let payload;
  try {
    payload = jwt.verify(String(token || ""), jwtSecret, {
      issuer: TENANT_GPT_AUTHORIZATION_SERVER,
      clockTimestamp: Math.floor(Number(nowMs) / 1000),
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
    emitEvidence(
      compatibility,
      onCompatibilityEvidence,
      "tenant_gpt_audience_compatibility_evidence_failed",
    );
    throw tokenFailure("tenant_gpt_token_audience_invalid", "User token is not valid for the Activation protected resource.");
  }

  if (payload.resource && normalizeTenantGptOAuthResource(payload.resource) !== resource) {
    emitEvidence(
      rejectTenantGptAudienceCompatibilityForResourceMismatch(compatibility),
      onCompatibilityEvidence,
      "tenant_gpt_audience_compatibility_evidence_failed",
    );
    throw tokenFailure("tenant_gpt_token_resource_invalid", "User token resource claim does not match the Activation protected resource.");
  }

  const verifiedAudience = compatibility.audience_mode === "strict"
    ? resource
    : TENANT_GPT_LEGACY_AUDIENCE;
  const tokenProfile = validateTenantGptAccessTokenProfile(payload, {
    expectedIssuer: TENANT_GPT_AUTHORIZATION_SERVER,
    expectedAudience: verifiedAudience,
    audienceMode: compatibility.audience_mode,
    nowMs,
  });
  emitEvidence(
    tokenProfile,
    onTokenProfileEvidence,
    "tenant_gpt_access_token_profile_evidence_failed",
  );
  if (!tokenProfile.accepted) throw profileFailure(tokenProfile);

  emitEvidence(
    compatibility,
    onCompatibilityEvidence,
    "tenant_gpt_audience_compatibility_evidence_failed",
  );
  return {
    payload,
    verification: {
      issuer: TENANT_GPT_AUTHORIZATION_SERVER,
      audience: verifiedAudience,
      expected_resource: resource,
      audience_mode: compatibility.audience_mode,
      audience_compatibility_classification: compatibility.classification,
      legacy_audience_accepted: compatibility.legacy_audience_accepted,
      legacy_audience_cutoff_state: compatibility.cutoff_state,
      legacy_audience_cutoff_at: compatibility.cutoff_at,
      compatibility_metric_name: compatibility.metric.name,
      bearer_profile_classification: tokenProfile.classification,
      bearer_profile_metric_name: tokenProfile.metric.name,
      issuer_verified: tokenProfile.issuer_verified,
      audience_verified: tokenProfile.audience_verified,
      subject_verified: tokenProfile.subject_verified,
      user_claim_present: tokenProfile.user_claim_present,
      tenant_claim_present: tokenProfile.tenant_claim_present,
      issued_at_present: tokenProfile.issued_at_present,
      expiry_present: tokenProfile.expiry_present,
      lifetime_seconds: tokenProfile.lifetime_seconds,
      remaining_seconds: tokenProfile.remaining_seconds,
      max_lifetime_seconds: tokenProfile.max_lifetime_seconds,
      short_lived: tokenProfile.short_lived,
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
      bearer_profile_classification: verified.verification.bearer_profile_classification,
      bearer_profile_metric_name: verified.verification.bearer_profile_metric_name,
      issuer_verified: verified.verification.issuer_verified,
      audience_verified: verified.verification.audience_verified,
      subject_verified: verified.verification.subject_verified,
      user_claim_present: verified.verification.user_claim_present,
      tenant_claim_present: verified.verification.tenant_claim_present,
      issued_at_present: verified.verification.issued_at_present,
      expiry_present: verified.verification.expiry_present,
      lifetime_seconds: verified.verification.lifetime_seconds,
      remaining_seconds: verified.verification.remaining_seconds,
      max_lifetime_seconds: verified.verification.max_lifetime_seconds,
      short_lived: verified.verification.short_lived,
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

export { JWT_SECRET_MAX_LENGTH };
