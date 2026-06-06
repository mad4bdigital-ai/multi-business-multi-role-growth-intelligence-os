#!/usr/bin/env node
import jwt from "jsonwebtoken";

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    connection_id: "715d4314-f356-4f96-9a78-e37f1ab0cb71",
    tenant_id: "e989a841-fce0-4ced-be76-463e8202a066",
    user_id: "0e76b224-7671-47dd-ad68-014fb042df80",
    command_key: "pwd",
    timeout_ms: 8000,
    port: process.env.PORT || "",
    base_url: process.env.INTERNAL_BASE_URL || "",
  };
  for (const raw of argv) {
    const match = String(raw || "").match(/^--([^=]+)=(.*)$/);
    if (!match) continue;
    const key = match[1].replace(/-/g, "_");
    args[key] = match[2];
  }
  args.timeout_ms = Math.max(1000, Math.min(10000, Number(args.timeout_ms || 8000)));
  return args;
}

function mintTenantJwt({ user_id, tenant_id }) {
  const secret = process.env.JWT_SECRET || "dev-secret";
  return jwt.sign({
    iss: "https://auth.mad4b.com",
    aud: "mad4b-tenant-gpt",
    sub: `tenant:${tenant_id}:user:${user_id}`,
    user_id,
    tenant_id,
    email: "nagyxs@gmail.com",
    scope: [
      "https://auth.mad4b.com/scopes/tenant.links",
      "https://auth.mad4b.com/scopes/tenant.status",
      "https://auth.mad4b.com/scopes/tenant.activation",
      "https://auth.mad4b.com/scopes/tenant.install",
      "https://auth.mad4b.com/scopes/tenant.system-tools",
    ].join(" "),
    scope_links: [
      "https://auth.mad4b.com/scopes/tenant.links",
      "https://auth.mad4b.com/scopes/tenant.status",
      "https://auth.mad4b.com/scopes/tenant.activation",
      "https://auth.mad4b.com/scopes/tenant.install",
      "https://auth.mad4b.com/scopes/tenant.system-tools",
    ],
    purpose: "tenant_ssh_dedicated_worker_smoke",
  }, secret, { expiresIn: "15m" });
}

async function httpJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; }
  catch { body = { ok: false, error: { code: "unparseable_response", message: text.slice(0, 500) } }; }
  return { status: response.status, ok: response.ok, body };
}

async function callTenantTool(baseUrl, token, name, tool_args) {
  return httpJson(`${baseUrl}/gpt/tools/call`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name, tool_args }),
  });
}

async function tickJob(baseUrl, jobId) {
  const apiKey = process.env.BACKEND_API_KEY || "";
  if (!apiKey) {
    return { status: 503, body: { ok: false, error: { code: "backend_api_key_missing", message: "BACKEND_API_KEY is required for manual job tick." } } };
  }
  return httpJson(`${baseUrl}/jobs/${encodeURIComponent(jobId)}/tick`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: "{}",
  });
}

function summarize(label, response) {
  const body = response.body || {};
  const result = body.result || body;
  const execution = result.execution || body.execution || {};
  return {
    label,
    http_status: response.status,
    ok: body.ok === true || response.ok === true,
    status: body.status || result.status || null,
    error_code: body.error?.code || result.error?.code || execution.error_code || null,
    request_id: body.request_id || body.approval_request?.request_id || result.approval_request?.request_id || null,
    job_id: body.job_id || body.job?.job_id || null,
    queued_for_dedicated_worker: body.queued_for_dedicated_worker === true,
    execution_ok: execution.ok ?? null,
    command_key: execution.command_key || null,
    exit_code: execution.exit_code ?? null,
    timed_out: execution.timed_out ?? null,
    stdout_chars: typeof execution.stdout === "string" ? execution.stdout.length : null,
    stderr_chars: typeof execution.stderr === "string" ? execution.stderr.length : null,
    secrets_included: body.secrets_included === true || result.secrets_included === true || execution.secrets_included === true,
  };
}

function assertPass(condition, code, details = {}) {
  if (!condition) {
    const err = new Error(code);
    err.code = code;
    err.details = details;
    throw err;
  }
}

async function main() {
  const args = parseArgs();
  const baseUrl = String(args.base_url || "").trim() || `http://127.0.0.1:${args.port || "3000"}`;
  const token = mintTenantJwt(args);
  const summaries = [];

  const create = await callTenantTool(baseUrl, token, "tenant_ssh_cli_approval_request_create", {
    connection_id: args.connection_id,
    command_key: args.command_key,
  });
  summaries.push(summarize("approval_create", create));
  const requestId = create.body?.request_id || create.body?.approval_request?.request_id;
  assertPass(create.status >= 200 && create.status < 300 && requestId, "approval_create_failed", { summary: summaries.at(-1) });

  const decide = await callTenantTool(baseUrl, token, "tenant_ssh_cli_approval_request_decide", {
    request_id: requestId,
    decision: "approved",
    decision_note: "dedicated worker smoke",
  });
  summaries.push(summarize("approval_decide", decide));
  assertPass(decide.status >= 200 && decide.status < 300, "approval_decide_failed", { summary: summaries.at(-1) });

  const execute = await callTenantTool(baseUrl, token, "tenant_ssh_cli_allowlisted_execute", {
    connection_id: args.connection_id,
    approval_request_id: requestId,
    command_key: args.command_key,
    timeout_ms: args.timeout_ms,
  });
  summaries.push(summarize("execute_queue", execute));
  const jobId = execute.body?.job_id || execute.body?.job?.job_id;
  assertPass(execute.status >= 200 && execute.status < 300 && execute.body?.queued_for_dedicated_worker === true && jobId, "execute_queue_failed", { summary: summaries.at(-1), body_error: execute.body?.error || null });

  const tick = await tickJob(baseUrl, jobId);
  summaries.push(summarize("job_tick", tick));
  assertPass(tick.status >= 200 && tick.status < 300, "job_tick_failed", { summary: summaries.at(-1), body_error: tick.body?.error || null });

  const result = await callTenantTool(baseUrl, token, "tenant_ssh_cli_execute_job_result", {
    connection_id: args.connection_id,
    job_id: jobId,
  });
  summaries.push(summarize("job_result", result));
  const resultPayload = result.body?.result || result.body || {};
  const execution = resultPayload.execution || {};
  assertPass(result.status === 200 && result.body?.status === "succeeded" && execution.ok === true, "job_result_not_successful", { summary: summaries.at(-1), body_error: result.body?.error || resultPayload.error || null });
  assertPass(summaries.every((entry) => entry.secrets_included !== true), "secrets_returned_in_smoke", { summaries });

  console.log(JSON.stringify({
    ok: true,
    smoke: "tenant_ssh_dedicated_worker",
    connection_id: args.connection_id,
    request_id: requestId,
    job_id: jobId,
    command_key: args.command_key,
    checks: summaries,
    raw_stdout_returned: false,
    raw_stderr_returned: false,
    secrets_included: false,
  }, null, 2));
}

main().catch((error) => {
  console.log(JSON.stringify({
    ok: false,
    smoke: "tenant_ssh_dedicated_worker",
    error: { code: error.code || "tenant_ssh_dedicated_worker_smoke_failed", message: error.message, details: error.details || null },
    secrets_included: false,
  }, null, 2));
  process.exit(1);
});
