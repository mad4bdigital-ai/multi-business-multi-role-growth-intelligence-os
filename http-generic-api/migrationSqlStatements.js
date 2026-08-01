function stripSqlComments(sql = "") {
  return String(sql || "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*--.*$/gm, "");
}

function maskSqlProtectedRegions(sql = "") {
  const source = String(sql || "");
  const masked = source.split("");
  let state = "normal";

  const hide = (index) => {
    if (source[index] !== "\n" && source[index] !== "\r") masked[index] = " ";
  };

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1] || "";

    if (state === "line_comment") {
      hide(index);
      if (char === "\n") state = "normal";
      continue;
    }

    if (state === "block_comment") {
      hide(index);
      if (char === "*" && next === "/") {
        hide(index + 1);
        index += 1;
        state = "normal";
      }
      continue;
    }

    if (state !== "normal") {
      hide(index);
      const quote = state === "single_quote" ? "'" : state === "double_quote" ? '"' : "`";
      if (char === "\\" && state !== "backtick_quote" && next) {
        hide(index + 1);
        index += 1;
        continue;
      }
      if (char === quote && next === quote) {
        hide(index + 1);
        index += 1;
        continue;
      }
      if (char === quote) state = "normal";
      continue;
    }

    if (char === "-" && next === "-") {
      hide(index);
      hide(index + 1);
      index += 1;
      state = "line_comment";
      continue;
    }
    if (char === "/" && next === "*") {
      hide(index);
      hide(index + 1);
      index += 1;
      state = "block_comment";
      continue;
    }
    if (char === "'") {
      hide(index);
      state = "single_quote";
      continue;
    }
    if (char === '"') {
      hide(index);
      state = "double_quote";
      continue;
    }
    if (char === "`") {
      hide(index);
      state = "backtick_quote";
    }
  }

  return masked.join("");
}

/**
 * Canonical statement splitter for governed migration inspection, preflight,
 * authorization, execution, reconciliation, and readback.
 *
 * It recognizes the repository's supported top-level migration statements
 * instead of splitting every semicolon because SQL strings, comments, and JSON
 * payloads may contain semicolons that are not statement boundaries.
 */
export function splitMigrationSqlStatements(sql = "") {
  const source = String(sql || "");
  const boundaryStart = "(?:CREATE\\s+(?:OR\\s+REPLACE\\s+)?(?:TEMPORARY\\s+)?(?:TABLE|VIEW)|CREATE\\s+(?:OR\\s+REPLACE\\s+)?TRIGGER|CREATE\\s+(?:UNIQUE\\s+)?INDEX|INSERT\\s+(?:IGNORE\\s+)?INTO|UPDATE\\s+`?[A-Za-z0-9_]+`?|ALTER\\s+TABLE|SET\\s+@?[A-Za-z0-9_]+|PREPARE\\s+[A-Za-z0-9_]+|EXECUTE\\s+[A-Za-z0-9_]+|DEALLOCATE\\s+PREPARE\\s+[A-Za-z0-9_]+|DROP\\s+(?:TEMPORARY\\s+)?TABLE|TRUNCATE\\s+TABLE|DELETE\\s+FROM|SELECT)\\b";
  const statementBoundary = new RegExp(`;\\s*(?=(?:${boundaryStart})|$)`, "gi");
  const masked = maskSqlProtectedRegions(source);
  const statements = [];
  let cursor = 0;
  let match;

  while ((match = statementBoundary.exec(masked)) !== null) {
    statements.push(source.slice(cursor, match.index).trim());
    cursor = match.index + match[0].length;
  }
  statements.push(source.slice(cursor).trim());

  return statements
    .map((statement) => stripSqlComments(statement).trim())
    .filter(Boolean);
}
