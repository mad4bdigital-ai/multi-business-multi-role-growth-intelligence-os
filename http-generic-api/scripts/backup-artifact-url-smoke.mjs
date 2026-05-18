#!/usr/bin/env node

function parseArgs(argv = process.argv.slice(2)) {
  const out = {};
  for (const arg of argv) {
    const m = arg.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1].replace(/-/g, "_")] = m[2];
  }
  return out;
}
function required(args, key) {
  const value = String(args[key] || "").trim();
  if (!value) throw new Error(`${key} is required.`);
  return value;
}
function redact(value) {
  try {
    const url = new URL(value);
    if (url.searchParams.has("token")) url.searchParams.set("token", "<redacted>");
    return url.toString();
  } catch { return "<invalid-url>"; }
}
async function check(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
  const text = await res.text().catch(() => "");
  let body = null;
  try { body = JSON.parse(text); } catch { body = { raw_preview: text.slice(0, 200) }; }
  return {
    status: res.status,
    ok: res.ok,
    content_type: res.headers.get("content-type"),
    content_length: res.headers.get("content-length"),
    json_code: body?.error?.code || null,
    json_message: body?.error?.message || null,
    raw_preview: body?.raw_preview || null,
  };
}
async function main() {
  const args = parseArgs();
  const url = required(args, "url");
  const result = await check(url);
  console.log(JSON.stringify({ ok: true, url: redact(url), result, secrets_included: false }, null, 2));
  if (!result.ok) process.exitCode = 1;
}
main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: { code: err.code || "backup_artifact_url_smoke_failed", message: err.message }, secrets_included: false }, null, 2));
  process.exitCode = 1;
});
