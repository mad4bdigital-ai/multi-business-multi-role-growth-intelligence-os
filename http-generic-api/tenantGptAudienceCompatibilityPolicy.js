export const TENANT_GPT_AUDIENCE_COMPATIBILITY_METRIC =
  "tenant_gpt_audience_compatibility_total";

export const TENANT_GPT_AUDIENCE_COMPATIBILITY_CLASSIFICATIONS = Object.freeze({
  STRICT_ACCEPTED: "strict_resource_audience_accepted",
  LEGACY_ACCEPTED: "legacy_audience_accepted_before_cutoff",
  LEGACY_DISABLED: "legacy_audience_rejected_disabled",
  LEGACY_CUTOFF_UNCONFIGURED: "legacy_audience_rejected_cutoff_unconfigured",
  LEGACY_CUTOFF_ELAPSED: "legacy_audience_rejected_cutoff_elapsed",
  LEGACY_IAT_INVALID: "legacy_audience_rejected_iat_invalid",
  LEGACY_IAT_FUTURE: "legacy_audience_rejected_iat_future",
  LEGACY_ISSUED_AFTER_CUTOFF: "legacy_audience_rejected_issued_after_cutoff",
  MULTI_AUDIENCE: "multi_audience_rejected",
  AUDIENCE_MISMATCH: "audience_mismatch_rejected",
  RESOURCE_MISMATCH: "token_resource_mismatch_rejected",
});

const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const DEFAULT_CLOCK_SKEW_MS = MAX_CLOCK_SKEW_MS;

function finiteMs(value, fallback = 0) {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : fallback;
}

function audienceValues(value) {
  const raw = Array.isArray(value) ? value : [value];
  return raw
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, 8);
}

function cutoffIso(cutoffMs) {
  try {
    return cutoffMs > 0 ? new Date(cutoffMs).toISOString() : null;
  } catch {
    return null;
  }
}

function decision({
  accepted,
  classification,
  audienceMode,
  legacyAudiencePresent,
  cutoffState,
  cutoffMs,
} = {}) {
  const outcome = accepted ? "accepted" : "rejected";
  return Object.freeze({
    accepted: accepted === true,
    classification,
    audience_mode: audienceMode,
    legacy_audience_present: legacyAudiencePresent === true,
    legacy_audience_accepted: accepted === true && audienceMode === "legacy",
    cutoff_state: cutoffState,
    cutoff_at: cutoffIso(cutoffMs),
    metric: Object.freeze({
      name: TENANT_GPT_AUDIENCE_COMPATIBILITY_METRIC,
      value: 1,
      labels: Object.freeze({
        classification,
        outcome,
        audience_mode: audienceMode,
        cutoff_state: cutoffState,
      }),
    }),
    secrets_included: false,
  });
}

export function classifyTenantGptAudienceCompatibility({
  audience,
  expectedResource,
  legacyAudience,
  allowLegacyAudience = true,
  cutoffMs,
  nowMs = Date.now(),
  issuedAtSeconds,
  clockSkewMs = DEFAULT_CLOCK_SKEW_MS,
} = {}) {
  const audiences = audienceValues(audience);
  const resource = String(expectedResource || "").trim();
  const legacy = String(legacyAudience || "").trim();
  const normalizedCutoffMs = finiteMs(cutoffMs, 0);
  const normalizedNowMs = finiteMs(nowMs, Date.now());
  const normalizedClockSkewMs = Math.min(
    MAX_CLOCK_SKEW_MS,
    Math.max(0, finiteMs(clockSkewMs, DEFAULT_CLOCK_SKEW_MS)),
  );
  const legacyAudiencePresent = Boolean(legacy && audiences.includes(legacy));

  if (audiences.length !== 1) {
    return decision({
      accepted: false,
      classification: TENANT_GPT_AUDIENCE_COMPATIBILITY_CLASSIFICATIONS.MULTI_AUDIENCE,
      audienceMode: legacyAudiencePresent ? "legacy_mixed" : "multiple",
      legacyAudiencePresent,
      cutoffState: "not_evaluated",
      cutoffMs: normalizedCutoffMs,
    });
  }

  if (audiences[0] === resource) {
    return decision({
      accepted: true,
      classification: TENANT_GPT_AUDIENCE_COMPATIBILITY_CLASSIFICATIONS.STRICT_ACCEPTED,
      audienceMode: "strict",
      legacyAudiencePresent: false,
      cutoffState: "not_applicable",
      cutoffMs: normalizedCutoffMs,
    });
  }

  if (!legacy || audiences[0] !== legacy) {
    return decision({
      accepted: false,
      classification: TENANT_GPT_AUDIENCE_COMPATIBILITY_CLASSIFICATIONS.AUDIENCE_MISMATCH,
      audienceMode: "other",
      legacyAudiencePresent: false,
      cutoffState: "not_applicable",
      cutoffMs: normalizedCutoffMs,
    });
  }

  if (!allowLegacyAudience) {
    return decision({
      accepted: false,
      classification: TENANT_GPT_AUDIENCE_COMPATIBILITY_CLASSIFICATIONS.LEGACY_DISABLED,
      audienceMode: "legacy",
      legacyAudiencePresent: true,
      cutoffState: "disabled",
      cutoffMs: normalizedCutoffMs,
    });
  }

  if (!(normalizedCutoffMs > 0)) {
    return decision({
      accepted: false,
      classification: TENANT_GPT_AUDIENCE_COMPATIBILITY_CLASSIFICATIONS.LEGACY_CUTOFF_UNCONFIGURED,
      audienceMode: "legacy",
      legacyAudiencePresent: true,
      cutoffState: "unconfigured",
      cutoffMs: normalizedCutoffMs,
    });
  }

  if (normalizedNowMs > normalizedCutoffMs) {
    return decision({
      accepted: false,
      classification: TENANT_GPT_AUDIENCE_COMPATIBILITY_CLASSIFICATIONS.LEGACY_CUTOFF_ELAPSED,
      audienceMode: "legacy",
      legacyAudiencePresent: true,
      cutoffState: "elapsed",
      cutoffMs: normalizedCutoffMs,
    });
  }

  const issuedAt = Number(issuedAtSeconds);
  if (!Number.isFinite(issuedAt) || issuedAt <= 0) {
    return decision({
      accepted: false,
      classification: TENANT_GPT_AUDIENCE_COMPATIBILITY_CLASSIFICATIONS.LEGACY_IAT_INVALID,
      audienceMode: "legacy",
      legacyAudiencePresent: true,
      cutoffState: "active",
      cutoffMs: normalizedCutoffMs,
    });
  }

  const issuedAtMs = issuedAt * 1000;
  if (issuedAtMs > normalizedNowMs + normalizedClockSkewMs) {
    return decision({
      accepted: false,
      classification: TENANT_GPT_AUDIENCE_COMPATIBILITY_CLASSIFICATIONS.LEGACY_IAT_FUTURE,
      audienceMode: "legacy",
      legacyAudiencePresent: true,
      cutoffState: "active",
      cutoffMs: normalizedCutoffMs,
    });
  }

  if (issuedAtMs > normalizedCutoffMs) {
    return decision({
      accepted: false,
      classification: TENANT_GPT_AUDIENCE_COMPATIBILITY_CLASSIFICATIONS.LEGACY_ISSUED_AFTER_CUTOFF,
      audienceMode: "legacy",
      legacyAudiencePresent: true,
      cutoffState: "active",
      cutoffMs: normalizedCutoffMs,
    });
  }

  return decision({
    accepted: true,
    classification: TENANT_GPT_AUDIENCE_COMPATIBILITY_CLASSIFICATIONS.LEGACY_ACCEPTED,
    audienceMode: "legacy",
    legacyAudiencePresent: true,
    cutoffState: "active",
    cutoffMs: normalizedCutoffMs,
  });
}

export function rejectTenantGptAudienceCompatibilityForResourceMismatch(input = {}) {
  return decision({
    accepted: false,
    classification: TENANT_GPT_AUDIENCE_COMPATIBILITY_CLASSIFICATIONS.RESOURCE_MISMATCH,
    audienceMode: input.audience_mode || "unknown",
    legacyAudiencePresent: input.legacy_audience_present === true,
    cutoffState: input.cutoff_state || "not_evaluated",
    cutoffMs: input.cutoff_at ? Date.parse(input.cutoff_at) : 0,
  });
}

export function recordTenantGptAudienceCompatibilityEvidence(input, {
  logger = console,
} = {}) {
  const evidence = input && typeof input === "object" ? input : null;
  if (!evidence?.metric || evidence.secrets_included !== false) return false;

  // Strict acceptance is represented in req.auth and remains available to a
  // caller-supplied metrics sink. The default logger records only compatibility
  // use or rejection so ordinary protected traffic does not become log noise.
  if (evidence.accepted && !evidence.legacy_audience_present) return true;

  const method = evidence.accepted ? "info" : "warn";
  const writer = typeof logger?.[method] === "function" ? logger[method].bind(logger) : null;
  if (!writer) return false;
  writer("tenant_gpt_audience_compatibility", {
    metric_name: evidence.metric.name,
    metric_value: evidence.metric.value,
    labels: evidence.metric.labels,
    cutoff_at: evidence.cutoff_at,
    legacy_audience_present: evidence.legacy_audience_present,
    secrets_included: false,
  });
  return true;
}

export { DEFAULT_CLOCK_SKEW_MS, MAX_CLOCK_SKEW_MS };
