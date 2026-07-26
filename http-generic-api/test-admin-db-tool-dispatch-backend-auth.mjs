import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildInternalToolDispatchHeaders } from "./routes/gptToolsRoutes.js";

const source = readFileSync("routes/gptToolsRoutes.js", "utf8");

assert(source.includes("force_backend"), "admin DB tool dispatch must support forced backend auth");
assert(source.includes("effectiveCallerType === \"admin\""), "admin DB tool dispatch must force backend auth for effective admin tools");

{
  const headers = buildInternalToolDispatchHeaders(
    { auth: { mode: "user_jwt", is_admin: false }, headers: { authorization: "Bearer user-token" }, ip: "127.0.0.1" },
    { BACKEND_API_KEY: "backend-secret" },
    { force_backend: true }
  );
  assert.equal(headers.Authorization, "Bearer backend-secret", "forced admin dispatch must use backend API key");
}

{
  const headers = buildInternalToolDispatchHeaders(
    { auth: { mode: "user_jwt", is_admin: false }, headers: { authorization: "Bearer user-token" }, ip: "127.0.0.1" },
    { BACKEND_API_KEY: "backend-secret" }
  );
  assert.equal(headers.Authorization, "Bearer user-token", "tenant dispatch must preserve user authorization when not forced");
}

console.log("admin DB tool dispatch backend auth tests passed");
