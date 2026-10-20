// Public GET-only R7: only enums and presence flags may be written to the artifact.
import fs from "node:fs";
export function summarizeR7Headers(raw = "", status = 0) {
  let last = new Map();
  for (const line of String(raw).slice(-32768).split(/\r?\n/u)) {
    if (/^HTTP\/\d(?:\.\d)?\s+\d{3}\b/u.test(line)) { last = new Map(); continue; }
    const match = line.match(/^([a-z0-9-]{1,80}):\s*(.*)$/iu);
    if (match) last.set(match[1].toLowerCase(), String(match[2]).trim().slice(0,250));
  }
  const server = (last.get("server") || "").toLowerCase();
  const serverFamily = ["cloudflare","litespeed","nginx","openresty","apache"].find(v=>server.startsWith(v))
    || (server ? "other" : "unknown");
  const type = (last.get("content-type") || "").toLowerCase();
  return {
    http_status:Number(status)||0, rate_limited:Number(status)===429,
    server_family_observed:serverFamily,
    cf_ray_header_present:last.has("cf-ray"),
    retry_after_header_present:last.has("retry-after"),
    rate_limit_header_present:[...last.keys()].some(k=>/^(?:x-)?rate-?limit[-_]/u.test(k)),
    content_type_family:type.includes("json")?"json":type.includes("html")?"html":type.includes("plain")?"text":"other",
    rate_limit_origin_verified:false,
    conclusion:"headers_are_signals_not_origin_proof",
    raw_headers_stored:false, secrets_included:false,
  };
}
if (process.argv[1]?.endsWith("/production-r7-header-attribution.mjs")) {
  const [source, code, destination] = process.argv.slice(2);
  if (!source || !destination || !/^\d{3}$/u.test(code || "")) process.exit(2);
  let report;
  try {report=summarizeR7Headers(fs.existsSync(source)?fs.readFileSync(source,"utf8"):"",Number(code));}
  finally {fs.rmSync(source,{force:true});}
  fs.writeFileSync(destination,JSON.stringify(report)+"\n",{mode:0o600});
}
