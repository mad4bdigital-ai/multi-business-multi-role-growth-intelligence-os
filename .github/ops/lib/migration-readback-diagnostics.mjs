function responseCode(payload = {}) {
  return payload?.error?.code
    || payload?.error_code
    || payload?.code
    || null;
}

function missingCounts(readback = {}) {
  const missing = readback?.expectations?.missing || {};
  return Object.fromEntries(
    ["tables", "columns", "indexes", "rule_conditions"].map((key) => [
      key,
      Array.isArray(missing[key]) ? missing[key].length : null,
    ]),
  );
}

export function migrationReadbackFailureDetails(result = {}, readback = null) {
  return {
    transport_ok: Boolean(result?.transport_ok),
    http_status: result?.status ?? null,
    http_ok: Boolean(result?.http_ok),
    transport_error: result?.transport_error || null,
    response_ok: result?.payload?.ok ?? null,
    response_error_code: responseCode(result?.payload),
    response_readback_status: readback?.readback_status || null,
    response_ledger_found: readback?.ledger?.found ?? null,
    response_ledger_mode: readback?.ledger?.mode || null,
    response_missing_counts: missingCounts(readback),
    response_keys: result?.payload && typeof result.payload === "object"
      ? Object.keys(result.payload).slice(0, 20)
      : [],
    secrets_included: false,
  };
}

export function classifyMigrationReadbackFailure(result = {}, readback = null) {
  const details = migrationReadbackFailureDetails(result, readback);
  if (!details.transport_ok) {
    return {
      code: "migration_1051_readback_transport_failed",
      status: 502,
      message: "Migration 1051 readback transport failed before an application response was received.",
      details,
    };
  }
  if (!details.http_ok) {
    const isReadbackConflict = details.http_status === 409 && details.response_readback_status !== null;
    return {
      code: isReadbackConflict ? "migration_1051_readback_not_pass" : "migration_1051_readback_http_failed",
      status: isReadbackConflict ? 409 : 502,
      message: isReadbackConflict
        ? "Migration 1051 schema readback completed but did not prove an applied ledger and complete schema state."
        : "Migration 1051 readback returned a non-success HTTP response.",
      details,
    };
  }
  return null;
}
