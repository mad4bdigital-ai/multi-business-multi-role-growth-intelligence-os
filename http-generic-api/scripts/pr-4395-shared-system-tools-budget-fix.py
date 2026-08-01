from pathlib import Path

path = Path("test-platform-routes.mjs")
source = path.read_text()
before = '''{
  const r = await get("/system/tools");
  ok("shared system tools returns 200", r.status === 200, `got ${r.status}`);
  ok("shared system tools exposes MCP facade protocol", r.body.protocol === "openapi-mcp-facade", `got ${r.body.protocol}`);
  ok("shared system tools exposes provider bootstrap chain to admin", Array.isArray(r.body.tools) && r.body.tools.some((tool) => tool.name === "activation_provider_bootstrap_validate"));
  ok("shared system tools exposes tenant GPT OAuth client upsert to admin", Array.isArray(r.body.tools) && r.body.tools.some((tool) => tool.name === "tenant_gpt_oauth_client_upsert"));
  ok("shared system tools exposes credential client config upsert to admin", Array.isArray(r.body.tools) && r.body.tools.some((tool) => tool.name === "credential_client_config_upsert"));
  ok("shared system tools exposes Google Auth Platform config to admin", Array.isArray(r.body.tools) && r.body.tools.some((tool) => tool.name === "google_auth_platform_config_get"));
  ok("shared system tools exposes Drive folder inspect to admin", Array.isArray(r.body.tools) && r.body.tools.some((tool) => tool.name === "google_drive_folder_inspect"));
}'''
after = '''{
  const degraded = await get("/system/tools");
  ok("shared system tools returns controlled 503 when the default inline budget cannot contain the degraded response", degraded.status === 503, `got ${degraded.status}`);
  ok("shared system tools bounded failure is typed", degraded.body.error?.code === "response_chunk_persistence_unavailable_inline_limit_exceeded", JSON.stringify(degraded.body));
  ok("shared system tools bounded failure excludes secrets", degraded.body.secrets_included === false, JSON.stringify(degraded.body));

  const r = await get("/system/tools?max_chars=150000&client_response_budget_chars=150000&response_envelope_overhead_chars=2000");
  ok("shared system tools returns 200 when the caller explicitly supplies a sufficient bounded response budget", r.status === 200, `got ${r.status}`);
  ok("shared system tools exposes MCP facade protocol", r.body.protocol === "openapi-mcp-facade", `got ${r.body.protocol}`);
  ok("shared system tools exposes provider bootstrap chain to admin", Array.isArray(r.body.tools) && r.body.tools.some((tool) => tool.name === "activation_provider_bootstrap_validate"));
  ok("shared system tools exposes tenant GPT OAuth client upsert to admin", Array.isArray(r.body.tools) && r.body.tools.some((tool) => tool.name === "tenant_gpt_oauth_client_upsert"));
  ok("shared system tools exposes credential client config upsert to admin", Array.isArray(r.body.tools) && r.body.tools.some((tool) => tool.name === "credential_client_config_upsert"));
  ok("shared system tools exposes Google Auth Platform config to admin", Array.isArray(r.body.tools) && r.body.tools.some((tool) => tool.name === "google_auth_platform_config_get"));
  ok("shared system tools exposes Drive folder inspect to admin", Array.isArray(r.body.tools) && r.body.tools.some((tool) => tool.name === "google_drive_folder_inspect"));
}'''
count = source.count(before)
if count != 1:
    raise SystemExit(f"test-platform-routes.mjs: expected one shared system tools block, found {count}")
path.write_text(source.replace(before, after))
