import assert from "node:assert/strict";
import { buildEnvelopeTranscript, capLimit, normalizeOffset, resolveSessionContextSubject } from "./routes/activationRoutes.js";

{
  const subject = resolveSessionContextSubject({
    auth: { mode: "user_jwt", is_admin: false, user_id: "user-1" },
    query: {}
  });
  assert.equal(subject.user_id, "user-1");
  assert.equal(subject.is_admin, false);
}

{
  const subject = resolveSessionContextSubject({
    auth: { mode: "backend_api_key", is_admin: true },
    query: { user_id: "user-2", tenant_id: "tenant-1" }
  });
  assert.equal(subject.user_id, "user-2");
  assert.equal(subject.tenant_id, "tenant-1");
  assert.equal(subject.is_admin, true);
}

{
  assert.throws(
    () => resolveSessionContextSubject({
      auth: { mode: "user_jwt", is_admin: false, user_id: "user-1" },
      query: { user_id: "user-2" }
    }),
    /cannot inspect another user's activation session context/
  );
}

assert.equal(capLimit(undefined), 50);
assert.equal(capLimit(500), 200);
assert.equal(capLimit(25), 25);
assert.equal(normalizeOffset(undefined), 0);
assert.equal(normalizeOffset(-1), 0);
assert.equal(normalizeOffset(40), 40);

{
  const transcript = buildEnvelopeTranscript({
    request_json: JSON.stringify({
      raw_input: "User asked for last sessions",
      ai_response: "Here is the session history."
    })
  });
  assert.equal(transcript.user_request, "User asked for last sessions");
  assert.equal(transcript.ai_response, "Here is the session history.");
}

{
  const transcript = buildEnvelopeTranscript({
    request_json: "{bad json"
  });
  assert.equal(transcript.user_request, null);
  assert.deepEqual(transcript.request_fields_available, []);
}

{
  const transcript = buildEnvelopeTranscript({
    request_json: JSON.stringify({
      raw_input: "x".repeat(2500)
    })
  });
  assert.equal(transcript.user_request.endsWith("...[truncated]"), true);
}

console.log("activation session context tests passed");
