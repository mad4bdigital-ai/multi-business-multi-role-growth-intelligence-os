import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const authPath = path.resolve(__dirname, "..", "routes", "authRoutes.js");
let source = fs.readFileSync(authPath, "utf8");

const marker = `      return res.status(decision.http_status).json(
        buildTenantGptOAuthTokenErrorResponse(decision, { request_id: requestId }),
      );`;
const replacement = `      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Pragma", "no-cache");
      return res.status(decision.http_status).json(
        buildTenantGptOAuthTokenErrorResponse(decision, { request_id: requestId }),
      );`;

const occurrences = source.split(marker).length - 1;
if (occurrences !== 2) {
  throw new Error(`spec012_t031_cache_header_patch_failed: expected 2 policy responses, found ${occurrences}`);
}
source = source.split(marker).join(replacement);

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
