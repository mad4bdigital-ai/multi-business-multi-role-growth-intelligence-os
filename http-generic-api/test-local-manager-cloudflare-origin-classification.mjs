import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("../apps/local-manager-windows/LocalManagerAutopilot.cs", "utf8");

assert.match(source, /numeric is 502 or 503 or 504 \|\| numeric is >= 520 and <= 527/u);
assert.match(source, /platform_origin_unavailable/u);
assert.match(source, /Cloudflare reached the request path but reported an origin-side failure/u);
assert.match(source, /Only bounded error metadata was retained/u);
assert.match(source, /RequestId/u);
assert.match(source, /RetryAfterSeconds/u);
assert.match(source, /Surface/u);
assert.match(source, /raw response body was not copied/u);
assert.doesNotMatch(source, /HTTP \{numeric\} \{numeric\}/u);

console.log(JSON.stringify({ ok: true, contract: "mad4b.local-manager-cloudflare-origin-classification-test.v1", status_522_retryable: true, secrets_included: false }));
