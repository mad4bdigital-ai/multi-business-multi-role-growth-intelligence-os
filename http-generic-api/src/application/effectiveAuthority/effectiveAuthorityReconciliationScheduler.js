function truthy(value) {
  return ["1", "true", "yes", "y", "enabled", "active"].includes(
    String(value ?? "").trim().toLowerCase()
  );
}

function boundedIntervalSeconds(value, fallback = 900) {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.floor(parsed), 300), 86400);
}

function safeErrorCode(error) {
  const code = String(error?.code || "AUTHORITY_RECONCILIATION_FAILED").trim();
  return /^[A-Z0-9_]{1,191}$/.test(code) ? code : "AUTHORITY_RECONCILIATION_FAILED";
}

export function createEffectiveAuthorityReconciliationScheduler({
  runReconciliation,
  env = process.env,
  logger = console,
  setIntervalFn = globalThis.setInterval,
  clearIntervalFn = globalThis.clearInterval,
  now = () => new Date(),
} = {}) {
  if (typeof runReconciliation !== "function") {
    throw new TypeError("Effective authority reconciliation scheduler requires runReconciliation().");
  }

  function start() {
    if (!truthy(env.UEACP_RECONCILIATION_ENABLED)) {
      return Object.freeze({
        status: "disabled",
        enabled: false,
        persist: false,
        interval_seconds: null,
        secrets_included: false,
      });
    }

    const intervalSeconds = boundedIntervalSeconds(
      env.UEACP_RECONCILIATION_INTERVAL_SECONDS,
      900
    );
    const persist = truthy(env.UEACP_RECONCILIATION_PERSIST);
    const limit = Math.min(
      Math.max(Number.parseInt(String(env.UEACP_RECONCILIATION_LIMIT || "50"), 10) || 50, 1),
      200
    );
    let running = false;
    let stopped = false;

    async function runOnce() {
      if (stopped) {
        return Object.freeze({ status: "skipped", reason: "scheduler_stopped" });
      }
      if (running) {
        return Object.freeze({ status: "skipped", reason: "overlap_prevented" });
      }
      running = true;
      const startedAt = now();
      try {
        const result = await runReconciliation({ limit, persist });
        if (typeof logger?.info === "function") {
          logger.info({
            event: "ueacp_reconciliation_tick",
            status: result.status,
            mode: result.mode,
            summary: result.summary,
            startedAt:
              startedAt instanceof Date ? startedAt.toISOString() : new Date(startedAt).toISOString(),
            secretsIncluded: false,
          });
        }
        return result;
      } catch (error) {
        const degraded = Object.freeze({
          ok: false,
          status: "degraded",
          error_code: safeErrorCode(error),
          mode: persist ? "persist" : "preview",
          provider_calls: false,
          credential_payload_reads: false,
          external_writes: false,
          secrets_included: false,
        });
        if (typeof logger?.error === "function") {
          logger.error({
            event: "ueacp_reconciliation_tick_failed",
            code: degraded.error_code,
            secretsIncluded: false,
          });
        }
        return degraded;
      } finally {
        running = false;
      }
    }

    const timer = setIntervalFn(() => {
      void runOnce();
    }, intervalSeconds * 1000);
    timer?.unref?.();

    if (truthy(env.UEACP_RECONCILIATION_RUN_ON_START)) {
      void runOnce();
    }

    return Object.freeze({
      status: "scheduled",
      enabled: true,
      persist,
      interval_seconds: intervalSeconds,
      limit,
      runOnce,
      stop() {
        if (!stopped) {
          stopped = true;
          clearIntervalFn(timer);
        }
        return Object.freeze({ status: "stopped", secrets_included: false });
      },
      secrets_included: false,
    });
  }

  return Object.freeze({ start });
}

export const _testingEffectiveAuthorityReconciliationScheduler = Object.freeze({
  truthy,
  boundedIntervalSeconds,
  safeErrorCode,
});
