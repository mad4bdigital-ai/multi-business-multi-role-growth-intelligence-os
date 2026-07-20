import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("routes/releaseRoutes.js", "utf8");

assert.match(source, /function compactReadinessProjection\(report, mode = "summary"\)/, "release readiness route must define a bounded summary projection");
assert.match(source, /full_response_available_with:\s*"\?full=true"/, "summary projection must disclose how to request full details");
assert.match(source, /bounded_projection:\s*true/, "summary projection must mark bounded output");
assert.match(source, /const explicitFull = req\.query\.full === "true"/, "full response must require an explicit full=true request");
assert.match(source, /if \(explicitFull && !explicitSummary\)/, "summary=true must still override full output");
assert.match(source, /response_mode:\s*"full"/, "explicit full response must label full mode");
assert.match(source, /status:\s*"degraded_transport"/, "route failures must return a structured degraded transport envelope");
assert.match(source, /secrets_included:\s*false/, "readiness responses must declare no secrets");

const handleBlock = source.slice(source.indexOf("async function handleReadiness"), source.indexOf("// ── GET /release/readiness"));
assert(!/return res\.status\(httpStatus\)\.json\(\{ ok: report\.overall !== "fail", \.\.\.report \}\);/.test(handleBlock), "default readiness route must not return the full report by default");

console.log("release readiness summary-first tests passed");
