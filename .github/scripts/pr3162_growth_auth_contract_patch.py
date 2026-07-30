from pathlib import Path

path = Path("http-generic-api/openapi.yaml")
text = path.read_text()
start_marker = "  /tenants/{tenant_id}/brands/{brand_key}/growth-intelligence/pilot:"
end_marker = "  /tenants/{tenant_id}/relationships:"
start = text.find(start_marker)
if start < 0:
    raise SystemExit("Growth Intelligence OpenAPI start marker not found")
end = text.find(end_marker, start)
if end < 0:
    raise SystemExit("Growth Intelligence OpenAPI end marker not found")
section = text[start:end]
old = "      security: [{ backendBearerAuth: [] }, { backendApiKeyAuth: [] }]"
new = "      security: [{ adminBearerAuth: [] }, { backendApiKeyAuth: [] }]"
count = section.count(old)
if count != 7:
    raise SystemExit(f"Growth Intelligence auth contracts: expected 7 matches, found {count}")
section = section.replace(old, new)
path.write_text(text[:start] + section + text[end:])
