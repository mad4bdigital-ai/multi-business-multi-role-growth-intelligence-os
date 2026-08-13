const TEST_FILE_PATTERN = /(^|\/)(?:tests?|specs?|__tests__)\/|(^|\/)(?:test|spec)[^/]*\.(?:mjs|cjs|js|ts|tsx)$/i;

export function isTestOrSpec(path) {
  return TEST_FILE_PATTERN.test(path);
}

export function category(path) {
  if (path.startsWith(".github/workflows/")) return "ci-workflows";
  if (path.startsWith(".github/")) return "ci-config";
  if (path.includes("/migrations/") || path.startsWith("migrations/")) return "database-migrations";
  if (path.includes("/openapi/") || path.includes("openapi")) return "api-contracts";
  if (isTestOrSpec(path)) return "tests-and-specs";
  if (path.startsWith("docs/") || path.endsWith(".md")) return "documentation";
  if (path.includes("schema") || path.endsWith(".sql")) return "schemas-and-data";
  if (path.startsWith("apps/")) return "applications";
  if (path.startsWith("src/")) return "source";
  if (path.startsWith("http-generic-api/")) return "api-runtime";
  if (path.startsWith("local-connector/") || path.startsWith("edge/")) return "connectors-and-edge";
  if (/package(-lock)?\.json$|pnpm-lock|yarn\.lock|requirements|pyproject|Dockerfile|docker-compose/i.test(path)) return "build-and-dependencies";
  return "root-and-other";
}

export function extension(path) {
  const base = path.split("/").pop();
  if (!base.includes(".")) return "[no extension]";
  const dot = base.lastIndexOf(".");
  return base.slice(dot).toLowerCase() || "[no extension]";
}
