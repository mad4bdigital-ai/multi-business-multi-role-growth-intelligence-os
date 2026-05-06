import express from "express";
import jwt from "jsonwebtoken";
import { createBackendApiKeyMiddleware } from "./runtimeGuards.js";
import { requireAdminPrincipal } from "./routes/adminCliRoutes.js";

let passed = 0;
let failed = 0;

function assert(label, condition, detail = "") {
  if (condition) {
    console.log(`  [PASS] ${label}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${label}${detail ? ` - ${detail}` : ""}`);
    failed++;
  }
}

function startServer(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

async function readJson(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { parse_error: true, text };
  }
}

async function request(baseUrl, method, path, headers = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...headers
    }
  });
  const body = await readJson(response);
  return { status: response.status, body };
}

const env = {
  BACKEND_API_KEY: "backend-secret",
  JWT_SECRET: "jwt-secret"
};

const userJwt = jwt.sign(
  { user_id: "matrix-user", email: "matrix-user@example.com" },
  env.JWT_SECRET,
  { expiresIn: "5m" }
);

const requireBackendApiKey = createBackendApiKeyMiddleware(env);
const app = express();
app.use(express.json());

app.get("/protected", requireBackendApiKey, (req, res) => {
  res.status(200).json({
    ok: true,
    auth: {
      mode: req.auth?.mode,
      principal_type: req.auth?.principal_type,
      is_admin: req.auth?.is_admin,
      user_id: req.auth?.user_id
    }
  });
});

app.post("/admin-only", requireBackendApiKey, requireAdminPrincipal, (req, res) => {
  res.status(200).json({
    ok: true,
    auth: {
      mode: req.auth?.mode,
      principal_type: req.auth?.principal_type,
      is_admin: req.auth?.is_admin
    }
  });
});

const { server, baseUrl } = await startServer(app);

try {
  console.log("\n== protected route access matrix");

  {
    const result = await request(baseUrl, "GET", "/protected");
    assert("protected route rejects missing auth", result.status === 401);
    assert("missing auth uses stable error code", result.body?.error?.code === "missing_backend_api_key", JSON.stringify(result.body));
  }

  {
    const result = await request(baseUrl, "GET", "/protected", { Authorization: "Bearer wrong" });
    assert("protected route rejects invalid bearer", result.status === 403);
    assert("invalid bearer uses stable error code", result.body?.error?.code === "invalid_auth_token", JSON.stringify(result.body));
  }

  {
    const result = await request(baseUrl, "GET", "/protected", { "x-api-key": "wrong" });
    assert("protected route rejects invalid x-api-key", result.status === 403);
    assert("invalid x-api-key uses stable error code", result.body?.error?.code === "invalid_backend_api_key", JSON.stringify(result.body));
  }

  {
    const result = await request(baseUrl, "GET", "/protected", { Authorization: `Bearer ${userJwt}` });
    assert("protected route accepts user JWT", result.status === 200);
    assert("user JWT remains non-admin", result.body?.auth?.mode === "user_jwt" && result.body?.auth?.is_admin === false, JSON.stringify(result.body));
  }

  {
    const result = await request(baseUrl, "GET", "/protected", { Authorization: "Bearer backend-secret" });
    assert("protected route accepts backend bearer", result.status === 200);
    assert("backend bearer is admin principal", result.body?.auth?.mode === "backend_api_key" && result.body?.auth?.is_admin === true, JSON.stringify(result.body));
  }

  {
    const result = await request(baseUrl, "GET", "/protected", { "x-api-key": "backend-secret" });
    assert("protected route accepts backend x-api-key", result.status === 200);
    assert("backend x-api-key is admin principal", result.body?.auth?.mode === "backend_api_key" && result.body?.auth?.is_admin === true, JSON.stringify(result.body));
  }

  console.log("\n== admin-only route access matrix");

  {
    const result = await request(baseUrl, "POST", "/admin-only");
    assert("admin route rejects missing auth before admin guard", result.status === 401);
    assert("admin missing auth uses stable error code", result.body?.error?.code === "missing_backend_api_key", JSON.stringify(result.body));
  }

  {
    const result = await request(baseUrl, "POST", "/admin-only", { Authorization: `Bearer ${userJwt}` });
    assert("admin route rejects user JWT", result.status === 403);
    assert("admin route uses admin-only error code", result.body?.error?.code === "admin_backend_api_key_required", JSON.stringify(result.body));
  }

  {
    const result = await request(baseUrl, "POST", "/admin-only", { Authorization: "Bearer backend-secret" });
    assert("admin route accepts backend bearer", result.status === 200);
    assert("admin backend bearer stays backend mode", result.body?.auth?.mode === "backend_api_key" && result.body?.auth?.is_admin === true, JSON.stringify(result.body));
  }

  {
    const result = await request(baseUrl, "POST", "/admin-only", { "x-api-key": "backend-secret" });
    assert("admin route accepts backend x-api-key", result.status === 200);
    assert("admin backend x-api-key stays backend mode", result.body?.auth?.mode === "backend_api_key" && result.body?.auth?.is_admin === true, JSON.stringify(result.body));
  }
} finally {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

console.log(`\n${"-".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  process.exit(1);
}

console.log("ALL ACCESS CONTROL MATRIX TESTS PASS");
