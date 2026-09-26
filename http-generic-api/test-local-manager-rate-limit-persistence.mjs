import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const program = fs.readFileSync("../apps/local-manager-windows/Program.cs", "utf8");
const deviceLink = fs.readFileSync("../apps/local-manager-windows/DeviceLinkClient.cs", "utf8");
const autopilot = fs.readFileSync("../apps/local-manager-windows/LocalManagerAutopilot.cs", "utf8");
const store = fs.readFileSync("../apps/local-manager-windows/DesktopCommandPollBackoffStore.cs", "utf8");

test("desktop command backoff is restored across Local Manager restart", () => {
  assert.match(program, /RestoreDesktopCommandPollBackoff\(\);/u);
  assert.match(program, /SaveDesktopCommandPollBackoff\(\);/u);
  assert.match(program, /ClearDesktopCommandPollBackoff\(\);/u);
  assert.match(program, /DesktopCommandPollBackoffStore/u);

  assert.match(store, /desktop-command-poll-backoff\.json/u);
  assert.match(store, /MaxBackoffSeconds\s*=\s*300/u);
  assert.match(store, /backoff_until_utc/u);
  assert.match(store, /failure_count/u);
  assert.match(store, /File\.Move\(temporary, _statePath, true\)/u);
  assert.match(store, /secrets_included\s*=\s*false/u);
});

test("429 handling observes HTTP status and Retry-After before JSON-dependent recovery", () => {
  assert.match(deviceLink, /RetryAfterSeconds\(response\)/u);
  assert.match(deviceLink, /response\.StatusCode/u);
  assert.match(program, /HttpStatusCode\.TooManyRequests/u);
  assert.match(program, /RetryAfterSeconds\(response, 120\)/u);
  assert.match(program, /Math\.Max\(localBackoffSeconds, serverRetryAfterSeconds \?\? 0\)/u);
  assert.match(autopilot, /if \(numeric == 429\)/u);
  assert.match(autopilot, /RetryAfterSeconds/u);
});

test("successful polling clears durable backoff instead of preserving stale throttling", () => {
  const successReset = /_desktopCommandPollFailureCount\s*=\s*0;[\s\S]{0,300}_desktopCommandPollBackoffUntil\s*=\s*DateTimeOffset\.MinValue;[\s\S]{0,300}ClearDesktopCommandPollBackoff\(\);/u;
  assert.match(program, successReset);
});

test("persistent backoff state contains scheduling metadata only", () => {
  assert.doesNotMatch(store, /device-token\.dpapi/u);
  assert.doesNotMatch(store, /Authorization/u);
  assert.doesNotMatch(store, /connector_secret/u);
  assert.doesNotMatch(store, /connector_local_api_key/u);
  assert.doesNotMatch(store, /password/u);
});
