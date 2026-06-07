import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync(new URL("./routes/credentialIntakeRoutes.js", import.meta.url), "utf8");

assert.match(route, /async function writeCredentialIntakeContinuationTask/);
assert.match(route, /credential_intake\.completed/);
assert.match(route, /platform_pending_tasks/);
assert.match(route, /credential_intake_completed:\$\{session\.session_id\}/);
assert.match(route, /no_user_done_message_required: true/);
assert.match(route, /secrets_included: false/);
assert.match(route, /writeCredentialIntakeContinuationTask\(\{ session, connectionId, metadata, autoPromotion, req \}\)/);
assert.match(route, /You do not need to send a manual/);
assert.match(route, /credential_intake\.continuation_task_created/);
assert.match(route, /enqueueCredentialIntakeCompletedWebhook/);
assert.match(route, /credential_intake\.webhook_enqueue_failed/);

const continuationSlice = route.slice(
  route.indexOf("async function writeCredentialIntakeContinuationTask"),
  route.indexOf("async function maybeAutoPromotePlatformSecrets")
);
assert(continuationSlice.length > 1000);
assert.doesNotMatch(continuationSlice, /secret_value\s*:/i);
assert.doesNotMatch(continuationSlice, /value_ciphertext/i);
assert.doesNotMatch(continuationSlice, /credentials\s*,\s*after_json/s);

console.log("Credential intake continuation task guard passed");
