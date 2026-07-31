function stripSqlComments(sql = "") {
  return String(sql || "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*--.*$/gm, "");
}

/**
 * Canonical statement splitter for governed migration inspection, preflight,
 * authorization, execution, reconciliation, and readback.
 *
 * It recognizes the repository's supported top-level migration statements
 * instead of splitting every semicolon because SQL strings and JSON payloads
 * may contain semicolons that are not statement boundaries.
 */
export function splitMigrationSqlStatements(sql = "") {
  const boundaryStart = "(?:CREATE\\s+(?:OR\\s+REPLACE\\s+)?(?:TEMPORARY\\s+)?(?:TABLE|VIEW)|CREATE\\s+(?:OR\\s+REPLACE\\s+)?TRIGGER|CREATE\\s+(?:UNIQUE\\s+)?INDEX|INSERT\\s+(?:IGNORE\\s+)?INTO|UPDATE\\s+`?[A-Za-z0-9_]+`?|ALTER\\s+TABLE|SET\\s+@?[A-Za-z0-9_]+|PREPARE\\s+[A-Za-z0-9_]+|EXECUTE\\s+[A-Za-z0-9_]+|DEALLOCATE\\s+PREPARE\\s+[A-Za-z0-9_]+|DROP\\s+(?:TEMPORARY\\s+)?TABLE|TRUNCATE\\s+TABLE|DELETE\\s+FROM|SELECT)\\b";
  const interStatementTrivia = "(?:\\s|--[^\\n]*(?:\\n|$)|/\\*[\\s\\S]*?\\*/)*";
  const statementBoundary = new RegExp(`;${interStatementTrivia}(?=${interStatementTrivia}(?:${boundaryStart})|$)`, "i");

  return String(sql || "")
    .split(statementBoundary)
    .map((statement) => statement.trim())
    .filter((statement) => stripSqlComments(statement).trim().length > 0);
}
