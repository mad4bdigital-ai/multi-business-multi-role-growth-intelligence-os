function splitTopLevel(value = "", separator = ",") {
  const parts = [];
  let start = 0;
  let depth = 0;
  let quote = null;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote) {
      if (char === quote) {
        if (quote === "'" && value[index + 1] === "'") {
          index += 1;
          continue;
        }
        if (value[index - 1] !== "\\") quote = null;
      }
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }
    if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    else if (char === separator && depth === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts;
}

function readStatementBody(source, startIndex) {
  let depth = 0;
  let quote = null;
  for (let index = startIndex; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (char === quote) {
        if (quote === "'" && source[index + 1] === "'") {
          index += 1;
          continue;
        }
        if (source[index - 1] !== "\\") quote = null;
      }
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }
    if (char === "(") depth += 1;
    else if (char === ")") depth = Math.max(0, depth - 1);
    else if (char === ";" && depth === 0) return source.slice(startIndex, index);
  }
  return source.slice(startIndex);
}

function tupleBodies(valuesBody = "") {
  const tuples = [];
  let start = -1;
  let depth = 0;
  let quote = null;
  for (let index = 0; index < valuesBody.length; index += 1) {
    const char = valuesBody[index];
    if (quote) {
      if (char === quote) {
        if (quote === "'" && valuesBody[index + 1] === "'") {
          index += 1;
          continue;
        }
        if (valuesBody[index - 1] !== "\\") quote = null;
      }
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }
    if (char === "(") {
      if (depth === 0) start = index + 1;
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        tuples.push(valuesBody.slice(start, index));
        start = -1;
      }
    }
  }
  return tuples;
}

function sqlStringLiteral(value = "") {
  const trimmed = String(value || "").trim();
  if (!trimmed.startsWith("'") || !trimmed.endsWith("'")) return null;
  return trimmed.slice(1, -1).replace(/''/g, "'");
}

function normalizeMethod(value = "") {
  const method = String(value || "").trim().toUpperCase();
  return ["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method) ? method : null;
}

function normalizePath(value = "") {
  const path = String(value || "").trim();
  return path.startsWith("/") && !/\s/.test(path) ? path : null;
}

export function extractRegistryToolRegistrations(source = "") {
  const body = String(source || "");
  const registrations = [];
  const insertPattern = /INSERT\s+INTO\s+`?([A-Za-z0-9_]+)`?\s*\(([^)]*)\)\s*VALUES\s*/gi;
  for (const match of body.matchAll(insertPattern)) {
    const table = String(match[1] || "").toLowerCase();
    if (!new Set(["tenant_platform_endpoint_tools", "admin_platform_endpoint_tools"]).has(table)) continue;
    const columns = splitTopLevel(match[2]).map((column) => column.replace(/[`\s]/g, "").toLowerCase());
    const toolKeyIndex = columns.indexOf("tool_key");
    const methodIndex = columns.indexOf("http_method");
    const pathIndex = columns.indexOf("http_path");
    if (toolKeyIndex < 0) continue;
    const valuesBody = readStatementBody(body, match.index + match[0].length);
    for (const tuple of tupleBodies(valuesBody)) {
      const fields = splitTopLevel(tuple);
      const toolKey = sqlStringLiteral(fields[toolKeyIndex]);
      if (!toolKey || !/^[A-Za-z0-9_]+$/.test(toolKey)) continue;
      const httpMethod = methodIndex >= 0 ? normalizeMethod(sqlStringLiteral(fields[methodIndex])) : null;
      const httpPath = pathIndex >= 0 ? normalizePath(sqlStringLiteral(fields[pathIndex])) : null;
      registrations.push({
        registry_table: table,
        tool_key: toolKey,
        http_method: httpMethod,
        http_path: httpPath,
      });
    }
  }
  return registrations.sort((a, b) => a.tool_key.localeCompare(b.tool_key));
}

export function extractRegistryToolKeys(source = "") {
  return [...new Set(extractRegistryToolRegistrations(source).map((item) => item.tool_key))].sort();
}
