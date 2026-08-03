from pathlib import Path

path = Path("http-generic-api/test-auth-oauth-routes.mjs")
text = path.read_text(encoding="utf-8")
old = "app.use(buildTenantGptOAuthMetadataRoutes());"
new = "app.use(buildTenantGptOAuthMetadataRoutes({ getPool: () => oauthClientPool }));"
count = text.count(old)
if count != 1:
    raise SystemExit(f"expected one OAuth metadata fixture anchor, found {count}")
path.write_text(text.replace(old, new, 1), encoding="utf-8")
print("OAuth route fixture now injects the governed route pool")
