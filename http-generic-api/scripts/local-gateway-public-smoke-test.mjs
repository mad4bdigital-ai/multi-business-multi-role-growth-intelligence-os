#!/usr/bin/env node
import jwt from "jsonwebtoken";

const DEFAULT_BASE = "https://local.mad4b.com";

function parseArgs(argv = process.argv.slice(2)) {
  const out = {
    base_url: DEFAULT_BASE,
    device_id: "essam-pc",
    user_id: "f242960c-2857-4b4d-a504-ee50f8a278b4",
  };
  for (const arg of argv) {
    const m = arg.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1].replace(/-/g, "_")] = m[2];
  }
  return out;
}

async function requestJson(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(Number(options.timeout_ms || 30000)),
  });
  const text = await res.text().catch(() => "");
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw_preview: text.slice(0, 500) }; }
  return { status: res.status, ok: res.ok, body };
}

function assertOk(condition, code, details = {}) {
  if (condition) return;
  const err = new Error(code);
  err.code = code;
  err.details = details;
  throw err;
}

async function main() {
  const args = parseArgs();
  const token = process.env.BACKEND_API_KEY;
  if (!token) throw Object.assign(new Error("BACKEND_API_KEY is not configured."), { code: "backend_api_key_missing" });
  const base = String(args.base_url || DEFAULT_BASE).replace(/\/$/, "");
  const authHeaders = { Authorization: `Bearer ${token}` };

  const health = await requestJson(`${base}/health`);
  assertOk(health.status === 200 && health.body?.ok === true, "health_check_failed", { status: health.status, body: health.body });

  const unauthTools = await requestJson(`${base}/local/tools`);
  assertOk(unauthTools.status === 401, "unauthenticated_tools_should_be_401", { status: unauthTools.status, body: unauthTools.body });

  const tools = await requestJson(`${base}/local/tools?include_planned=true`, { headers: authHeaders });
  assertOk(tools.status === 200 && tools.body?.ok === true && Number(tools.body?.count || 0) >= 10, "authenticated_tools_list_failed", { status: tools.status, body: tools.body });

  const call = await requestJson(`${base}/local/tools/call`, {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "local.connector.health",
      tool_args: {
        device_id: args.device_id,
        user_id: args.user_id,
      },
    }),
  });
  assertOk(call.status === 200 && call.body?.ok === true && call.body?.local_gateway?.call_id, "local_gateway_health_call_failed", { status: call.status, body: call.body });

  console.log(JSON.stringify({
    ok: true,
    base_url: base,
    checks: {
      public_health_status: health.status,
      unauthenticated_tools_status: unauthTools.status,
      authenticated_tools_status: tools.status,
      authenticated_tools_count: tools.body.count,
      call_status: call.status,
      call_id: call.body.local_gateway.call_id,
      dispatch_tool_key: call.body.local_gateway.dispatch_tool_key,
      hostname: call.body.hostname || null,
      platform: call.body.platform || null,
    },
    secrets_included: false,
  }, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: { code: err.code || "local_gateway_public_smoke_failed", message: err.message, details: err.details || undefined }, secrets_included: false }, null, 2));
  process.exitCode = 1;
});
