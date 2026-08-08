from pathlib import Path
import re

path = Path("http-generic-api/routes/connectorProxyRoutes.js")
source = path.read_text()


def replace_once(pattern, replacement, label, flags=0):
    global source
    source, count = re.subn(pattern, replacement, source, count=1, flags=flags)
    if count != 1:
        raise RuntimeError(f"{label} anchor mismatch: {count}")


replace_once(
    r'''function isRouteLevelFailure\(response, data\) \{\n\s*if \(!response\) return true;\n\s*if \(ROUTE_LEVEL_FAILURE_STATUSES\.has\(response\.status\)\) return true;\n\s*if \(data\?\.error\?\.code === "connector_non_json_response"\) return true;\n\s*return false;\n\s*\}''',
    '''function classifyConnectorError({ status = null, errorCode = null, error = null } = {}) {
  const numericStatus = Number(status || 0);
  const code = String(errorCode || error?.code || "").trim().toLowerCase();
  const name = String(error?.name || "").trim().toLowerCase();
  const message = String(error?.message || "").trim().toLowerCase();

  if (code === "connector_non_json_response") return "invalid_upstream_response";
  if (name.includes("timeout") || name === "aborterror" || code.includes("timeout") || code === "etimedout" || message.includes("timed out")) return "timeout";
  if (numericStatus === 401) return "invalid_credential";
  if (numericStatus === 403) return "denied_scope";
  if (numericStatus === 429) return "rate_limited";
  if (numericStatus >= 500) return "upstream_5xx";
  if (numericStatus >= 400) return "operation_failure";
  if (error) return "transport_failure";
  return null;
}

function connectorErrorMetadata({ classification, status = null, errorCode = null } = {}) {
  if (!classification) return null;
  return {
    class: classification,
    retryable: ["timeout", "rate_limited", "upstream_5xx", "invalid_upstream_response", "transport_failure"].includes(classification),
    ...(Number(status || 0) > 0 ? { upstream_status: Number(status) } : {}),
    ...(errorCode ? { upstream_error_code: String(errorCode) } : {}),
  };
}

function selectAggregateConnectorErrorClass(attempts = []) {
  const classes = new Set(attempts.map((attempt) => attempt.connector_error_class).filter(Boolean));
  for (const candidate of ["timeout", "invalid_upstream_response", "upstream_5xx", "denied_scope", "invalid_credential", "transport_failure"]) {
    if (classes.has(candidate)) return candidate;
  }
  return "transport_failure";
}

function isRouteLevelFailure(response, data) {
  if (!response) return true;
  if (Number(response.status || 0) >= 500) return true;
  if (ROUTE_LEVEL_FAILURE_STATUSES.has(response.status)) return true;
  if (data?.error?.code === "connector_non_json_response") return true;
  return false;
}''',
    "route failure classifier",
)

replace_once(
    r'''if \(!candidateTokens\.length\) \{\n\s*return res\.status\(503\)\.json\(\{ ok: false, error: \{ code: "connector_auth_unconfigured", message: "No per-device connector auth token is configured for this device proxy\." \} \}\);\n\s*\}''',
    '''if (!candidateTokens.length) {
    return res.status(503).json({
      ok: false,
      error: { code: "connector_auth_unconfigured", message: "No per-device connector auth token is configured for this device proxy." },
      connector_error: connectorErrorMetadata({ classification: "missing_credential" }),
      secrets_included: false,
    });
  }''',
    "missing credential",
)

replace_once(
    r'''const status = attempt\?\.response\?\.status \|\| 502;\n\s*const errorCode = attempt\?\.data\?\.error\?\.code \|\| null;\n\s*const errorMessage = attempt\?\.data\?\.error\?\.message \|\| null;\n\s*attempts\.push\(\{ \.\.\.meta, status, error_code: errorCode \}\);''',
    '''const status = attempt?.response?.status || 502;
      const errorCode = attempt?.data?.error?.code || null;
      const errorMessage = attempt?.data?.error?.message || null;
      const errorClass = status === 403 && errorCode === "DISABLED"
        ? null
        : classifyConnectorError({ status, errorCode });
      attempts.push({ ...meta, status, error_code: errorCode, connector_error_class: errorClass });''',
    "attempt classification",
)

replace_once(
    r'''await markRouteSuccess\(route\);\n\s*if \(attempt\.data && typeof attempt\.data === "object" && !Array\.isArray\(attempt\.data\)\) \{\n\s*return res\.status\(status\)\.json\(\{ \.\.\.attempt\.data, connector_route: meta, connector_route_attempts: attempts \}\);\n\s*\}\n\s*return res\.status\(status\)\.send\(attempt\.data\);''',
    '''await markRouteSuccess(route);
      if (status >= 400) {
        const connectorError = connectorErrorMetadata({ classification: errorClass || "operation_failure", status, errorCode });
        if (attempt.data && typeof attempt.data === "object" && !Array.isArray(attempt.data)) {
          return res.status(status).json({
            ...attempt.data,
            connector_error: connectorError,
            connector_route: meta,
            connector_route_attempts: attempts,
            secrets_included: false,
          });
        }
        return res.status(status).json({
          ok: false,
          error: { code: "connector_operation_failed", message: "Connector operation failed." },
          connector_error: connectorError,
          connector_route: meta,
          connector_route_attempts: attempts,
          secrets_included: false,
        });
      }
      if (attempt.data && typeof attempt.data === "object" && !Array.isArray(attempt.data)) {
        return res.status(status).json({ ...attempt.data, connector_route: meta, connector_route_attempts: attempts });
      }
      return res.status(status).send(attempt.data);''',
    "operation failure return",
)

replace_once(
    r'''\} catch \(err\) \{\n\s*attempts\.push\(\{ \.\.\.meta, status: null, error_code: err\.code \|\| "route_dispatch_exception" \}\);\n\s*await markRouteFailure\(route, err\.code \|\| "route_dispatch_exception", err\.message \|\| "Route dispatch exception\.", \{ terminal: true \}\);\n\s*\}\n\s*\}\n\n\s*return res\.status\(502\)\.json\(\{\n\s*ok: false,\n\s*error: \{\n\s*code: "connector_all_routes_failed",\n\s*message: "All enabled healthy/unknown connector routes failed for this device\.",\n\s*details: \{ device_id: deviceId, attempts \},\n\s*\},\n\s*\}\);''',
    '''} catch (err) {
      const errorClass = classifyConnectorError({ error: err });
      attempts.push({
        ...meta,
        status: null,
        error_code: err.code || "route_dispatch_exception",
        connector_error_class: errorClass,
      });
      await markRouteFailure(route, err.code || "route_dispatch_exception", err.message || "Route dispatch exception.", { terminal: true });
    }
  }

  const aggregateErrorClass = selectAggregateConnectorErrorClass(attempts);
  return res.status(502).json({
    ok: false,
    error: {
      code: "connector_all_routes_failed",
      message: "All enabled healthy/unknown connector routes failed for this device.",
      details: { device_id: deviceId, attempts },
    },
    connector_error: connectorErrorMetadata({ classification: aggregateErrorClass }),
    secrets_included: false,
  });''',
    "aggregate failure return",
)

path.write_text(source)
