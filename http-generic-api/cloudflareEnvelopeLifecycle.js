function normalizeMethod(value) {
  return String(value || "GET").trim().toUpperCase();
}

function providerPayload(result) {
  return result?.data?.result ?? result?.data ?? null;
}

function providerSucceeded(result) {
  return result?.ok === true && result?.data?.success !== false;
}

function findExpectedRule(payload, expectedRuleId) {
  const rules = Array.isArray(payload?.rules) ? payload.rules : [];
  if (!expectedRuleId) return null;
  return rules.find((rule) => String(rule?.id || "") === String(expectedRuleId)) || null;
}

export function verifyCloudflareReadback(readbackResult, readbackPlan = {}) {
  if (!providerSucceeded(readbackResult)) {
    return {
      ok: false,
      reason_code: "cloudflare_readback_provider_failed",
      status: readbackResult?.status ?? null,
    };
  }

  const payload = providerPayload(readbackResult);
  const expectedRuleId = String(readbackPlan?.expected_rule_id || "").trim();
  const expectedExpression = String(readbackPlan?.expected_expression || "").trim();
  const rule = expectedRuleId ? findExpectedRule(payload, expectedRuleId) : null;

  if (!expectedRuleId && !expectedExpression) {
    return { ok: false, reason_code: "cloudflare_readback_expectation_missing" };
  }
  if (expectedRuleId && !rule) {
    return { ok: false, reason_code: "cloudflare_readback_rule_missing", expected_rule_id: expectedRuleId };
  }
  if (expectedExpression && String(rule?.expression || "") !== expectedExpression) {
    return {
      ok: false,
      reason_code: "cloudflare_readback_expression_mismatch",
      expected_expression: expectedExpression,
      actual_expression: rule?.expression ?? null,
    };
  }

  return {
    ok: true,
    reason_code: "cloudflare_readback_verified",
    expected_rule_id: expectedRuleId || null,
    expected_expression: expectedExpression || null,
    ruleset_id: payload?.id || null,
    ruleset_version: payload?.version || null,
  };
}

export function buildCloudflareExecutionRef(body = {}, verification = {}) {
  const path = String(body?.path || "cloudflare").trim() || "cloudflare";
  const version = verification?.ruleset_version ? `:version${verification.ruleset_version}` : "";
  return `admin_cloudflare:${path}${version}`;
}

export async function finalizeCloudflareEnvelopeLifecycle({ body = {}, mutationResult, executeReadback, consumeEnvelope } = {}) {
  const method = normalizeMethod(body?.method);
  if (["GET", "HEAD", "OPTIONS"].includes(method)) {
    return { attempted: false, consumed: false, reason_code: "cloudflare_read_only_method" };
  }
  if (!providerSucceeded(mutationResult)) {
    return { attempted: false, consumed: false, reason_code: "cloudflare_provider_mutation_failed" };
  }

  const envelopeId = String(body?.capability_envelope_id || "").trim();
  const readbackPlan = body?.readback_plan && typeof body.readback_plan === "object" ? body.readback_plan : null;
  if (!envelopeId) {
    return { attempted: false, consumed: false, reason_code: "cloudflare_envelope_missing" };
  }
  if (!readbackPlan?.path || typeof executeReadback !== "function") {
    return { attempted: false, consumed: false, reason_code: "cloudflare_readback_plan_missing" };
  }
  if (typeof consumeEnvelope !== "function") {
    return { attempted: false, consumed: false, reason_code: "cloudflare_envelope_consumer_missing" };
  }

  const readbackResult = await executeReadback({
    path: readbackPlan.path,
    method: readbackPlan.method || "GET",
    params: readbackPlan.params || {},
  });
  const verification = verifyCloudflareReadback(readbackResult, readbackPlan);
  if (!verification.ok) {
    return {
      attempted: true,
      consumed: false,
      readback_verified: false,
      retry_provider_mutation: false,
      reconciliation_required: false,
      ...verification,
    };
  }

  const executionRef = buildCloudflareExecutionRef(body, verification);
  try {
    const lifecycle = await consumeEnvelope({
      envelopeId,
      executionRef,
      reason: "Cloudflare mutation completed and same-cycle provider readback matched the declared plan.",
    });
    return {
      attempted: true,
      consumed: lifecycle?.execution_status === "executed",
      readback_verified: true,
      retry_provider_mutation: false,
      reconciliation_required: lifecycle?.execution_status !== "executed",
      execution_ref: executionRef,
      lifecycle,
      verification,
    };
  } catch (error) {
    return {
      attempted: true,
      consumed: false,
      readback_verified: true,
      retry_provider_mutation: false,
      reconciliation_required: true,
      reason_code: "cloudflare_envelope_consume_failed",
      execution_ref: executionRef,
      lifecycle_error_code: error?.code || "capability_envelope_lifecycle_failed",
      verification,
    };
  }
}
