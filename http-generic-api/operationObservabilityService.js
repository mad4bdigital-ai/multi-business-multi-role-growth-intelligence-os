import { buildCapabilityDriftSignals } from "./capabilityDriftSignalProjection.js";

const ADMIN_MODES = new Set(["backend_api", "admin", "service", "service_account"]);

function fail(status, code, message, details = null) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = details;
  return error;
}

function text(value, max = 255) {
  return String(value ?? "").trim().slice(0, max);
}

function boundedInt(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.max(min, Math.min(Math.floor(number), max))
    : fallback;
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function principal(auth = {}) {
  const mode = text(auth.mode || auth.caller_type, 64).toLowerCase();
  if (auth.is_admin === true || ADMIN_MODES.has(mode)) {
    return {
      scope: "admin",
      tenant_id: null,
      user_id: text(auth.user_id || auth.admin_id, 64) || null,
    };
  }
  if (mode === "user_jwt" && auth.tenant_id && auth.user_id) {
    return {
      scope: "tenant",
      tenant_id: text(auth.tenant_id, 64),
      user_id: text(auth.user_id, 64),
    };
  }
  throw fail(
    403,
    "OPERATION_OBSERVABILITY_PRINCIPAL_NOT_ALLOWED",
    "An authenticated Admin or Tenant principal is required.",
  );
}

function percentile(values, percentileValue) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1),
  );
  return sorted[index];
}

function isFailure(row = {}) {
  const status = text(row.execution_status, 128).toLowerCase();
  const routeStatus = text(row.route_status, 128).toLowerCase();
  return Boolean(
    row.failure_reason
    || ["failed", "error", "blocked", "rejected", "denied"].some((token) =>
      status.includes(token) || routeStatus.includes(token)
    )
  );
}

function isRetry(row = {}) {
  const combined = [
    row.recovery_status,
    row.recovery_action,
    row.execution_status,
    row.failure_reason,
  ].map((value) => text(value, 512).toLowerCase()).join(" ");
  return /retry|retried|backoff|half[-_ ]?open|recover/.test(combined);
}

function isDiscovery(row = {}) {
  const combined = [
    row.action_key,
    row.tool_key,
    row.endpoint_key,
    row.route_id,
    row.source_layer,
  ].map((value) => text(value, 255).toLowerCase()).join(" ");
  return /catalog|discover|resolve|context|preview|status|get_|_get|list|search|inspect/.test(combined);
}

function isInternalCall(row = {}) {
  return Boolean(
    text(row.parent_action_key, 191)
    || text(row.endpoint_key, 191)
    || text(row.tool_key, 191)
  );
}

function failureCategory(row = {}) {
  const combined = [
    row.failure_reason,
    row.recovery_action,
    row.execution_status,
    row.route_status,
  ].map((value) => text(value, 512).toLowerCase()).join(" ");
  if (/401|403|auth|forbidden|permission|denied/.test(combined)) return "authorization";
  if (/429|rate.?limit|throttl/.test(combined)) return "rate_limit";
  if (/timeout|timed.?out|deadline/.test(combined)) return "timeout";
  if (/schema|contract|validation|parse|json/.test(combined)) return "contract";
  if (/dependency|provider|upstream|unavailable|502|503|504|network/.test(combined)) return "dependency";
  return "other";
}

function rounded(value, digits = 2) {
  return Number(finiteNumber(value).toFixed(digits));
}

export function buildOperationObservabilityDashboard(rows = [], {
  principalScope = "admin",
  tenantId = null,
  hours = 24,
  sampleLimit = 5000,
  generatedAt = new Date(),
  capabilityGapRows = [],
  capabilityGapSource = null,
} = {}) {
  const normalized = Array.isArray(rows) ? rows : [];
  const latencies = normalized
    .map((row) => finiteNumber(row.duration_seconds) * 1000)
    .filter((value) => value >= 0);

  const failureRows = normalized.filter(isFailure);
  const retryRows = normalized.filter(isRetry);
  const discoveryRows = normalized.filter(isDiscovery);
  const internalRows = normalized.filter(isInternalCall);
  const capabilityDriftSignals = buildCapabilityDriftSignals(capabilityGapRows, {
    principalScope,
    tenantId,
    generatedAt,
  });
  const successCount = Math.max(0, normalized.length - failureRows.length);
  const failureCategories = {
    authorization: 0,
    rate_limit: 0,
    timeout: 0,
    contract: 0,
    dependency: 0,
    other: 0,
  };
  for (const row of failureRows) {
    failureCategories[failureCategory(row)] += 1;
  }

  const average = latencies.length
    ? latencies.reduce((sum, value) => sum + value, 0) / latencies.length
    : 0;
  const total = normalized.length;
  const retryRecoverySuccess = retryRows.filter((row) =>
    /success|recovered|completed/.test(text(row.recovery_status, 128).toLowerCase())
  ).length;

  return {
    ok: true,
    dashboard_key: "operation_execution_observability",
    principal_scope: principalScope,
    window: {
      hours,
      generated_at: generatedAt.toISOString(),
      sample_limit: sampleLimit,
      sample_count: total,
      truncated: total >= sampleLimit,
    },
    summary: {
      total_events: total,
      successful_events: successCount,
      failed_events: failureRows.length,
      failure_rate: total ? rounded(failureRows.length / total, 4) : 0,
      average_latency_ms: rounded(average),
      p95_latency_ms: rounded(percentile(latencies, 95)),
      max_latency_ms: rounded(latencies.length ? Math.max(...latencies) : 0),
      internal_call_count: internalRows.length,
      discovery_call_count: discoveryRows.length,
      retry_count: retryRows.length,
      capability_drift_signal_count: capabilityDriftSignals.length,
    },
    panels: [
      {
        panel_key: "latency",
        metrics: {
          sample_count: latencies.length,
          average_ms: rounded(average),
          p50_ms: rounded(percentile(latencies, 50)),
          p95_ms: rounded(percentile(latencies, 95)),
          max_ms: rounded(latencies.length ? Math.max(...latencies) : 0),
        },
      },
      {
        panel_key: "internal_calls",
        metrics: {
          count: internalRows.length,
          provider_call_count: internalRows.filter((row) => text(row.parent_action_key, 191)).length,
          endpoint_call_count: internalRows.filter((row) => text(row.endpoint_key, 191)).length,
          tool_call_count: internalRows.filter((row) => text(row.tool_key, 191)).length,
        },
      },
      {
        panel_key: "discovery",
        metrics: {
          count: discoveryRows.length,
          rate: total ? rounded(discoveryRows.length / total, 4) : 0,
        },
      },
      {
        panel_key: "retries",
        metrics: {
          count: retryRows.length,
          recovery_success_count: retryRecoverySuccess,
          recovery_success_rate: retryRows.length
            ? rounded(retryRecoverySuccess / retryRows.length, 4)
            : 0,
        },
      },
      {
        panel_key: "failures",
        metrics: {
          count: failureRows.length,
          rate: total ? rounded(failureRows.length / total, 4) : 0,
          categories: failureCategories,
        },
      },
    ],
    signals: {
      capability_drift: capabilityDriftSignals,
    },
    signal_sources: {
      capability_drift: capabilityGapSource || {
        ok: true,
        degraded: false,
        authority: "mysql_primary",
        source: "v_platform_capability_gaps",
        row_count: capabilityDriftSignals.length,
        error: null,
      },
    },
    source: {
      authority: "mysql_primary",
      table: "execution_log",
      aggregate_only: true,
      raw_payloads_included: false,
    },
    secrets_included: false,
  };
}

export async function getOperationObservabilityDashboard(input = {}, deps = {}) {
  const actor = principal(deps.auth || {});
  const hours = boundedInt(input.hours, 24, 1, 720);
  const sampleLimit = boundedInt(input.sample_limit || input.sampleLimit, 5000, 100, 10000);
  if (!deps.pool || typeof deps.pool.query !== "function") {
    throw fail(
      500,
      "OPERATION_OBSERVABILITY_POOL_REQUIRED",
      "Operation observability requires a database pool.",
    );
  }

  const params = [hours];
  let principalClause = "";
  if (actor.scope === "tenant") {
    principalClause = "AND tenant_id = ? AND user_id = ?";
    params.push(actor.tenant_id, actor.user_id);
  }
  params.push(sampleLimit);

  let rows;
  try {
    [rows] = await deps.pool.query(
      `SELECT id, duration_seconds, entry_type, execution_class, source_layer,
              execution_status, recovery_status, route_status, failure_reason,
              recovery_action, route_id, parent_action_key, endpoint_key,
              tool_key, action_key, created_at
         FROM execution_log
        WHERE created_at >= TIMESTAMPADD(HOUR, -?, NOW())
          ${principalClause}
          AND (
            parent_action_key = 'github_api_mcp'
            OR action_key LIKE 'repo.%'
            OR action_key LIKE 'operation.%'
            OR tool_key LIKE 'operation_%'
            OR source_layer LIKE '%operation%'
          )
        ORDER BY id DESC
        LIMIT ?`,
      params,
    );
  } catch (cause) {
    throw fail(
      503,
      "OPERATION_OBSERVABILITY_UNAVAILABLE",
      "Operation observability data is temporarily unavailable.",
      { cause_code: cause?.code || null, retryable: true },
    );
  }

  const generatedAt = deps.now instanceof Date ? deps.now : new Date();
  let capabilityGapRows = [];
  let capabilityGapSource;
  try {
    [capabilityGapRows] = await deps.pool.query(
      `SELECT g.capability_key, g.gap_key, g.gap_severity, g.gap_description,
              c.display_name, c.capability_family, c.source_table, c.source_key,
              c.runtime_status, c.exposure_scope, c.operation_class, c.risk_class,
              c.evidence_ref, m.maturity_status, m.maturity_score, m.gap_flags
         FROM v_platform_capability_gaps g
         JOIN v_platform_capabilities_current c ON c.capability_key = g.capability_key
         LEFT JOIN v_platform_capability_maturity m ON m.capability_key = g.capability_key
        WHERE 1 = 1
          ${actor.scope === "tenant" ? "AND c.exposure_scope = 'tenant'" : ""}
        ORDER BY FIELD(g.gap_severity, 'critical', 'high', 'medium', 'low', 'info'), g.capability_key ASC, g.gap_key ASC
        LIMIT 250`,
      [],
    );
    capabilityGapSource = {
      ok: true,
      degraded: false,
      authority: "mysql_primary",
      source: "v_platform_capability_gaps",
      row_count: Array.isArray(capabilityGapRows) ? capabilityGapRows.length : 0,
      error: null,
    };
  } catch (cause) {
    capabilityGapRows = [];
    capabilityGapSource = {
      ok: false,
      degraded: true,
      authority: "mysql_primary",
      source: "v_platform_capability_gaps",
      row_count: 0,
      error: { code: cause?.code || "capability_drift_source_unavailable" },
    };
  }

  return buildOperationObservabilityDashboard(rows, {
    principalScope: actor.scope,
    tenantId: actor.tenant_id,
    hours,
    sampleLimit,
    generatedAt,
    capabilityGapRows,
    capabilityGapSource,
  });
}

export const _testingOperationObservabilityService = {
  principal,
  percentile,
  isFailure,
  isRetry,
  isDiscovery,
  isInternalCall,
  failureCategory,
  boundedInt,
};
