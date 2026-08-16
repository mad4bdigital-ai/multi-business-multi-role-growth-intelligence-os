import assert from "node:assert/strict";
import { authorizeActAsUserDispatchIfPresent } from "./routes/gptToolsRoutes.js";

assert.equal(await authorizeActAsUserDispatchIfPresent({ callerType: "tenant", toolKey: "tenant.read", req: {} }), null);
await assert.rejects(
  () => authorizeActAsUserDispatchIfPresent({ callerType: "tenant", toolKey: "tenant.read", req: { actAsUserSessionId: "session-1" } }),
  (error) => error.code === "act_as_user_adapter_not_bound",
);
await assert.rejects(
  () => authorizeActAsUserDispatchIfPresent({ callerType: "tenant", toolKey: "tenant.read", runtimeDeps: { actAsUserSessionId: "session-1", actAsUserAdapter: {} }, req: {} }),
  (error) => error.code === "act_as_user_adapter_not_bound",
);
const calls = [];
const result = await authorizeActAsUserDispatchIfPresent({
  callerType: "tenant",
  toolKey: "tenant.read",
  runtimeDeps: {
    actAsUserSessionId: "session-1",
    actAsUserOperation: "call_tool",
    actAsUserAdapter: {
      async authorizeDispatch(input) {
        calls.push(input);
        return { dispatchAuthorized: true, actorId: "owner-1", targetId: "member-1", tenantId: "tenant-1" };
      },
    },
  },
  req: { requestId: "req-1" },
  descriptor: { method: "GET", tags: ["read_only"] },
});
assert.equal(result.context.dispatchAuthorized, true);
assert.equal(calls[0].requestedOperation, "call_tool");
assert.equal(calls[0].requestedTool, "tenant.read");
assert.equal(result.callerType, "tenant");
await assert.rejects(
  () => authorizeActAsUserDispatchIfPresent({
    callerType: "tenant",
    toolKey: "tenant.write",
    runtimeDeps: {
      actAsUserSessionId: "session-1",
      actAsUserOperation: "call_tool",
      actAsUserAdapter: { async authorizeDispatch() { throw new Error("adapter must not be reached"); } },
    },
    req: { requestId: "req-2" },
    descriptor: { method: "POST", tags: ["read_only"] },
  }),
  (error) => error.code === "act_as_user_mutation_blocked_until_promotion",
);
console.log("act-as-user dispatch hook tests passed");
