import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const authPath = path.resolve(__dirname, "..", "routes", "authRoutes.js");
let source = fs.readFileSync(authPath, "utf8");

function replaceOnce(before, after, label) {
  const occurrences = source.split(before).length - 1;
  if (occurrences !== 1) {
    throw new Error(`spec012_t031_cache_header_patch_failed: ${label} expected once, found ${occurrences}`);
  }
  source = source.replace(before, after);
}

const nonConsumedMarker = `        return res.status(decision.http_status).json(
          buildTenantGptOAuthTokenErrorResponse(decision, { request_id: requestId }),
        );`;
const nonConsumedReplacement = `        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Pragma", "no-cache");
        return res.status(decision.http_status).json(
          buildTenantGptOAuthTokenErrorResponse(decision, { request_id: requestId }),
        );`;

const catchMarker = `      return res.status(decision.http_status).json(
        buildTenantGptOAuthTokenErrorResponse(decision, { request_id: requestId }),
      );`;
const catchReplacement = `      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Pragma", "no-cache");
      return res.status(decision.http_status).json(
        buildTenantGptOAuthTokenErrorResponse(decision, { request_id: requestId }),
      );`;

replaceOnce(nonConsumedMarker, nonConsumedReplacement, "non-consumed policy response");
replaceOnce(catchMarker, catchReplacement, "exception policy response");

for (const required of [
  'res.setHeader("Cache-Control", "no-store");',
  'res.setHeader("Pragma", "no-cache");',
]) {
  const count = source.split(required).length - 1;
  if (count < 3) {
    throw new Error(`spec012_t031_cache_header_patch_failed: ${required} count ${count}`);
  }
}

fs.writeFileSync(authPath, source);
console.log("Applied Spec 012 T031 OAuth policy-response cache headers");
