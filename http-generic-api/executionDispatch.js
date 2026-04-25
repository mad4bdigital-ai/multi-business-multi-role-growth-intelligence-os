export async function dispatchPreparedExecution(input = {}, deps = {}) {
  const {
    requestPayload,
    policies,
    parent_action_key,
    action,
    resolvedMethodPath,
    body,
    finalQuery,
    finalHeaders,
    baseUrl,
    requestUrl
  } = input;

  const {
    debugLog,
    policyValue,
    appendQuery,
    resilienceAppliesToParentAction,
    retryMutationEnabled,
    buildProviderRetryMutations,
    finalizeTransportBody,
    executeUpstreamAttempt,
    shouldRetryProviderResponse,
    MAX_TIMEOUT_SECONDS
  } = deps;

  const timeoutSeconds = Math.min(Number(requestPayload.timeout_seconds || 300), MAX_TIMEOUT_SECONDS);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutSeconds * 1000);

  const resilienceApplies = resilienceAppliesToParentAction(policies, parent_action_key);
  const providerRetryEnabled = retryMutationEnabled(policies);

  const maxAdditionalAttempts = Number(
    policyValue(
      policies,
      "HTTP Execution Resilience",
      "Provider Retry Max Additional Attempts",
      "0"
    )
  ) || 0;

  const retryMutations = buildProviderRetryMutations(
    policies,
    action?.action_key || parent_action_key
  );

  const transportBody = finalizeTransportBody(body);

  const upstreamRequest = {
    method: resolvedMethodPath.method,
    headers: finalHeaders,
    body: transportBody === undefined ? undefined : JSON.stringify(transportBody),
    signal: controller.signal,
    redirect: "follow"
  };

  let finalAttemptQuery = { ...finalQuery };
  let upstream;
  let data;
  let responseHeaders = {};
  let contentType = "";
  let responseText = "";
  let effectiveRequestUrl = requestUrl;

  const attempts = [{}, ...retryMutations].slice(
    0,
    1 + Math.max(0, maxAdditionalAttempts)
  );

  try {
    for (let i = 0; i < attempts.length; i++) {
      const mutation = attempts[i] || {};
      const attemptQuery = { ...finalQuery, ...mutation };
      const attemptUrl = appendQuery(baseUrl, attemptQuery);

      debugLog("RESILIENCE_APPLIES:", resilienceApplies);
      debugLog("PROVIDER_RETRY_ENABLED:", providerRetryEnabled);
      debugLog("PROVIDER_RETRY_ATTEMPT_INDEX:", i);
      debugLog("PROVIDER_RETRY_MUTATION:", mutation);
      debugLog("OUTBOUND_URL_ATTEMPT:", attemptUrl);

      const attemptResult = await executeUpstreamAttempt({
        requestUrl: attemptUrl,
        requestInit: upstreamRequest
      });

      upstream = attemptResult.upstream;
      data = attemptResult.data;
      responseHeaders = attemptResult.responseHeaders;
      contentType = attemptResult.contentType;
      responseText = attemptResult.responseText;
      effectiveRequestUrl = attemptUrl;
      finalAttemptQuery = attemptQuery;

      const canRetry =
        resilienceApplies &&
        providerRetryEnabled &&
        i < attempts.length - 1 &&
        shouldRetryProviderResponse(policies, upstream.status, responseText);

      if (!canRetry) {
        break;
      }
    }
  } finally {
    clearTimeout(timer);
  }

  return {
    upstream,
    data,
    responseHeaders,
    contentType,
    responseText,
    effectiveRequestUrl,
    finalAttemptQuery,
    resilienceApplies
  };
}
