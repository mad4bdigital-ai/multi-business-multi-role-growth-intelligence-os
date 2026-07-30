from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str) -> None:
    file_path = Path(path)
    text = file_path.read_text(encoding="utf-8")
    if new in text:
        if old in text:
            raise SystemExit(f"{label}: both old and new forms are present")
        return
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one exact match, found {count}")
    file_path.write_text(text.replace(old, new, 1), encoding="utf-8")


SYSTEM = "http-generic-api/routes/systemLayerRoutes.js"
AWARENESS = "http-generic-api/routes/activationAwarenessRoutes.js"
HARD = "http-generic-api/routes/activationHardRunRoutes.js"
ACTIVATION = "http-generic-api/routes/activationRoutes.js"
TENANT_OVERLAY = "http-generic-api/routes/tenantActivationOverlayRoutes.js"
GPT_TEST = "http-generic-api/test-gpt-tools-response-chunking.mjs"
SYSTEM_TEST = "http-generic-api/test-system-layer-response-chunk-passthrough.mjs"
AWARENESS_TEST = "http-generic-api/test-activation-awareness-completeness.mjs"
HARD_TEST = "http-generic-api/test-hard-activation-transport-semantics.mjs"
TENANT_TEST = "http-generic-api/test-tenant-activation-session-alias.mjs"

replace_once(
    SYSTEM,
    '''async function chunkSystemLayerResponse(body, source = {}) {
  const responseOptions = source?.response_options && typeof source.response_options === "object" ? source.response_options : {};
  const sourceToolKey = source?.source_tool_key || "system_layer_response";
  try {
    return await maybeChunkToolResponseBody(body, {
      response_options: {
        max_chars: Number(responseOptions.max_chars || source?.max_chars || 45000),
        cursor: Number(responseOptions.cursor || source?.cursor || 0),
        chunk_ttl_ms: Number(responseOptions.chunk_ttl_ms || source?.chunk_ttl_ms || 0) || undefined,
        chunk_ttl_minutes: Number(responseOptions.chunk_ttl_minutes || source?.chunk_ttl_minutes || 0) || undefined,
      },
      source_tool_key: sourceToolKey,
    });''',
    '''async function chunkSystemLayerResponse(
  body,
  source = {},
  auth = null,
  sourceSurface = "system_layer_response",
  trustedSourceToolKey = null,
) {
  const responseOptions = source?.response_options && typeof source.response_options === "object" ? source.response_options : {};
  const sourceToolKey = String(
    trustedSourceToolKey || source?.source_tool_key || "system_layer_response",
  ).trim() || "system_layer_response";
  try {
    return await maybeChunkToolResponseBody(body, {
      response_options: {
        max_chars: Number(responseOptions.max_chars || source?.max_chars || 45000),
        cursor: Number(responseOptions.cursor || source?.cursor || 0),
        chunk_ttl_ms: Number(responseOptions.chunk_ttl_ms || source?.chunk_ttl_ms || 0) || undefined,
        chunk_ttl_minutes: Number(responseOptions.chunk_ttl_minutes || source?.chunk_ttl_minutes || 0) || undefined,
      },
      auth,
      source_tool_key: sourceToolKey,
      source_surface: sourceSurface,
    });''',
    "system layer chunk helper principal",
)

replace_once(
    SYSTEM,
    '''    case "response_chunk_read":
      return await readCachedToolResponseChunk(args);''',
    '''    case "response_chunk_read":
      return await readCachedToolResponseChunk({
        ...(args || {}),
        auth,
        source_surface: "system_layer_response_chunk_read",
      });''',
    "system layer chunk read principal",
)

replace_once(
    SYSTEM,
    '''      return res.status(200).json(await chunkSystemLayerResponse(body, req.query || {}));''',
    '''      return res.status(200).json(await chunkSystemLayerResponse(
        body,
        req.query || {},
        req.auth,
        "system_tools_list",
        "system_tools_list",
      ));''',
    "system tools list principal",
)

replace_once(
    SYSTEM,
    '''      return res.status(200).json(await chunkSystemLayerResponse({ ok: true, name, result, secrets_included: false }, args || {}));''',
    '''      return res.status(200).json(await chunkSystemLayerResponse(
        { ok: true, name, result, secrets_included: false },
        args || {},
        req.auth,
        "system_tools_call",
        name,
      ));''',
    "system tools call principal",
)

replace_once(
    SYSTEM,
    '''    return res.status(200).json(await chunkSystemLayerResponse(body, req.query || {}));''',
    '''    return res.status(200).json(await chunkSystemLayerResponse(
      body,
      req.query || {},
      req.auth,
      "admin_system_tools_list",
      "admin_system_tools_list",
    ));''',
    "admin system tools list principal",
)

replace_once(
    SYSTEM,
    '''      return res.status(200).json(await chunkSystemLayerResponse({ ok: true, name, result, secrets_included: false }, args || {}));''',
    '''      return res.status(200).json(await chunkSystemLayerResponse(
        { ok: true, name, result, secrets_included: false },
        args || {},
        req.auth,
        "admin_system_tools_call",
        name,
      ));''',
    "admin system tools call principal",
)

replace_once(
    AWARENESS,
    '''    },
    source_tool_key: sourceToolKey,
  }, deps);''',
    '''    },
    auth: req?.auth || null,
    source_tool_key: sourceToolKey,
    source_surface: "activation_awareness",
  }, deps);''',
    "activation awareness principal",
)

replace_once(
    HARD,
    '''        },
        source_tool_key: "activation_hard_run",
      });''',
    '''        },
        auth: req?.auth || null,
        source_tool_key: "activation_hard_run",
        source_surface: "activation_hard_run",
      });''',
    "activation hard run principal",
)

replace_once(
    ACTIVATION,
    '''        },
        source_tool_key: "activation_session_context_read_api",
      });''',
    '''        },
        auth: req?.auth || null,
        source_tool_key: "activation_session_context_read_api",
        source_surface: "activation_session_context_read_api",
      });''',
    "activation session context principal",
)

replace_once(
    TENANT_OVERLAY,
    '''            },
            source_tool_key: "tenant_activation_session_context",
          })''',
    '''            },
            auth: req.auth,
            source_tool_key: "tenant_activation_session_context",
            source_surface: "tenant_activation_session_context",
          })''',
    "tenant activation overlay principal",
)

replace_once(
    GPT_TEST,
    '''  assert.ok(systemLayerRoutes.includes("await readCachedToolResponseChunk(args)"), "system layer chunk reads must await durable recovery");''',
    '''  assert.equal(systemLayerRoutes.includes("await readCachedToolResponseChunk(args)"), false, "system layer chunk reads must not trust caller arguments as principal context");
  assert.ok(systemLayerRoutes.includes('source_surface: "system_layer_response_chunk_read"'), "system layer chunk reads must bind a trusted source surface");
  assert.ok(systemLayerRoutes.includes("...(args || {})"), "system layer chunk reads must preserve pagination arguments before overriding auth");
  assert.ok(systemLayerRoutes.includes("auth,"), "system layer chunk reads must receive middleware auth separately");
  assert.ok(systemLayerRoutes.includes('"system_tools_list"'), "system tools list chunk ownership must use a fixed trusted source");
  assert.ok(systemLayerRoutes.includes('"admin_system_tools_call"'), "admin system calls must use a fixed trusted source surface");''',
    "gpt chunk test system principal assertions",
)

replace_once(
    SYSTEM_TEST,
    '''assert.match(
  source,
  /case\s+"response_chunk_read"\s*:\s*return\s+await\s+readCachedToolResponseChunk\(args\);/s,
  "response_chunk_read must continue to resolve the original cached response chunk",
);''',
    '''assert.equal(
  source.includes("readCachedToolResponseChunk(args)"),
  false,
  "response_chunk_read must not accept caller-supplied auth from tool arguments",
);
assert.ok(
  source.includes('source_surface: "system_layer_response_chunk_read"'),
  "response_chunk_read must bind middleware auth to a trusted system-layer source",
);
assert.ok(
  source.includes("...(args || {})"),
  "response_chunk_read must preserve cursor and TTL arguments before trusted auth override",
);
assert.ok(
  source.includes('"system_tools_call"') && source.includes('"admin_system_tools_call"'),
  "tenant-capable and admin system calls must use distinct trusted source surfaces",
);''',
    "system passthrough test principal assertions",
)

replace_once(
    AWARENESS_TEST,
    '''  assert.match(hardRoutes, /maybeChunkToolResponseBody/);
  assert.match(hardRoutes, /markActivationRunDelivered/);''',
    '''  assert.match(hardRoutes, /maybeChunkToolResponseBody/);
  assert.match(hardRoutes, /auth: req\?\.auth \|\| null/);
  assert.match(hardRoutes, /source_surface: "activation_hard_run"/);
  assert.match(hardRoutes, /markActivationRunDelivered/);''',
    "awareness completeness hard route principal assertions",
)

replace_once(
    AWARENESS_TEST,
    '''  assert.match(awarenessRoutes, /chunkActivationAwarenessResponse/);
  assert.match(activationRoutes, /activation_session_context_read_api/);''',
    '''  assert.match(awarenessRoutes, /chunkActivationAwarenessResponse/);
  assert.match(awarenessRoutes, /auth: req\?\.auth \|\| null/);
  assert.match(awarenessRoutes, /source_surface: "activation_awareness"/);
  assert.match(activationRoutes, /activation_session_context_read_api/);''',
    "awareness route principal assertions",
)

replace_once(
    AWARENESS_TEST,
    '''  assert.match(activationRoutes, /maybeChunkToolResponseBody/);
  assert.match(activationRoutes, /workspace_key: workspaceKey/);''',
    '''  assert.match(activationRoutes, /maybeChunkToolResponseBody/);
  assert.match(activationRoutes, /auth: req\?\.auth \|\| null/);
  assert.match(activationRoutes, /source_surface: "activation_session_context_read_api"/);
  assert.match(activationRoutes, /workspace_key: workspaceKey/);''',
    "activation route principal assertions",
)

replace_once(
    AWARENESS_TEST,
    '''  assert.match(tenantOverlayRoutes, /tenant_activation_session_context/);
  assert.match(tenantOverlayRoutes, /chunk_ttl_minutes/);''',
    '''  assert.match(tenantOverlayRoutes, /tenant_activation_session_context/);
  assert.match(tenantOverlayRoutes, /auth: req\.auth/);
  assert.match(tenantOverlayRoutes, /source_surface: "tenant_activation_session_context"/);
  assert.match(tenantOverlayRoutes, /chunk_ttl_minutes/);''',
    "tenant overlay principal assertions",
)

replace_once(
    HARD_TEST,
    '''assert.doesNotMatch(
  source,
  /const statusCode = hard\.activation_complete \? 200 : 424;/,
  "activation outcome alone must not determine transport failure",
);

console.log("hard activation transport semantics contract tests passed");''',
    '''assert.doesNotMatch(
  source,
  /const statusCode = hard\.activation_complete \? 200 : 424;/,
  "activation outcome alone must not determine transport failure",
);
assert.match(
  source,
  /auth: req\?\.auth \|\| null/,
  "hard activation chunk ownership must come from authenticated request middleware",
);
assert.match(
  source,
  /source_surface: "activation_hard_run"/,
  "hard activation chunks must carry a fixed trusted source surface",
);

console.log("hard activation transport semantics contract tests passed");''',
    "hard activation transport principal assertions",
)

replace_once(
    TENANT_TEST,
    '''  const deliveredRuns = [];
  const sessionListQueries = [];''',
    '''  const deliveredRuns = [];
  const sessionListQueries = [];
  const chunkCalls = [];''',
    "tenant overlay chunk call capture",
)

replace_once(
    TENANT_TEST,
    '''        graph_memory: {
          requested: true,
          resolved: true,
          asset_count: 1,
          asset_keys: [`asset:${subject.tenant_id}:${subject.workspace_key}:${subject.brand_key}`],
          secrets_included: false,
        },
        secrets_included: false,''',
    '''        graph_memory: {
          requested: true,
          resolved: true,
          asset_count: 1,
          asset_keys: [`asset:${subject.tenant_id}:${subject.workspace_key}:${subject.brand_key}`],
          secrets_included: false,
        },
        transport_chunk_fixture: "x".repeat(6000),
        secrets_included: false,''',
    "tenant overlay oversized fixture",
)

replace_once(
    TENANT_TEST,
    '''    chunkResponse: async (body) => body,''',
    '''    chunkResponse: async (body, options) => {
      chunkCalls.push({ body, options });
      return body;
    },''',
    "tenant overlay chunk option capture",
)

replace_once(
    TENANT_TEST,
    '''    const responseA = await fetch(`${base}/tenant/activation/session-context?response_profile=full`, {''',
    '''    const responseA = await fetch(`${base}/tenant/activation/session-context?response_profile=full&max_response_chars=5000`, {''',
    "tenant A forced chunk",
)

replace_once(
    TENANT_TEST,
    '''    const responseB = await fetch(`${base}/tenant/activation/session-context?response_profile=full`, {''',
    '''    const responseB = await fetch(`${base}/tenant/activation/session-context?response_profile=full&max_response_chars=5000`, {''',
    "tenant B forced chunk",
)

replace_once(
    TENANT_TEST,
    '''    assert.equal(preparedRuns.length, 2);

    const legacy = await fetch(`${base}/activation/session-context`);''',
    '''    assert.equal(preparedRuns.length, 2);
    assert.deepEqual(chunkCalls.map((entry) => entry.options.auth.tenant_id), ["tenant-a", "tenant-b"]);
    assert.deepEqual(chunkCalls.map((entry) => entry.options.auth.user_id), ["user-a", "user-b"]);
    assert.equal(chunkCalls.every((entry) => entry.options.auth.mode === "user_jwt"), true);
    assert.equal(chunkCalls.every((entry) => entry.options.source_surface === "tenant_activation_session_context"), true);
    assert.equal(chunkCalls.every((entry) => entry.options.auth !== entry.options.response_options), true);

    const legacy = await fetch(`${base}/activation/session-context`);''',
    "tenant overlay trusted principal assertions",
)

print("PR3247 trusted chunk principal propagation patch applied")
