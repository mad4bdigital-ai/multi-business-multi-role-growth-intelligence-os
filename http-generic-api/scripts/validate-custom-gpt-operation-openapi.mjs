import { readFile } from "node:fs/promises";
import { parse } from "yaml";

for (const file of [
  "openapi/openapi.tenant-gpt.auth.yaml",
  "openapi/openapi.custom-gpt.auth-dispatcher.yaml",
]) {
  const document = parse(await readFile(file, "utf8"));
  const paths = Object.keys(document.paths || {});
  const expected = file.includes("tenant-gpt")
    ? ["/tenant/operations/preview", "/tenant/operations/execute", "/tenant/operations/status"]
    : ["/admin/operations/preview", "/admin/operations/execute", "/admin/operations/status"];
  for (const path of expected) {
    if (!paths.includes(path)) throw new Error(`${file} missing ${path}`);
  }
  if (document.info?.description?.includes("listTools then callTool") && !document.info.description.includes("governed fallback")) {
    throw new Error(`${file} still presents generic dispatch as the primary known-intent path`);
  }
  console.log(`yaml operation surface ok: ${file}`);
}
