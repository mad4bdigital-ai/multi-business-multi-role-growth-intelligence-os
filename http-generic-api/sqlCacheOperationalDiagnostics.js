import { performance } from "node:perf_hooks";
import { getSqlCacheRuntimeStatus } from "./sqlCache.js";
import { resolveSqlCacheTablePolicy } from "./sqlCachePolicy.js";

const DEFAULT_THRESHOLDS = Object.freeze({
  minimum_read_samples: 20,
  low_hit_ratio: 0.4,
  high_error_rate: 0.05,
  oversize_cooldown_warning_count: 1,
});

function safeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boundedInt(value, fallback, min, max) {
  return Math.max(min, Math.min(max, Math.floor(safeNumber(value, fallback))));
}

function boundedRatio(value, fallback) {
  return Math.max(0, Math.min(1, safeNumber(value, fallback)));
}

function ratio(numerator, denominator) {
  return denominator > 0 ? Number((numerator / denominator).toFixed(6)) : null;
}

function roundMs(value) {
  return Number(Math.max(0, safeNumber(value)).toFixed(3));
}

function normalizeThresholds(input = {}) {
  return {
    minimum_read_samples: boundedInt(
      input.minimum_read_samples,
      DEFAULT_THRESHOLDS.minimum_read_samples,
      1,
      1_000_000
    ),
    low_hit_ratio: boundedRatio(input.low_hit_ratio, DEFAULT_THRESHOLDS.low_hit_ratio),
    high_error_rate: boundedRatio(input.high_error_rate, DEFAULT_THRESHOLDS.high_error_rate),
    oversize_cooldown_warning_count: boundedInt(
      input.oversize_cooldown_warning_count,
      DEFAULT_THRESHOLDS.oversize_cooldown_warning_count,
      1,
      1_000_000
    ),
  };
}

function operationalAlert({ code, severity, title, summary, evidence = {} }) {
  return {
    code,
    severity,
    title,
    summary,
    evidence,
    secrets_included: false,
  };
}

export function buildSqlCacheOperationalDiagnostics(status = getSqlCacheRuntimeStatus(), options = {}) {
  const thresholds = normalizeThresholds(options.thresholds || options);
  const counters = {
    hits: safeNumber(status?.counters?.hits),
    misses: safeNumber(status?.counters?.misses),
    stores: safeNumber(status?.counters?.stores),
    oversize_skips: safeNumber(status?.counters?.oversize_skips),
    unavailable_skips: safeNumber(status?.counters?.unavailable_skips),
    circuit_open_skips: safeNumber(status?.counters?.circuit_open_skips),
    errors: safeNumber(status?.counters?.errors),
    bypasses: safeNumber(status?.counters?.bypasses),
    single_flight_joins: safeNumber(status?.counters?.single_flight_joins),
  };
  const readSamples = counters.hits + counters.misses;
  const observedOperations = readSamples + counters.stores + counters.errors
    + counters.oversize_skips + counters.unavailable_skips + counters.circuit_open_skips
    + counters.bypasses + counters.single_flight_joins;
  const hitRatio = ratio(counters.hits, readSamples);
  const missRatio = ratio(counters.misses, readSamples);
  const errorRate = ratio(counters.errors, Math.max(observedOperations, 1));
  const alerts = [];

  if (status?.enabled === true && status?.available !== true) {
    alerts.push(operationalAlert({
      code: "sql_cache_unavailable",
      severity: "critical",
      title: "SQL cache is enabled but unavailable",
      summary: "The runtime policy enables SQL cache while the cache transport is not currently available.",
      evidence: {
        redis_enabled: Boolean(status?.redis_enabled),
        redis_url_configured: Boolean(status?.redis_url_configured),
      },
    }));
  }
  if (status?.circuit_open === true) {
    alerts.push(operationalAlert({
      code: "sql_cache_circuit_open",
      severity: "high",
      title: "SQL cache circuit breaker is open",
      summary: "Cache operations are being skipped until the configured retry window expires.",
      evidence: {
        retry_after_ms: safeNumber(status?.circuit_retry_after_ms),
        last_error_code: String(status?.last_error_code || ""),
      },
    }));
  }
  if (status?.policy?.stale === true) {
    alerts.push(operationalAlert({
      code: "sql_cache_policy_stale",
      severity: "high",
      title: "SQL cache runtime policy is stale",
      summary: "The last-known-good policy is active because the MySQL-primary refresh did not succeed.",
      evidence: {
        source: status?.policy?.source || null,
        revision: safeNumber(status?.policy?.revision),
        last_error_code: status?.policy?.last_error_code || null,
      },
    }));
  }
  if (
    readSamples >= thresholds.minimum_read_samples
    && hitRatio !== null
    && hitRatio < thresholds.low_hit_ratio
  ) {
    alerts.push(operationalAlert({
      code: "sql_cache_low_hit_ratio",
      severity: "medium",
      title: "SQL cache hit ratio is below the operational threshold",
      summary: "The cache may be undersized, invalidated too frequently, or serving workloads with low reuse.",
      evidence: {
        hit_ratio: hitRatio,
        read_samples: readSamples,
        threshold: thresholds.low_hit_ratio,
      },
    }));
  }
  if (errorRate !== null && errorRate >= thresholds.high_error_rate && counters.errors > 0) {
    alerts.push(operationalAlert({
      code: "sql_cache_high_error_rate",
      severity: "high",
      title: "SQL cache error rate is above the operational threshold",
      summary: "Cache transport or serialization failures exceed the configured diagnostic threshold.",
      evidence: {
        error_rate: errorRate,
        errors: counters.errors,
        observed_operations: observedOperations,
        threshold: thresholds.high_error_rate,
        last_error_code: String(status?.last_error_code || ""),
      },
    }));
  }
  if (safeNumber(status?.oversize_cooldown_count) >= thresholds.oversize_cooldown_warning_count) {
    alerts.push(operationalAlert({
      code: "sql_cache_oversize_cooldown_active",
      severity: "medium",
      title: "SQL cache oversized-value cooldown is active",
      summary: "One or more keys are temporarily excluded after exceeding the configured maximum cached value size.",
      evidence: {
        cooldown_count: safeNumber(status?.oversize_cooldown_count),
        threshold: thresholds.oversize_cooldown_warning_count,
      },
    }));
  }

  const state = alerts.some((item) => item.severity === "critical")
    ? "critical"
    : alerts.some((item) => item.severity === "high")
      ? "degraded"
      : alerts.length
        ? "warning"
        : "healthy";

  return {
    ok: state === "healthy" || state === "warning",
    monitoring_state: state,
    generated_at: new Date().toISOString(),
    runtime: {
      enabled: Boolean(status?.enabled),
      available: Boolean(status?.available),
      circuit_open: Boolean(status?.circuit_open),
      circuit_retry_after_ms: safeNumber(status?.circuit_retry_after_ms),
      last_error_code: String(status?.last_error_code || ""),
      in_flight_count: safeNumber(status?.in_flight_count),
      oversize_cooldown_count: safeNumber(status?.oversize_cooldown_count),
      single_flight_enabled: Boolean(status?.single_flight_enabled),
    },
    metrics: {
      read_samples: readSamples,
      observed_operations: observedOperations,
      hit_ratio: hitRatio,
      miss_ratio: missRatio,
      error_rate: errorRate,
      counters,
    },
    thresholds,
    policy: status?.policy || null,
    alerts,
    source_authority: "process_runtime_counters_plus_mysql_primary_policy",
    persistence: "process_lifetime_counters",
    secrets_included: false,
  };
}

function delay(ms) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

async function runWithConcurrency(total, concurrency, worker) {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(total, concurrency) }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= total) return;
      await worker(index);
    }
  });
  await Promise.all(runners);
}

export async function runSqlCacheControlledLoadTest(input = {}) {
  const iterations = boundedInt(input.iterations, 100, 10, 2000);
  const concurrency = boundedInt(input.concurrency, 20, 1, 200);
  const loaderDelayMs = boundedInt(input.loader_delay_ms, 5, 0, 100);
  const payloadBytes = boundedInt(input.payload_bytes, 1024, 16, 262144);
  const payload = { value: "x".repeat(payloadBytes) };

  let baselineLoaderCalls = 0;
  const baselineStarted = performance.now();
  await runWithConcurrency(iterations, concurrency, async () => {
    baselineLoaderCalls += 1;
    await delay(loaderDelayMs);
    return payload;
  });
  const baselineElapsedMs = performance.now() - baselineStarted;

  const isolatedCache = new Map();
  const isolatedInflight = new Map();
  let cachedLoaderCalls = 0;
  let cacheHits = 0;
  let singleFlightJoins = 0;
  const cacheKey = "isolated:sql-cache-load-test:workflows";
  async function isolatedRead() {
    if (isolatedCache.has(cacheKey)) {
      cacheHits += 1;
      return isolatedCache.get(cacheKey);
    }
    if (isolatedInflight.has(cacheKey)) {
      singleFlightJoins += 1;
      return isolatedInflight.get(cacheKey);
    }
    const pending = (async () => {
      cachedLoaderCalls += 1;
      await delay(loaderDelayMs);
      isolatedCache.set(cacheKey, payload);
      return payload;
    })();
    isolatedInflight.set(cacheKey, pending);
    try {
      return await pending;
    } finally {
      isolatedInflight.delete(cacheKey);
    }
  }

  const cachedStarted = performance.now();
  await runWithConcurrency(iterations, concurrency, isolatedRead);
  const cachedElapsedMs = performance.now() - cachedStarted;

  const allowedPolicy = resolveSqlCacheTablePolicy("workflows", { requestedTtlSeconds: 60 });
  const blockedPolicy = resolveSqlCacheTablePolicy("endpoints", { requestedTtlSeconds: 60 });
  let blockedFallbackLoaderCalls = 0;
  if (!blockedPolicy.enabled) {
    blockedFallbackLoaderCalls += 1;
    await delay(Math.min(loaderDelayMs, 10));
  }

  return {
    ok: true,
    mode: "isolated_in_memory",
    production_redis_touched: false,
    production_database_touched: false,
    iterations,
    concurrency,
    loader_delay_ms: loaderDelayMs,
    payload_bytes: payloadBytes,
    baseline: {
      elapsed_ms: roundMs(baselineElapsedMs),
      loader_calls: baselineLoaderCalls,
      requests_per_second: baselineElapsedMs > 0
        ? Number((iterations / (baselineElapsedMs / 1000)).toFixed(3))
        : null,
    },
    cached: {
      elapsed_ms: roundMs(cachedElapsedMs),
      loader_calls: cachedLoaderCalls,
      cache_hits: cacheHits,
      single_flight_joins: singleFlightJoins,
      requests_per_second: cachedElapsedMs > 0
        ? Number((iterations / (cachedElapsedMs / 1000)).toFixed(3))
        : null,
    },
    comparison: {
      elapsed_reduction_ratio: baselineElapsedMs > 0
        ? Number(((baselineElapsedMs - cachedElapsedMs) / baselineElapsedMs).toFixed(6))
        : null,
      loader_call_reduction_ratio: baselineLoaderCalls > 0
        ? Number(((baselineLoaderCalls - cachedLoaderCalls) / baselineLoaderCalls).toFixed(6))
        : null,
    },
    policy_guards: {
      allowed_table: {
        table: allowedPolicy.table,
        enabled: allowedPolicy.enabled,
        reason: allowedPolicy.reason,
      },
      security_denylist: {
        table: blockedPolicy.table,
        enabled: blockedPolicy.enabled,
        security_denied: blockedPolicy.security_denied,
        reason: blockedPolicy.reason,
        fallback_loader_calls: blockedFallbackLoaderCalls,
      },
    },
    secrets_included: false,
  };
}
